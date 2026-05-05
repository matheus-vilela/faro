/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import {
  extractDocumentFromPdfBuffer,
  extractDocumentWithOpenAI,
  type ExtractedDocumentResult,
} from "../_shared/openaiExpense.ts";
import { resolveProductMatches } from "../received-whatsapp-message/productMatch.ts";
import {
  bytesToImageDataUrlSafe,
  optimizeExpenseImage,
} from "../_shared/optimizeExpenseImage.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { productMatchOptionsForNfeXmlUpload } from "./parseExpenseMatchBatch.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Igual ao fluxo WhatsApp: aliases + similaridade; NF-e XML estruturada usa matcher de lote (`importBatch`). */
async function enrichForCompany(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  extracted: ExtractedDocumentResult,
  matchOpts?: { importBatch?: boolean },
): Promise<{
  data: ExtractedDocumentResult & { _requiresProductConfirmation?: boolean };
  resolvedSupplierId: string | null;
}> {
  const ex0 = enrichExtractedWithTaxId(extracted);
  const intent = ex0.businessIntent ?? "compra_insumos";
  if (intent === "conta_pagar" || intent === "conta_receber") {
    const data: ExtractedDocumentResult & {
      _requiresProductConfirmation?: boolean;
    } = {
      ...ex0,
      items: ex0.items ?? [],
      _requiresProductConfirmation: false,
    };
    const sr = await ensureSupplierFromExtracted(
      supabase,
      companyId,
      data,
      "Cadastrado automaticamente — leitura de comprovante no Faro",
    );
    return { data, resolvedSupplierId: sr.supplierId };
  }
  const matchResult = await resolveProductMatches(
    supabase,
    companyId,
    ex0.items,
    matchOpts?.importBatch ? { importBatch: true } : undefined,
  );
  const data: ExtractedDocumentResult & {
    _requiresProductConfirmation?: boolean;
  } = {
    ...ex0,
    items: matchResult.items,
    _requiresProductConfirmation: matchResult.requiresProductConfirmation,
  };
  const sr = await ensureSupplierFromExtracted(
    supabase,
    companyId,
    data,
    "Cadastrado automaticamente — leitura de comprovante no Faro",
  );
  return { data, resolvedSupplierId: sr.supplierId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  if (!apiKey) {
    return json({ ok: false, error: "Extração por IA indisponível (OPENAI_API_KEY)." }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ ok: false, error: "Sessão inválida." }, 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "Body inválido." }, 400);
  }

  const companyIdRaw = form.get("company_id");
  const companyId =
    typeof companyIdRaw === "string" ? companyIdRaw.trim() : "";
  if (!companyId) {
    return json({ ok: false, error: "company_id é obrigatório." }, 400);
  }

  const { data: member, error: memErr } = await supabase
    .from("user_companies")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (memErr || !member) {
    return json({ ok: false, error: "Sem acesso a esta empresa." }, 403);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "Arquivo ausente." }, 400);
  }

  const name = (file.name ?? "").toLowerCase();
  const mime = (file.type ?? "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());

  let extracted: ExtractedDocumentResult | null = null;

  const headXml = new TextDecoder().decode(
    buf.subarray(0, Math.min(800, buf.length)),
  ).trimStart();
  const isXml =
    name.endsWith(".xml") ||
    mime.includes("xml") ||
    /^<\?xml/i.test(headXml) ||
    /<nfeProc/i.test(headXml) ||
    (headXml.startsWith("<") && /<NFe/i.test(headXml));

  if (isXml && !mime.includes("pdf")) {
    const text = new TextDecoder().decode(buf);
    extracted = parseNfeXmlToExtracted(text);
    if (!extracted) {
      return json({
        ok: false,
        error:
          "Não foi possível ler a NF-e neste XML. Confira se é o arquivo autorizado (nfeProc).",
      }, 422);
    }
    const xmlEnriched = await enrichForCompany(
      supabase,
      companyId,
      extracted,
      productMatchOptionsForNfeXmlUpload(),
    );
    return json({
      ok: true,
      data: xmlEnriched.data,
      resolvedSupplierId: xmlEnriched.resolvedSupplierId,
    });
  }

  const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
  const isImage =
    mime.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif)$/i.test(name);

  if (isPdf) {
    const pdfModel =
      Deno.env.get("OPENAI_EXPENSE_PDF_MODEL")?.trim() ||
      Deno.env.get("OPENAI_EXPENSE_MODEL")?.trim() ||
      "gpt-4o";
    const res = await extractDocumentFromPdfBuffer(
      apiKey,
      buf,
      file.name || "documento.pdf",
      pdfModel,
    );
    if (!res.ok) {
      return json({ ok: false, error: res.error }, 422);
    }
    const pdfEnriched = await enrichForCompany(supabase, companyId, res.data);
    return json({
      ok: true,
      data: pdfEnriched.data,
      resolvedSupplierId: pdfEnriched.resolvedSupplierId,
    });
  }

  if (isImage) {
    let dataUrl: string;
    try {
      const opt = await optimizeExpenseImage(buf);
      dataUrl = bytesToImageDataUrlSafe(opt.bytes, "image/jpeg");
    } catch (e) {
      console.error("[parse-expense-document] optimize:", e);
      return json(
        {
          ok: false,
          error:
            "Não foi possível processar a imagem. Tente outro formato ou um arquivo menor.",
        },
        422,
      );
    }

    const res = await extractDocumentWithOpenAI({
      apiKey,
      mode: "image",
      imageDataUrl: dataUrl,
    });
    if (!res.ok) {
      return json({ ok: false, error: res.error }, 422);
    }
    const imgEnriched = await enrichForCompany(supabase, companyId, res.data);
    return json({
      ok: true,
      data: imgEnriched.data,
      resolvedSupplierId: imgEnriched.resolvedSupplierId,
    });
  }

  return json(
    {
      ok: false,
      error:
        "Formato não suportado. Envie imagem (JPG, PNG, WebP), PDF ou XML de NF-e.",
    },
    400,
  );
});

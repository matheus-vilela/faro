/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import { resolveProductMatches } from "../received-whatsapp-message/productMatch.ts";

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

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function digitsOnly(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
}

function normalizeName(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function findOrCreateProduct(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  item: Record<string, unknown>,
): Promise<{ productId: string | null; needsReview: boolean; reason?: string }> {
  const name = String(item.productName ?? "").trim() || "Item";
  const unit = String(item.unitCommercial ?? "un").trim() || "un";
  const sku = String(item.productCode ?? "").trim();
  const nname = normalizeName(name);

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, name, unit, sku, is_active")
    .eq("company_id", companyId);
  if (pErr) {
    return { productId: null, needsReview: true, reason: pErr.message };
  }
  const rows = (products ?? []) as Array<{
    id: string;
    name: string;
    unit?: string | null;
    sku?: string | null;
    is_active?: boolean | null;
  }>;

  const bySku = sku
    ? rows.find((p) => (p.sku ?? "").trim().toLowerCase() === sku.toLowerCase())
    : null;
  if (bySku) {
    const existingUnit = String(bySku.unit ?? "un").trim().toLowerCase();
    if (existingUnit !== unit.toLowerCase()) {
      return {
        productId: null,
        needsReview: true,
        reason: `Conflito de unidade para SKU ${sku} (${existingUnit} x ${unit})`,
      };
    }
    return { productId: bySku.id, needsReview: false };
  }

  const exact = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() === unit.toLowerCase()
  );
  if (exact) {
    return { productId: exact.id, needsReview: false };
  }

  const sameNameDifferentUnit = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() !== unit.toLowerCase()
  );
  if (sameNameDifferentUnit) {
    return {
      productId: null,
      needsReview: true,
      reason: `Produto "${name}" com unidade divergente (${sameNameDifferentUnit.unit} x ${unit})`,
    };
  }

  const { data: created, error: cErr } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      name,
      unit,
      sku: sku || null,
      current_quantity: 0,
    })
    .select("id")
    .single();
  if (cErr) {
    return { productId: null, needsReview: true, reason: cErr.message };
  }
  return { productId: (created?.id as string) ?? null, needsReview: false };
}

async function insertImportLog(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from("company_nfe_import_logs").insert(payload);
  return error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
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
  if (userErr || !user) return json({ ok: false, error: "Sessão inválida." }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "Body inválido." }, 400);
  }
  const companyId = String(form.get("company_id") ?? "").trim();
  const file = form.get("file");
  if (!companyId) return json({ ok: false, error: "company_id é obrigatório." }, 400);
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "Arquivo ZIP ausente." }, 400);
  }

  const { data: member, error: memErr } = await supabase
    .from("user_companies")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (memErr || !member) return json({ ok: false, error: "Sem acesso a esta empresa." }, 403);

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    return json({ ok: false, error: "ZIP inválido ou corrompido." }, 422);
  }

  const entries = Object.entries(unzipped).filter(([name, content]) =>
    name.toLowerCase().endsWith(".xml") && content && content.length > 0
  );
  if (!entries.length) {
    return json({ ok: false, error: "Nenhum XML válido encontrado no ZIP." }, 422);
  }

  const logs: Array<{ name: string; ok: boolean; status: string; message: string }> = [];
  let successCount = 0;

  for (const [entryName, xmlBytes] of entries) {
    const xmlHash = sha256Hex(xmlBytes);
    const xmlText = strFromU8(xmlBytes);
    const extracted = parseNfeXmlToExtracted(xmlText);
    if (!extracted) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        status: "read_error",
        error_message: "XML inválido para NF-e autorizada (nfeProc).",
      });
      logs.push({
        name: entryName,
        ok: false,
        status: "read_error",
        message: "Erro de leitura: XML inválido.",
      });
      continue;
    }

    const data = enrichExtractedWithTaxId(extracted);
    const nfeAccessKey = String(data.nfeAccessKey ?? "").trim() || null;
    const invoiceNumber = String(data.invoiceNumber ?? "").trim() || null;
    const invoiceSeries = String(data.invoiceSeries ?? "").trim() || null;
    const supplierDocument = digitsOnly(data.supplierDocument);
    const emissionDate = String(data.emissionDate ?? "").slice(0, 10) || null;

    const { data: alreadyByHash } = await supabase
      .from("company_nfe_import_logs")
      .select("id")
      .eq("company_id", companyId)
      .eq("xml_hash", xmlHash)
      .maybeSingle();
    if (alreadyByHash) {
      logs.push({ name: entryName, ok: false, status: "duplicate", message: "Ignorado: XML já importado." });
      continue;
    }

    if (nfeAccessKey) {
      const { data: byKey } = await supabase
        .from("company_nfe_import_logs")
        .select("id")
        .eq("company_id", companyId)
        .eq("nfe_access_key", nfeAccessKey)
        .maybeSingle();
      if (byKey) {
        await insertImportLog(supabase, {
          company_id: companyId,
          file_name: entryName,
          xml_hash: xmlHash,
          nfe_access_key: nfeAccessKey,
          invoice_number: invoiceNumber,
          invoice_series: invoiceSeries,
          supplier_document: supplierDocument,
          emission_date: emissionDate,
          status: "duplicate",
          error_message: "Nota já importada por chave de acesso.",
        });
        logs.push({ name: entryName, ok: false, status: "duplicate", message: "Ignorado: chave de acesso já importada." });
        continue;
      }
    }

    const supplierId = await ensureSupplierFromExtracted(
      supabase,
      companyId,
      data,
      "Cadastrado automaticamente — importação XML/ZIP NF-e",
    );

    const match = await resolveProductMatches(supabase, companyId, data.items ?? []);
    const finalItems: Array<Record<string, unknown>> = [];
    let needsReviewReason: string | null = null;
    for (const item of match.items ?? []) {
      const pm = item.productMatch as Record<string, unknown> | undefined;
      const resolvedProductId = String(pm?.resolvedProductId ?? "").trim() || null;
      const needsConfirmation = pm?.needsConfirmation === true;
      if (needsConfirmation && resolvedProductId) {
        needsReviewReason = `Conflito de unidade para item "${item.productName}"`;
        break;
      }
      if (needsConfirmation && !resolvedProductId) {
        const created = await findOrCreateProduct(supabase, companyId, item as Record<string, unknown>);
        if (created.needsReview || !created.productId) {
          needsReviewReason = created.reason ?? `Baixa confiança no match para "${item.productName}"`;
          break;
        }
        finalItems.push({
          ...item,
          productId: created.productId,
        });
      } else if (resolvedProductId) {
        finalItems.push({
          ...item,
          productId: resolvedProductId,
        });
      } else {
        const created = await findOrCreateProduct(supabase, companyId, item as Record<string, unknown>);
        if (created.needsReview || !created.productId) {
          needsReviewReason = created.reason ?? `Nao foi possivel resolver "${item.productName}"`;
          break;
        }
        finalItems.push({
          ...item,
          productId: created.productId,
        });
      }
    }

    if (needsReviewReason) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        nfe_access_key: nfeAccessKey,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_document: supplierDocument,
        emission_date: emissionDate,
        status: "needs_review",
        error_message: needsReviewReason,
        payload: data,
      });
      logs.push({ name: entryName, ok: false, status: "needs_review", message: needsReviewReason });
      continue;
    }

    const notes =
      `Importado via ZIP/XML no setup` +
      (nfeAccessKey ? ` — chave ${nfeAccessKey}` : "");
    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .insert({
        company_id: companyId,
        created_by: user.id,
        type: "nota_fiscal",
        expense_source: "manual",
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_id: supplierId,
        supplier_document: data.supplierDocument,
        supplier_name: data.supplierName,
        status: "pending",
        notes,
        document_total: Number(data.totalAmount ?? 0) || null,
      })
      .select("id")
      .single();

    if (expErr || !expense?.id) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        nfe_access_key: nfeAccessKey,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_document: supplierDocument,
        emission_date: emissionDate,
        status: "validation_error",
        error_message: expErr?.message ?? "Falha ao criar despesa.",
        payload: data,
      });
      logs.push({ name: entryName, ok: false, status: "validation_error", message: expErr?.message ?? "Falha ao criar despesa." });
      continue;
    }

    const expenseId = expense.id as string;
    const insertedItemIds: Array<{ expense_item_id: string; status: string; quantity_received: number }> = [];
    for (const it of finalItems) {
      const q = Math.max(0.0001, Number(it.quantity ?? 0));
      const uv = Number(it.unitValue ?? 0);
      const invUnit = String(it.unitCommercial ?? "").trim() || null;
      const stockQty = Number((it.productMatch as Record<string, unknown> | undefined)?.stockQuantity ?? q);
      const { data: insItem, error: itemErr } = await supabase
        .from("expense_items")
        .insert({
          expense_id: expenseId,
          product_name: String(it.productName ?? "Item"),
          quantity: q,
          unit_value: uv,
          product_id: String(it.productId ?? "").trim() || null,
          invoice_unit: invUnit,
          stock_quantity: Number.isFinite(stockQty) ? stockQty : q,
          stock_added: false,
        })
        .select("id")
        .single();
      if (itemErr || !insItem?.id) {
        needsReviewReason = itemErr?.message ?? "Falha ao inserir itens";
        break;
      }
      insertedItemIds.push({
        expense_item_id: String(insItem.id),
        status: "received",
        quantity_received: Number.isFinite(stockQty) ? stockQty : q,
      });
    }

    if (needsReviewReason) {
      await insertImportLog(supabase, {
        company_id: companyId,
        file_name: entryName,
        xml_hash: xmlHash,
        nfe_access_key: nfeAccessKey,
        invoice_number: invoiceNumber,
        invoice_series: invoiceSeries,
        supplier_document: supplierDocument,
        emission_date: emissionDate,
        status: "needs_review",
        error_message: needsReviewReason,
        expense_id: expenseId,
        payload: data,
      });
      logs.push({ name: entryName, ok: false, status: "needs_review", message: needsReviewReason });
      continue;
    }

    const { data: rec, error: recErr } = await supabase
      .from("recebimentos")
      .insert({ expense_id: expenseId })
      .select("token")
      .single();
    if (!recErr && rec?.token) {
      await supabase.rpc("confirmar_recebimento", {
        p_token: rec.token,
        p_items: insertedItemIds,
      });
    }

    await insertImportLog(supabase, {
      company_id: companyId,
      file_name: entryName,
      xml_hash: xmlHash,
      nfe_access_key: nfeAccessKey,
      invoice_number: invoiceNumber,
      invoice_series: invoiceSeries,
      supplier_document: supplierDocument,
      emission_date: emissionDate,
      status: "success",
      expense_id: expenseId,
      payload: data,
    });
    logs.push({ name: entryName, ok: true, status: "success", message: "Importado com sucesso." });
    successCount += 1;
  }

  return json({
    ok: true,
    summary: {
      total_xml: entries.length,
      success: successCount,
      failed: entries.length - successCount,
    },
    files: logs,
  });
});

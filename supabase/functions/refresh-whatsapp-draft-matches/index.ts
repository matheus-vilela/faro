/**
 * Reaplica o match de produtos (aliases, equivalências, limiares, unidades)
 * ao abrir o link público de conferência — o cliente anon não pode ler o catálogo (RLS).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { ExtractedExpenseItem } from "../_shared/openaiExpense.ts";
import { resolveProductMatches } from "../received-whatsapp-message/productMatch.ts";
import { getDefaultCatalogMatchingOpts } from "../_shared/nfeExpenseProducts/catalogMatchingPolicy.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function itemsToMatchInput(items: unknown[]): ExtractedExpenseItem[] {
  return items.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      productName: String(r.productName ?? ""),
      quantity: Number(r.quantity ?? 0),
      unitValue: Number(r.unitValue ?? 0),
      lineTotal: Number(r.lineTotal ?? 0),
      unitCommercial: (r.unitCommercial as string | null | undefined) ?? null,
      unitTax: (r.unitTax as string | null | undefined) ?? null,
      ncm: (r.ncm as string | null | undefined) ?? null,
      ean: (r.ean as string | null | undefined) ?? null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }
  const token = body.token?.trim();
  if (!token) {
    return json({ ok: false, error: "Informe o token do link." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: draft, error: qErr } = await supabase
    .from("whatsapp_expense_drafts")
    .select("id, company_id, extracted_json, expires_at")
    .eq("access_token", token)
    .maybeSingle();

  if (qErr) {
    console.error("[refresh-whatsapp-draft-matches]", qErr.message);
    return json({ ok: false, error: "Erro ao carregar rascunho." }, 500);
  }
  if (!draft) {
    return json({ ok: false, error: "Link inválido ou expirado" }, 404);
  }
  const exp = draft.expires_at as string | null;
  if (exp && new Date(exp) < new Date()) {
    return json({ ok: false, error: "Este link expirou" }, 400);
  }

  const ex = draft.extracted_json as Record<string, unknown>;
  const itemsRaw = Array.isArray(ex.items) ? ex.items : [];
  if (itemsRaw.length === 0) {
    return json({ ok: true, extracted_json: ex, updated: false });
  }

  const baseItems = itemsToMatchInput(itemsRaw);
  const matchOpts = await getDefaultCatalogMatchingOpts(
    supabase,
    draft.company_id as string,
    "WHATSAPP_INTERACTIVE",
  );
  const matchResult = await resolveProductMatches(
    supabase,
    draft.company_id as string,
    baseItems,
    matchOpts,
  );

  const newExtracted: Record<string, unknown> = {
    ...ex,
    items: matchResult.items,
    _requiresProductConfirmation: matchResult.requiresProductConfirmation,
  };

  const { error: upErr } = await supabase
    .from("whatsapp_expense_drafts")
    .update({ extracted_json: newExtracted })
    .eq("id", draft.id as string);

  if (upErr) {
    console.error("[refresh-whatsapp-draft-matches] update:", upErr.message);
    return json({ ok: false, error: "Não foi possível atualizar o rascunho." }, 500);
  }

  return json({
    ok: true,
    extracted_json: newExtracted,
    updated: true,
  });
});

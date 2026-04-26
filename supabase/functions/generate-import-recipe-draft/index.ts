/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { canonicalProductName } from "../_shared/productImport/canonicalName.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

type CandidateComponent = {
  name: string;
  quantity: number;
  unit: string;
  lossFactor?: number;
  confidence?: number;
  reason?: string;
};

function scoreByNameOverlap(a: string, b: string): number {
  const aa = new Set(canonicalProductName(a).split(" ").filter(Boolean));
  const bb = new Set(canonicalProductName(b).split(" ").filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let inter = 0;
  for (const t of aa) if (bb.has(t)) inter += 1;
  return inter / Math.max(aa.size, bb.size);
}

async function suggestComponentsWithAI(
  apiKey: string,
  itemName: string,
  supplierName: string | null,
): Promise<CandidateComponent[] | null> {
  const prompt = [
    "Você gera rascunho de ficha de entrada (desmonte) para restaurante.",
    "Retorne JSON estrito no formato:",
    '{"components":[{"name":"...", "quantity":1.0, "unit":"kg|g|l|ml|un", "lossFactor":1.0, "confidence":0.0-1.0, "reason":"..."}]}',
    "Sem texto fora do JSON.",
    `Item de compra: ${itemName}`,
    `Fornecedor: ${supplierName ?? "não informado"}`,
    "Se não for possível inferir composição, retorne components vazio.",
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content) as { components?: CandidateComponent[] };
    if (!Array.isArray(parsed.components)) return null;
    return parsed.components
      .filter((c) => c && typeof c.name === "string" && Number(c.quantity) > 0)
      .map((c) => ({
        name: c.name.trim(),
        quantity: Number(c.quantity),
        unit: String(c.unit ?? "un").trim().toLowerCase() || "un",
        lossFactor: Number.isFinite(Number(c.lossFactor)) ? Number(c.lossFactor) : 1,
        confidence: Number.isFinite(Number(c.confidence)) ? Number(c.confidence) : 0.75,
        reason: typeof c.reason === "string" ? c.reason : "Sugerido por IA",
      }));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Body inválido." }, 400);
  }
  const token = String(body.token ?? "").trim();
  const expenseItemId = String(body.expense_item_id ?? "").trim();
  if (!token || !expenseItemId) {
    return json({ ok: false, error: "token e expense_item_id são obrigatórios." }, 400);
  }

  const { data: row } = await supabase
    .from("recebimentos")
    .select(
      "id, status, expenses!inner(id, company_id, supplier_name), expense_items!inner(id, expense_id, product_name, quantity)",
    )
    .eq("token", token)
    .eq("expense_items.id", expenseItemId)
    .maybeSingle();

  const rec = row as unknown as {
    id: string;
    status: string;
    expenses: { id: string; company_id: string; supplier_name?: string | null };
    expense_items: Array<{ id: string; expense_id: string; product_name: string; quantity: number }>;
  } | null;

  if (!rec || rec.status === "received" || !rec.expense_items?.[0]) {
    return json({ ok: false, error: "Token/item inválido para gerar rascunho." }, 403);
  }
  const item = rec.expense_items[0];
  const companyId = rec.expenses.company_id;

  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(2000);
  const catalog = (products ?? []) as Array<{ id: string; name: string; unit?: string | null }>;

  let aiComponents: CandidateComponent[] | null = null;
  if (apiKey) {
    aiComponents = await suggestComponentsWithAI(apiKey, item.product_name, rec.expenses.supplier_name ?? null);
  }

  let candidates: CandidateComponent[] = aiComponents ?? [];
  if (!candidates.length) {
    const top = [...catalog]
      .map((p) => ({ p, s: scoreByNameOverlap(item.product_name, p.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    candidates = top.map((x) => ({
      name: x.p.name,
      quantity: Math.max(1, Number(item.quantity ?? 1) / Math.max(top.length, 1)),
      unit: String(x.p.unit ?? "un").toLowerCase(),
      lossFactor: 1,
      confidence: Math.min(0.7, Math.max(0.35, x.s)),
      reason: "Fallback por similaridade de nome",
    }));
  }

  const { data: draft, error: draftErr } = await supabase
    .from("import_recipe_drafts")
    .insert({
      company_id: companyId,
      expense_item_id: item.id,
      source_description: item.product_name,
      status: "DRAFT",
      confidence_0_1:
        candidates.length > 0
          ? candidates.reduce((a, c) => a + Number(c.confidence ?? 0), 0) / candidates.length
          : 0,
      llm_provider: apiKey ? "openai" : "fallback",
      llm_model: apiKey ? "gpt-4o-mini" : "heuristic",
      reasons_json: { source: apiKey ? "ai" : "fallback", item_name: item.product_name },
      created_by: null,
    })
    .select("id")
    .single();

  if (draftErr || !draft?.id) {
    return json({ ok: false, error: draftErr?.message ?? "Falha ao criar rascunho." }, 500);
  }

  const rows = candidates.map((c, idx) => {
    const best = [...catalog]
      .map((p) => ({ p, s: scoreByNameOverlap(c.name, p.name) }))
      .sort((a, b) => b.s - a.s)[0];
    const productId = best && best.s >= 0.45 ? best.p.id : null;
    return {
      draft_id: draft.id,
      product_id: productId,
      raw_component_name: c.name,
      suggested_quantity: Math.max(0.0001, Number(c.quantity ?? 1)),
      suggested_unit: c.unit ?? null,
      loss_factor: Number(c.lossFactor ?? 1),
      confidence_0_1: Number(c.confidence ?? 0.5),
      match_reason: c.reason ?? "Sugerido",
      sort_order: idx,
    };
  });
  if (rows.length) {
    await supabase.from("import_recipe_draft_components").insert(rows);
  }

  return json({ ok: true, draft_id: draft.id });
});

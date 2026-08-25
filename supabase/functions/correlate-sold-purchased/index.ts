/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import {
  finalizeCorrelateAssignments,
  parseCorrelateAssignments,
  type CorrelateAssignment,
} from "../_shared/correlateSoldPurchased.ts";

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

type SideItem = {
  product_id: string;
  name: string;
  unit?: string | null;
  quantity?: number | null;
  recipe_id?: string | null;
};

const SOLD_BATCH = 45;

const SYSTEM_PROMPT = [
  "Você correlaciona o cardápio de um bar/restaurante no Brasil.",
  "Há duas listas: SOLD (nomes do PDV/EPOC) e PURCHASED (nomes da nota fiscal).",
  "Não existem EAN/SKU/NCM em comum. O único sinal é o nome (abreviado na nota: CERV=cerveja, LN=long neck, CX=caixa).",
  "Para CADA item em SOLD devolva exatamente uma assignment. Nunca invente id fora das listas.",
  'JSON: {"assignments":[{"sold":"s1","kind":"same_item"|"recipe"|"unmatched","purchased":["p1","p2"],"ingredients":[{"id":"p3","label":"Limão"}],"confidence":0.0-1.0,"reason_pt":"..."}]}',
  "same_item: é o MESMO produto de revenda (Heineken 600 do PDV = CERV HEINEKEN 600ML da nota). purchased em ordem de probabilidade. Volume diferente (330 vs 600) NÃO é o mesmo item. Água genérica NÃO é a marca Crystal.",
  "recipe: o vendido é prato/drink/ficha. ingredients = compras que são insumos dessa ficha, com label curto. Não use similaridade de string com o nome do prato (Caipirinha ≠ Limão).",
  "unmatched: não dá para afirmar. Prefira unmatched a forçar vínculo.",
  "Cada compra em purchased[0] de same_item deve ser única neste lote (não ligue a mesma nota a dois PDVs).",
  "Responda só JSON.",
].join(" ");

async function chatJson(params: {
  apiKey: string;
  model: string;
  payload: unknown;
}): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(params.payload) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`openai_http_${res.status}: ${text.slice(0, 280)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("openai_empty");
  return JSON.parse(content);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
  const model =
    Deno.env.get("OPENAI_PRODUCT_MATCH_MODEL")?.trim() || "gpt-4o-mini";

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const companyId = String(body.company_id ?? "").trim();
  const soldRaw = Array.isArray(body.sold) ? (body.sold as SideItem[]) : [];
  const purchasedRaw = Array.isArray(body.purchased)
    ? (body.purchased as SideItem[])
    : [];
  if (!companyId) return json({ ok: false, error: "company_id_required" }, 400);
  if (!apiKey) {
    return json({ ok: false, error: "openai_not_configured" }, 503);
  }

  const admin = createClient(supabaseUrl, service);
  if (!(await userHasCompanyAccess(admin, userData.user.id, companyId))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const sold: SideItem[] = [];
  const seenSold = new Set<string>();
  for (const row of soldRaw) {
    const id = String(row?.product_id ?? "").trim();
    if (!id || seenSold.has(id)) continue;
    seenSold.add(id);
    sold.push({
      product_id: id,
      name: String(row.name ?? "").trim() || "Sem nome",
      unit: String(row.unit ?? "un").trim() || "un",
      quantity: Number(row.quantity ?? 0),
      recipe_id: row.recipe_id ? String(row.recipe_id) : null,
    });
  }
  const purchased: SideItem[] = [];
  const seenPurchased = new Set<string>();
  for (const row of purchasedRaw) {
    const id = String(row?.product_id ?? "").trim();
    if (!id || seenPurchased.has(id)) continue;
    seenPurchased.add(id);
    purchased.push({
      product_id: id,
      name: String(row.name ?? "").trim() || "Sem nome",
      unit: String(row.unit ?? "un").trim() || "un",
      quantity: Number(row.quantity ?? 0),
    });
  }

  if (sold.length === 0) {
    return json({
      ok: true,
      assignments: [],
      stats: { sold: 0, purchased: purchased.length, batches: 0 },
    });
  }

  const { data: runRow, error: runErr } = await admin
    .from("product_match_runs")
    .insert({
      company_id: companyId,
      status: "running",
      model,
      stats: { sold: sold.length, purchased: purchased.length },
    })
    .select("id")
    .single();
  if (runErr || !runRow?.id) {
    return json({ ok: false, error: runErr?.message ?? "run_insert_failed" }, 500);
  }
  const runId = String(runRow.id);

  const soldNodes = sold.map((row, i) => ({
    run_id: runId,
    company_id: companyId,
    product_id: row.product_id,
    side: "sold",
    prompt_id: `s${i + 1}`,
    name: row.name,
    unit: row.unit ?? "un",
    quantity: row.quantity ?? 0,
    recipe_id: row.recipe_id,
  }));
  const purchasedNodes = purchased.map((row, i) => ({
    run_id: runId,
    company_id: companyId,
    product_id: row.product_id,
    side: "purchased",
    prompt_id: `p${i + 1}`,
    name: row.name,
    unit: row.unit ?? "un",
    quantity: row.quantity ?? 0,
  }));

  const { error: nodeErr } = await admin
    .from("product_match_nodes")
    .insert([...soldNodes, ...purchasedNodes]);
  if (nodeErr) {
    await admin
      .from("product_match_runs")
      .update({ status: "failed", error: nodeErr.message, finished_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ ok: false, error: nodeErr.message }, 500);
  }

  const soldPromptToProduct = new Map(
    soldNodes.map((n) => [n.prompt_id, n.product_id]),
  );
  const purchasedPromptToProduct = new Map(
    purchasedNodes.map((n) => [n.prompt_id, n.product_id]),
  );

  const compactPurchased = purchasedNodes.map((n) => ({
    id: n.prompt_id,
    name: n.name,
    unit: n.unit,
  }));

  try {
    const parsedAll: CorrelateAssignment[] = [];
    const usedSamePrompt = new Set<string>();
    const soldChunks = chunk(soldNodes, SOLD_BATCH);
    for (const batch of soldChunks) {
      const payload = {
        sold: batch.map((n) => ({
          id: n.prompt_id,
          name: n.name,
          unit: n.unit,
          already_recipe: Boolean(n.recipe_id),
        })),
        purchased: compactPurchased,
        do_not_reuse_purchased_for_same_item: [...usedSamePrompt],
      };
      const raw = await chatJson({ apiKey, model, payload });
      const parsed = parseCorrelateAssignments(
        raw,
        new Set(batch.map((n) => n.prompt_id)),
        new Set(purchasedNodes.map((n) => n.prompt_id)),
      );
      const finalized = finalizeCorrelateAssignments(
        batch.map((n) => n.prompt_id),
        parsed,
      );
      for (const row of finalized) {
        if (row.kind === "same_item" && row.purchasedIds[0]) {
          usedSamePrompt.add(row.purchasedIds[0]);
        }
        parsedAll.push(row);
      }
    }

    const soldProductIds = sold.map((s) => s.product_id);
    const asProduct = parsedAll.map((row) => ({
      ...row,
      soldId: soldPromptToProduct.get(row.soldId) ?? row.soldId,
      purchasedIds: row.purchasedIds
        .map((id) => purchasedPromptToProduct.get(id) ?? id)
        .filter((id) => seenPurchased.has(id)),
      ingredientLabels: Object.fromEntries(
        Object.entries(row.ingredientLabels).map(([id, label]) => [
          purchasedPromptToProduct.get(id) ?? id,
          label,
        ]),
      ),
    }));
    const assignments = finalizeCorrelateAssignments(soldProductIds, asProduct);

    const { data: nodeRows } = await admin
      .from("product_match_nodes")
      .select("id, product_id, side")
      .eq("run_id", runId);
    const soldNodeByProduct = new Map<string, string>();
    const purchasedNodeByProduct = new Map<string, string>();
    for (const n of nodeRows ?? []) {
      const rec = n as { id: string; product_id: string; side: string };
      if (rec.side === "sold") soldNodeByProduct.set(rec.product_id, rec.id);
      else purchasedNodeByProduct.set(rec.product_id, rec.id);
    }

    const proposalRows = assignments.map((row) => ({
      run_id: runId,
      company_id: companyId,
      sold_node_id: soldNodeByProduct.get(row.soldId),
      kind: row.kind,
      confidence: row.confidence,
      reason_pt: row.reasonPt,
      status: "pending",
    })).filter((row) => row.sold_node_id);

    const { data: insertedProposals, error: propErr } = await admin
      .from("product_match_proposals")
      .insert(proposalRows)
      .select("id, sold_node_id");
    if (propErr) throw new Error(propErr.message);

    const proposalBySoldNode = new Map(
      (insertedProposals ?? []).map((p) => [
        String((p as { sold_node_id: string }).sold_node_id),
        String((p as { id: string }).id),
      ]),
    );

    const linkRows: Record<string, unknown>[] = [];
    for (const row of assignments) {
      const soldNodeId = soldNodeByProduct.get(row.soldId);
      const proposalId = soldNodeId ? proposalBySoldNode.get(soldNodeId) : null;
      if (!proposalId) continue;
      row.purchasedIds.forEach((pid, index) => {
        const purchasedNodeId = purchasedNodeByProduct.get(pid);
        if (!purchasedNodeId) return;
        linkRows.push({
          proposal_id: proposalId,
          company_id: companyId,
          purchased_node_id: purchasedNodeId,
          role: row.kind === "recipe" ? "ingredient" : "same_item",
          rank: index + 1,
          confidence: row.confidence,
          hint_label: row.ingredientLabels[pid] ?? null,
        });
      });
    }
    if (linkRows.length) {
      const { error: linkErr } = await admin
        .from("product_match_proposal_links")
        .insert(linkRows);
      if (linkErr) throw new Error(linkErr.message);
    }

    const stats = {
      sold: sold.length,
      purchased: purchased.length,
      same_item: assignments.filter((a) => a.kind === "same_item").length,
      recipe: assignments.filter((a) => a.kind === "recipe").length,
      unmatched: assignments.filter((a) => a.kind === "unmatched").length,
      batches: soldChunks.length,
    };
    await admin
      .from("product_match_runs")
      .update({
        status: "ready",
        stats,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return json({
      ok: true,
      run_id: runId,
      assignments,
      stats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("product_match_runs")
      .update({
        status: "failed",
        error: message.slice(0, 500),
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return json({ ok: false, error: message }, 500);
  }
});

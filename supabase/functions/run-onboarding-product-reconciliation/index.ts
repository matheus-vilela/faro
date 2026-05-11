/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ONBOARDING_PRODUCT_RECONCILIATION_SYSTEM } from "../_shared/onboardingProductReconciliation/aiPrompt.ts";
import { buildCandidatePairs } from "../_shared/onboardingProductReconciliation/candidates.ts";
import {
  clusterFromMergePairs,
  linkedByMergeEdges,
  resolvePairDeterministic,
  type PairDecision,
} from "../_shared/onboardingProductReconciliation/clusterPipeline.ts";
import { upsertImportPendingReviewCompanyAlert } from "../_shared/upsertImportPendingReviewCompanyAlert.ts";
import { toRawLineInput } from "../_shared/onboardingProductReconciliation/deterministicRules.ts";
import { normalizeProductDescription } from "../_shared/onboardingProductReconciliation/normalize.ts";
import type {
  AiEquivalenceResult,
  RawLineInput,
} from "../_shared/onboardingProductReconciliation/types.ts";

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

async function decideWithOpenAI(
  apiKey: string,
  model: string,
  a: RawLineInput,
  b: RawLineInput,
): Promise<AiEquivalenceResult | null> {
  const payload = {
    focus_item: {
      id: a.id,
      description_original: a.description_original,
      description_normalized: a.description_normalized,
      unit_raw: a.unit_raw,
      ean: a.extracted_attributes.ean,
      extracted_attributes: a.extracted_attributes,
    },
    candidate_item: {
      id: b.id,
      description_original: b.description_original,
      description_normalized: b.description_normalized,
      unit_raw: b.unit_raw,
      ean: b.extracted_attributes.ean,
      extracted_attributes: b.extracted_attributes,
    },
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ONBOARDING_PRODUCT_RECONCILIATION_SYSTEM },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("[reconcile-openai]", res.status, txt);
    return null;
  }
  const data = await res.json();
  const txt = String(data?.choices?.[0]?.message?.content ?? "").trim();
  try {
    const parsed = JSON.parse(txt) as AiEquivalenceResult;
    if (
      parsed.decision !== "MERGE" &&
      parsed.decision !== "KEEP_SEPARATE" &&
      parsed.decision !== "REVIEW_REQUIRED"
    ) {
      return null;
    }
    parsed.confidence = Number(parsed.confidence);
    if (!Number.isFinite(parsed.confidence))
      parsed.confidence = 0.5;
    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence));
    return parsed;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isServiceCaller = !!(serviceRole && bearer === serviceRole);
  const supabase = isServiceCaller
    ? createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

  const body = await req.json().catch(() => ({}));
  const companyId = String((body as { company_id?: string }).company_id ?? "").trim();
  const sourceBatchId = String(
    (body as { source_batch_id?: string }).source_batch_id ?? "",
  ).trim() || null;
  if (!companyId) return json({ ok: false, error: "company_id obrigatório." }, 400);

  if (!isServiceCaller) {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: "Sessão inválida." }, 401);

    const { data: member, error: memErr } = await supabase
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (memErr || !member) return json({ ok: false, error: "Sem acesso a esta empresa." }, 403);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const model =
    Deno.env.get("OPENAI_ONBOARDING_RECONCILE_MODEL") ?? "gpt-4o-mini";

  const { data: runIns, error: runErr } = await supabase
    .from("onboarding_reconciliation_runs")
    .insert({
      company_id: companyId,
      status: "RUNNING",
      pipeline_version: "v1",
    })
    .select("id")
    .single();
  if (runErr || !runIns?.id) {
    return json({ ok: false, error: runErr?.message ?? "Falha ao iniciar execução." }, 500);
  }
  const runId = String(runIns.id);

  try {
    await supabase
      .from("onboarding_product_cluster")
      .delete()
      .eq("company_id", companyId)
      .eq("status", "DRAFT");

    await supabase
      .from("import_review_pending")
      .delete()
      .eq("company_id", companyId)
      .eq("kind", "catalog_reconciliation")
      .eq("status", "OPEN");

    const { data: rawRows, error: rawErr } = await supabase
      .from("onboarding_import_item_raw")
      .select(
        "id, expense_item_id, description_original, description_normalized, unit_raw, ean, created_product_id",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });

    if (rawErr) throw new Error(rawErr.message);

    const rowsAll = (rawRows ?? []) as Array<{
      id: string;
      description_original: string;
      description_normalized: string;
      unit_raw: string | null;
      ean: string | null;
      created_product_id: string | null;
      expense_item_id: string | null;
    }>;

    const eiIds = rowsAll
      .map((r) => String(r.expense_item_id ?? "").trim())
      .filter(Boolean);
    const productIdByExpenseItem = new Map<string, string | null>();
    if (eiIds.length > 0) {
      const { data: eiRows, error: eiErr } = await supabase
        .from("expense_items")
        .select("id, product_id")
        .in("id", eiIds);
      if (eiErr) throw new Error(eiErr.message);
      for (const row of (eiRows ?? []) as Array<{
        id: string;
        product_id: string | null;
      }>) {
        productIdByExpenseItem.set(String(row.id), row.product_id);
      }
    }

    const rows = rowsAll.filter((r) => {
      if (String(r.created_product_id ?? "").trim() !== "") return false;
      const ei = String(r.expense_item_id ?? "").trim();
      if (!ei) return true;
      const pid = productIdByExpenseItem.get(ei);
      if (pid != null && String(pid).trim() !== "") return false;
      return true;
    });

    if (rows.length === 0) {
      await supabase
        .from("onboarding_reconciliation_runs")
        .update({
          status: "COMPLETED",
          finished_at: new Date().toISOString(),
          stats: { clusters: 0, pairs_evaluated: 0 },
        })
        .eq("id", runId);
      return json({
        ok: true,
        run_id: runId,
        clusters_inserted: 0,
        pairs_evaluated: 0,
        ai_calls: 0,
      });
    }

    const nodes: RawLineInput[] = rows.map((r) => {
      const norm =
        r.description_normalized?.trim() ||
        normalizeProductDescription(r.description_original);
      return toRawLineInput({
        id: r.id,
        description_original: r.description_original,
        description_normalized: norm,
        unit_raw: r.unit_raw,
        ean: r.ean,
      });
    });

    const pairs = buildCandidatePairs(nodes, 500);
    const mergePairs: PairDecision[] = [];
    type ReviewPair = {
      a: RawLineInput;
      b: RawLineInput;
      res: AiEquivalenceResult;
    };
    const reviewPairs: ReviewPair[] = [];
    let aiCalls = 0;
    const maxAi = 140;

    for (const pr of pairs) {
      let res = resolvePairDeterministic(pr.a, pr.b);
      let source: "deterministic" | "model" = "deterministic";
      if (!res && openaiKey && aiCalls < maxAi) {
        const ai = await decideWithOpenAI(openaiKey, model, pr.a, pr.b);
        aiCalls += 1;
        if (ai) {
          res = ai;
          source = "model";
        }
      }
      if (!res) {
        res = {
          decision: "REVIEW_REQUIRED",
          matched_candidate_id: null,
          confidence: 0.42,
          canonical_name: pr.a.description_original,
          detected_attributes: pr.a.extracted_attributes,
          explanation:
            openaiKey.length === 0
              ? "OPENAI_API_KEY ausente — caso manual."
              : "Par sem decisão automática segura.",
          separation_or_merge_reason: "fallback_review",
        };
        source = "deterministic";
      }

      if (res.decision === "MERGE") {
        mergePairs.push({
          aId: pr.a.id,
          bId: pr.b.id,
          result: res,
          source,
        });
      } else if (res.decision === "REVIEW_REQUIRED") {
        reviewPairs.push({ a: pr.a, b: pr.b, res });
      }
    }

    const clusters = clusterFromMergePairs(nodes, mergePairs).filter(
      (c) => c.member_ids.length > 1,
    );

    const maxReviewClusters = 120;
    const seenReviewEdge = new Set<string>();
    const reviewToPersist: ReviewPair[] = [];
    for (const rq of reviewPairs) {
      if (linkedByMergeEdges(rq.a.id, rq.b.id, mergePairs)) continue;
      const edgeKey =
        rq.a.id < rq.b.id ? `${rq.a.id}:${rq.b.id}` : `${rq.b.id}:${rq.a.id}`;
      if (seenReviewEdge.has(edgeKey)) continue;
      seenReviewEdge.add(edgeKey);
      reviewToPersist.push(rq);
      if (reviewToPersist.length >= maxReviewClusters) break;
    }

    let inserted = 0;
    for (const c of clusters) {
      const { data: cl, error: cErr } = await supabase
        .from("onboarding_product_cluster")
        .insert({
          company_id: companyId,
          reconciliation_run_id: runId,
          canonical_name_suggested: c.canonical_name,
          primary_unit_suggested: null,
          merge_strength: c.merge_strength,
          aggregate_confidence: c.aggregate_confidence,
          occurrence_count: c.member_ids.length,
          brands_found: c.brands_found,
          ai_summary: {
            explanations: c.explanations,
          },
          status: "DRAFT",
        })
        .select("id")
        .single();
      if (cErr || !cl?.id) continue;
      inserted += 1;
      const clusterId = String(cl.id);

      for (const mid of c.member_ids) {
        const raw = rows.find((r) => r.id === mid);
        await supabase.from("onboarding_product_cluster_member").insert({
          cluster_id: clusterId,
          raw_item_id: mid,
          linked_product_id: raw?.created_product_id ?? null,
          ai_payload: {},
        });
      }
    }

    let reviewInserted = 0;
    for (const rq of reviewToPersist) {
      const ca = rq.a.description_original.trim();
      const cb = rq.b.description_original.trim();
      const canonical =
        ca.length >= cb.length
          ? `Revisar: ${cb.slice(0, 72)} ↔ ${ca.slice(0, 72)}`
          : `Revisar: ${ca.slice(0, 72)} ↔ ${cb.slice(0, 72)}`;
      const brands = [
        rq.a.extracted_attributes.brand,
        rq.b.extracted_attributes.brand,
      ].filter((x): x is string => !!x && x.trim().length > 0);
      const uniqBrands = [...new Set(brands)];

      const { data: cl, error: cErr } = await supabase
        .from("onboarding_product_cluster")
        .insert({
          company_id: companyId,
          reconciliation_run_id: runId,
          canonical_name_suggested: canonical.slice(0, 512),
          primary_unit_suggested: null,
          merge_strength: "LOW_CONFIDENCE_REVIEW",
          aggregate_confidence: rq.res.confidence,
          occurrence_count: 2,
          brands_found: uniqBrands,
          ai_summary: {
            review_required_pair: true,
            explanations: [rq.res.explanation],
            separation_or_merge_reason: rq.res.separation_or_merge_reason,
          },
          status: "DRAFT",
        })
        .select("id")
        .single();
      if (cErr || !cl?.id) continue;
      reviewInserted += 1;
      const clusterId = String(cl.id);

      for (const rid of [rq.a.id, rq.b.id]) {
        const raw = rows.find((r) => r.id === rid);
        await supabase.from("onboarding_product_cluster_member").insert({
          cluster_id: clusterId,
          raw_item_id: rid,
          linked_product_id: raw?.created_product_id ?? null,
          ai_payload: {
            decision: rq.res.decision,
            confidence: rq.res.confidence,
          },
        });
      }
    }

    const clusteredIds = [
      ...clusters.flatMap((x) => x.member_ids),
      ...reviewToPersist.flatMap((rq) => [rq.a.id, rq.b.id]),
    ];
    const uniqueClustered = [...new Set(clusteredIds)];
    if (uniqueClustered.length) {
      await supabase
        .from("onboarding_import_item_raw")
        .update({
          reconciliation_status: "IN_CLUSTER",
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .in("id", uniqueClustered);
    }

    await supabase
      .from("onboarding_reconciliation_runs")
      .update({
        status: "COMPLETED",
        finished_at: new Date().toISOString(),
        stats: {
          pairs_evaluated: pairs.length,
          merge_edges: mergePairs.length,
          merge_clusters: inserted,
          review_clusters: reviewInserted,
          ai_calls: aiCalls,
        },
      })
      .eq("id", runId);

    const { data: draftForReview, error: draftReviewErr } = await supabase
      .from("onboarding_product_cluster")
      .select("id, merge_strength, ai_summary")
      .eq("company_id", companyId)
      .eq("reconciliation_run_id", runId)
      .eq("status", "DRAFT");
    if (!draftReviewErr) {
      const toReview = (draftForReview ?? []).filter((c) => {
        const sum = c.ai_summary as Record<string, unknown> | null;
        if (sum?.review_required_pair === true) return true;
        if (
          c.merge_strength === "MEDIUM_CONFIDENCE_REVIEW" ||
          c.merge_strength === "LOW_CONFIDENCE_REVIEW"
        ) {
          return true;
        }
        return false;
      });
      if (toReview.length > 0) {
        const clusterIds = toReview.map((c) => c.id);
        await supabase.from("import_review_pending").insert({
          company_id: companyId,
          kind: "catalog_reconciliation",
          status: "OPEN",
          title: "Agrupamentos do catálogo para revisar",
          detail:
            `${toReview.length} grupo(s) de produtos do catálogo sugerem revisão após a importação.`,
          batch_id: sourceBatchId,
          payload: {
            reconciliation_run_id: runId,
            cluster_ids: clusterIds,
            source_batch_id: sourceBatchId,
          },
        });
      }
    }

    await upsertImportPendingReviewCompanyAlert(supabase, companyId);

    return json({
      ok: true,
      run_id: runId,
      clusters_inserted: inserted,
      review_clusters_inserted: reviewInserted,
      pairs_evaluated: pairs.length,
      ai_calls: aiCalls,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("onboarding_reconciliation_runs")
      .update({
        status: "FAILED",
        finished_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq("id", runId);
    return json({ ok: false, error: msg }, 500);
  }
});

import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";
import { supabase } from "@/lib/supabase";

export type OnboardingClusterRow = {
  id: string;
  canonical_name_suggested: string;
  merge_strength: string;
  aggregate_confidence: number | null;
  occurrence_count: number | null;
  brands_found: string[] | null;
  ai_summary: Record<string, unknown> | null;
  status: string;
};

export async function fetchDraftClusters(
  companyId: string,
): Promise<OnboardingClusterRow[]> {
  const { data, error } = await supabase
    .from("onboarding_product_cluster")
    .select(
      "id, canonical_name_suggested, merge_strength, aggregate_confidence, occurrence_count, brands_found, ai_summary, status",
    )
    .eq("company_id", companyId)
    .eq("status", "DRAFT")
    .order("occurrence_count", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as OnboardingClusterRow[];
}

/** Clusters de rascunho restringidos a uma lista (ex.: uma pendência agregada). */
export async function fetchDraftClustersByIds(
  companyId: string,
  clusterIds: string[],
): Promise<OnboardingClusterRow[]> {
  if (!clusterIds.length) return [];
  const { data, error } = await supabase
    .from("onboarding_product_cluster")
    .select(
      "id, canonical_name_suggested, merge_strength, aggregate_confidence, occurrence_count, brands_found, ai_summary, status",
    )
    .eq("company_id", companyId)
    .eq("status", "DRAFT")
    .in("id", clusterIds)
    .order("occurrence_count", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as OnboardingClusterRow[];
}

export async function fetchClusterMembers(clusterId: string): Promise<
  Array<{
    raw_item_id: string;
    linked_product_id: string | null;
  }>
> {
  const { data, error } = await supabase
    .from("onboarding_product_cluster_member")
    .select("raw_item_id, linked_product_id")
    .eq("cluster_id", clusterId);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    raw_item_id: string;
    linked_product_id: string | null;
  }>;
}

export async function fetchRawDescriptions(
  rawIds: string[],
): Promise<Map<string, string>> {
  if (!rawIds.length) return new Map();
  const { data, error } = await supabase
    .from("onboarding_import_item_raw")
    .select("id, description_original")
    .in("id", rawIds);

  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const r = row as { id: string; description_original: string };
    map.set(r.id, r.description_original);
  }
  return map;
}

function tallyWinnerProductId(
  linkedIds: (string | null | undefined)[],
): string | null {
  const counts = new Map<string, number>();
  for (const id of linkedIds) {
    const x = typeof id === "string" ? id.trim() : "";
    if (!x) continue;
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  let best: string | null = null;
  let nbest = 0;
  for (const [id, n] of counts) {
    if (n > nbest) {
      best = id;
      nbest = n;
    }
  }
  return best;
}

/** Usado ao materializar produto a partir de cluster (Phase B) e em testes. */
export function mapInvoiceUnitRawToProductUnit(raw: string | null | undefined): {
  unit: string;
  import_unit_raw: string | null;
  needsReview: boolean;
} {
  const original = String(raw ?? "").trim();
  if (!original) {
    return { unit: "un", import_unit_raw: null, needsReview: true };
  }
  const t = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    un: "un",
    und: "un",
    unidade: "un",
    cx: "cx",
    caixa: "cx",
    pct: "pct",
    pacote: "pct",
    kg: "kg",
    g: "g",
    l: "l",
    litro: "l",
    ml: "ml",
    fd: "fd",
    fardo: "fd",
  };
  if (aliases[t]) {
    return { unit: aliases[t], import_unit_raw: original, needsReview: false };
  }
  return {
    unit:
      original
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "")
        .slice(0, 24) || "un",
    import_unit_raw: original,
    needsReview: true,
  };
}

/** Phase B: importação adiou produto; cria um cadastro a partir do cluster e propaga vínculos. */
async function materializeProductFromClusterMembers(
  companyId: string,
  clusterId: string,
): Promise<{ ok: boolean; productId?: string; error?: string }> {
  const members = await fetchClusterMembers(clusterId);
  const rawIds = members.map((m) => m.raw_item_id);
  if (!rawIds.length) {
    return { ok: false, error: "Cluster sem linhas brutas." };
  }

  const { data: clusterRow, error: cErr } = await supabase
    .from("onboarding_product_cluster")
    .select("canonical_name_suggested, primary_unit_suggested")
    .eq("id", clusterId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (cErr) return { ok: false, error: cErr.message };

  const canonicalRaw = String(
    (clusterRow as { canonical_name_suggested?: string } | null)
      ?.canonical_name_suggested ?? "",
  ).trim();
  const canonical =
    sanitizeCatalogProductName(canonicalRaw) ||
    sanitizeCatalogProductName("Produto");

  const primaryUnit = (
    clusterRow as { primary_unit_suggested?: string | null }
  )?.primary_unit_suggested;
  const { data: rawRows } = await supabase
    .from("onboarding_import_item_raw")
    .select("id, unit_raw, expense_item_id")
    .eq("company_id", companyId)
    .in("id", rawIds);

  let unitMap = mapInvoiceUnitRawToProductUnit(primaryUnit);
  if (!String(primaryUnit ?? "").trim()) {
    const ur =
      (rawRows ?? []).find((r) =>
        String((r as { unit_raw?: string | null }).unit_raw ?? "").trim(),
      ) ?? null;
    unitMap = mapInvoiceUnitRawToProductUnit(
      ur ? String((ur as { unit_raw: string }).unit_raw) : null,
    );
  }

  const { data: created, error: insErr } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      name: canonical.slice(0, 512),
      unit: unitMap.unit,
      current_quantity: 0,
      import_unit_raw: unitMap.import_unit_raw,
      import_unit_needs_review: unitMap.needsReview,
    })
    .select("id")
    .single();

  if (insErr || !created?.id) {
    return { ok: false, error: insErr?.message ?? "Falha ao criar produto." };
  }
  const newId = created.id as string;

  for (const m of members) {
    await supabase
      .from("onboarding_product_cluster_member")
      .update({ linked_product_id: newId })
      .eq("cluster_id", clusterId)
      .eq("raw_item_id", m.raw_item_id);
  }

  await supabase
    .from("onboarding_import_item_raw")
    .update({
      created_product_id: newId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .in("id", rawIds);

  for (const r of rawRows ?? []) {
    const eid = (r as { expense_item_id?: string | null }).expense_item_id;
    if (eid) {
      await supabase
        .from("expense_items")
        .update({ product_id: newId })
        .eq("id", eid);
    }
  }

  return { ok: true, productId: newId };
}

export async function approveClusterMerge(
  companyId: string,
  clusterId: string,
): Promise<{ ok: boolean; error?: string }> {
  let members = await fetchClusterMembers(clusterId);
  let pidList = members.map((m) => m.linked_product_id);
  let winner = tallyWinnerProductId(pidList);
  if (!winner) {
    const mat = await materializeProductFromClusterMembers(companyId, clusterId);
    if (!mat.ok || !mat.productId) {
      return {
        ok: false,
        error: mat.error ?? "Não foi possível materializar produto para o cluster.",
      };
    }
    winner = mat.productId;
    members = await fetchClusterMembers(clusterId);
    pidList = members.map((m) => m.linked_product_id);
  }

  const losers = [...new Set(pidList.filter(Boolean) as string[])].filter(
    (id) => id !== winner,
  );

  const { data: clusterRow } = await supabase
    .from("onboarding_product_cluster")
    .select("canonical_name_suggested")
    .eq("id", clusterId)
    .maybeSingle();
  const canonical =
    ((clusterRow as { canonical_name_suggested?: string } | null)?.canonical_name_suggested ?? "").trim();

  for (const loser of losers) {
    const { error: rpcErr } = await supabase.rpc("merge_onboarding_products", {
      p_company_id: companyId,
      p_winner_id: winner,
      p_loser_id: loser,
    });
    if (rpcErr) return { ok: false, error: rpcErr.message };
  }

  if (canonical) {
    await supabase
      .from("products")
      .update({
        name: canonical,
        updated_at: new Date().toISOString(),
      })
      .eq("id", winner)
      .eq("company_id", companyId);
  }

  await supabase
    .from("onboarding_product_cluster")
    .update({
      status: "APPROVED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", clusterId)
    .eq("company_id", companyId);

  await supabase.from("onboarding_catalog_decision_memory").insert({
    company_id: companyId,
    decision_kind: "MERGE_APPROVED",
    payload: {
      cluster_id: clusterId,
      winner_product_id: winner,
      merged_product_ids: losers,
      canonical_name: canonical || null,
    },
  });

  await supabase
    .from("onboarding_import_item_raw")
    .update({
      reconciliation_status: "MERGED",
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .in(
      "id",
      members.map((m) => m.raw_item_id),
    );

  return { ok: true };
}

/** Aprova em sequência apenas clusters HIGH_CONFIDENCE_AUTO. */
/**
 * Remove um item bruto do grupo (mantém produtos separados).
 * Se restar um ou zero membros, o cluster é removido e linhas voltam para estado revisável.
 */
export async function removeRawItemFromCluster(
  companyId: string,
  clusterId: string,
  rawItemId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error: delErr } = await supabase
    .from("onboarding_product_cluster_member")
    .delete()
    .eq("cluster_id", clusterId)
    .eq("raw_item_id", rawItemId);

  if (delErr) return { ok: false, error: delErr.message };

  await supabase
    .from("onboarding_import_item_raw")
    .update({
      reconciliation_status: "KEPT_SEPARATE",
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", rawItemId);

  const remaining = await fetchClusterMembers(clusterId);

  if (remaining.length <= 1) {
    if (remaining.length === 1) {
      await supabase
        .from("onboarding_import_item_raw")
        .update({
          reconciliation_status: "IMPORTED",
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("id", remaining[0]!.raw_item_id);
    }
    const { error: delClusterErr } = await supabase
      .from("onboarding_product_cluster")
      .delete()
      .eq("id", clusterId)
      .eq("company_id", companyId);
    if (delClusterErr) return { ok: false, error: delClusterErr.message };
  }

  await supabase.from("onboarding_catalog_decision_memory").insert({
    company_id: companyId,
    decision_kind: "SEPARATION_APPROVED",
    payload: {
      cluster_id: clusterId,
      removed_raw_item_id: rawItemId,
    },
  });

  return { ok: true };
}

export async function approveHighConfidenceClusters(
  companyId: string,
  options?: { clusterIdScope?: string[] | null },
): Promise<{ approved: number; errors: string[] }> {
  let clusters = await fetchDraftClusters(companyId);
  const scope = options?.clusterIdScope?.filter(Boolean) ?? null;
  if (scope && scope.length > 0) {
    const allow = new Set(scope);
    clusters = clusters.filter((c) => allow.has(c.id));
  }
  const highs = clusters.filter(
    (c) => c.merge_strength === "HIGH_CONFIDENCE_AUTO",
  );
  const errors: string[] = [];
  let approved = 0;
  for (const c of highs) {
    const res = await approveClusterMerge(companyId, c.id);
    if (res.ok) approved += 1;
    else if (res.error) errors.push(res.error);
  }
  return { approved, errors };
}

export async function markCatalogReconciliationComplete(
  companyId: string,
): Promise<{ ok: boolean; error?: string }> {
  const iso = new Date().toISOString();
  const { error } = await supabase
    .from("companies")
    .update({
      onboarding_catalog_reconciliation_completed_at: iso,
      updated_at: iso,
    })
    .eq("id", companyId);

  if (error) return { ok: false, error: error.message };
  await supabase.from("onboarding_catalog_decision_memory").insert({
    company_id: companyId,
    decision_kind: "CANONICAL_OVERRIDE",
    payload: {
      onboarding_catalog_closed_at: iso,
      note: "Fluxo único de reconciliação de onboarding encerrado.",
    },
  });
  return { ok: true };
}

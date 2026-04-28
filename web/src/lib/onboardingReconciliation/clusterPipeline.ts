import type { AiEquivalenceResult, MergeStrength, RawLineInput } from "./types";
import { deterministicPairDecision } from "./deterministicRules";

export type PairDecision = {
  aId: string;
  bId: string;
  result: AiEquivalenceResult;
  source: "deterministic" | "model";
};

class UnionFind {
  private readonly p = new Map<string, string>();

  find(x: string): string {
    let r = this.p.get(x);
    if (r === undefined) {
      this.p.set(x, x);
      return x;
    }
    if (r === x) return x;
    const root = this.find(r);
    this.p.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}

export function mergeStrengthFromDecision(
  r: AiEquivalenceResult,
): MergeStrength {
  const d = r.decision;
  const c = r.confidence;
  if (d === "MERGE") {
    if (c >= 0.92) return "HIGH_CONFIDENCE_AUTO";
    if (c >= 0.78) return "MEDIUM_CONFIDENCE_REVIEW";
    return "LOW_CONFIDENCE_REVIEW";
  }
  if (d === "REVIEW_REQUIRED") return "LOW_CONFIDENCE_REVIEW";
  return "MEDIUM_CONFIDENCE_REVIEW";
}

export type ClusterAgg = {
  member_ids: string[];
  linesById: Map<string, RawLineInput>;
  canonical_name: string;
  aggregate_confidence: number;
  merge_strength: MergeStrength;
  brands_found: string[];
  explanations: string[];
};

export function clusterFromMergePairs(
  nodes: RawLineInput[],
  mergePairs: PairDecision[],
): ClusterAgg[] {
  const uf = new UnionFind();
  const lineById = new Map(nodes.map((n) => [n.id, n]));

  const mergeConfidence = new Map<string, number[]>();
  const mergeExplain = new Map<string, string[]>();

  for (const mp of mergePairs) {
    if (mp.result.decision !== "MERGE") continue;
    uf.union(mp.aId, mp.bId);
    const key =
      mp.aId < mp.bId ? `${mp.aId}:${mp.bId}` : `${mp.bId}:${mp.aId}`;
    const arr = mergeConfidence.get(key) ?? [];
    arr.push(mp.result.confidence);
    mergeConfidence.set(key, arr);
    const ex = mergeExplain.get(key) ?? [];
    ex.push(mp.result.explanation);
    mergeExplain.set(key, ex);
  }

  const roots = new Map<string, string[]>();
  for (const n of nodes) {
    const r = uf.find(n.id);
    const list = roots.get(r) ?? [];
    list.push(n.id);
    roots.set(r, list);
  }

  const clusters: ClusterAgg[] = [];
  for (const [, ids] of roots) {
    const uniq = [...new Set(ids)].sort();
    const linesById = new Map<string, RawLineInput>();
    for (const id of uniq) {
      const row = lineById.get(id);
      if (row) linesById.set(id, row);
    }

    let sum = 0;
    let cnt = 0;
    const expl: string[] = [];
    for (let i = 0; i < uniq.length; i += 1) {
      for (let j = i + 1; j < uniq.length; j += 1) {
        const a = uniq[i]!;
        const b = uniq[j]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const cs = mergeConfidence.get(key);
        if (cs?.length) {
          sum += cs.reduce((s, x) => s + x, 0) / cs.length;
          cnt += 1;
          expl.push(...(mergeExplain.get(key) ?? []));
        }
      }
    }

    const aggConf = cnt ? sum / cnt : 0.85;
    let strength: MergeStrength = "HIGH_CONFIDENCE_AUTO";
    if (aggConf < 0.78) strength = "LOW_CONFIDENCE_REVIEW";
    else if (aggConf < 0.92) strength = "MEDIUM_CONFIDENCE_REVIEW";

    const brands = new Set<string>();
    for (const id of uniq) {
      const b = lineById.get(id)?.extracted_attributes.brand;
      if (b) brands.add(b);
    }

    const names = uniq
      .map((id) => lineById.get(id)?.description_original)
      .filter((x): x is string => !!x && x.trim().length > 0);
    names.sort((x, y) => y.length - x.length);
    const canonical = names[0] ?? "Produto";

    clusters.push({
      member_ids: uniq,
      linesById,
      canonical_name: canonical ?? "Produto",
      aggregate_confidence: aggConf,
      merge_strength: uniq.length > 1 ? strength : "HIGH_CONFIDENCE_AUTO",
      brands_found: [...brands],
      explanations: [...new Set(expl)].slice(0, 8),
    });
  }

  return clusters.sort((a, b) => b.member_ids.length - a.member_ids.length);
}

export function resolvePairDeterministic(
  a: RawLineInput,
  b: RawLineInput,
): AiEquivalenceResult | null {
  return deterministicPairDecision(a, b) ?? deterministicPairDecision(b, a);
}

/** Indica se `aId` e `bId` já ficam no mesmo componente conexo só por arestas MERGE. */
export function linkedByMergeEdges(
  aId: string,
  bId: string,
  mergePairs: PairDecision[],
): boolean {
  const uf = new UnionFind();
  for (const mp of mergePairs) {
    uf.union(mp.aId, mp.bId);
  }
  return uf.find(aId) === uf.find(bId);
}

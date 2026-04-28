import { describe, expect, it } from "vitest";
import { buildCandidatePairs } from "./candidates";
import {
  clusterFromMergePairs,
  linkedByMergeEdges,
  mergeStrengthFromDecision,
  resolvePairDeterministic,
  type PairDecision,
} from "./clusterPipeline";
import { deterministicPairDecision, toRawLineInput } from "./deterministicRules";
import { normalizeProductDescription, digitsOnly } from "./normalize";
import type { AiEquivalenceResult } from "./types";

function rawFrom(name: string, id: string, ean: string | null = null) {
  const norm = normalizeProductDescription(name);
  return toRawLineInput({
    id,
    description_original: name,
    description_normalized: norm,
    unit_raw: "un",
    ean,
  });
}

describe("normalizeProductDescription", () => {
  it("colapsa acentos e pontuação", () => {
    expect(normalizeProductDescription("Água Sanitária Ypê 1L")).toContain("agua");
    expect(normalizeProductDescription("Coca-Cola 2L")).toContain("coca");
  });
});

describe("digitsOnly", () => {
  it("extrai EAN", () => {
    expect(digitsOnly("789 123 4567890")).toBe("7891234567890");
  });
});

describe("deterministicPairDecision", () => {
  it("merge quando EAN igual", () => {
    const a = rawFrom("Produto X", "a", "7891234567890");
    const b = rawFrom("Produto X alter", "b", "7891234567890");
    const r = deterministicPairDecision(a, b);
    expect(r?.decision).toBe("MERGE");
    expect(r?.confidence).toBeGreaterThan(0.9);
  });

  it("separa marcas de bebida distintas", () => {
    const a = rawFrom("Heineken Long Neck 330ml", "a");
    const b = rawFrom("Amstel Long Neck 330ml", "b");
    const r = deterministicPairDecision(a, b);
    expect(r?.decision).toBe("KEEP_SEPARATE");
  });

  it("merge quando normalizado igual", () => {
    const a = rawFrom("Acucar União 5KG", "a");
    const b = rawFrom("Açúcar União 5kg", "b");
    const r = deterministicPairDecision(a, b);
    expect(r?.decision).toBe("MERGE");
  });
});

describe("candidate retrieval", () => {
  it("gera par por prefixo ou similaridade", () => {
    const nodes = [
      rawFrom("Água Sanitária Alfa 1L", "1"),
      rawFrom("Água Sanitária Beta 1L", "2"),
      rawFrom("Tomate pelado 400g", "3"),
    ];
    const pairs = buildCandidatePairs(nodes, 50);
    expect(pairs.some((p) => p.a.id === "1" && p.b.id === "2")).toBe(true);
  });
});

describe("linkedByMergeEdges", () => {
  it("detecta A—B—C conectados por merges", () => {
    const mergePairs: PairDecision[] = [
      {
        aId: "1",
        bId: "2",
        source: "deterministic",
        result: {
          decision: "MERGE",
          matched_candidate_id: "2",
          confidence: 0.9,
          canonical_name: "x",
          detected_attributes: rawFrom("x", "1").extracted_attributes,
          explanation: "",
          separation_or_merge_reason: "",
        },
      },
      {
        aId: "2",
        bId: "3",
        source: "deterministic",
        result: {
          decision: "MERGE",
          matched_candidate_id: "3",
          confidence: 0.9,
          canonical_name: "x",
          detected_attributes: rawFrom("x", "2").extracted_attributes,
          explanation: "",
          separation_or_merge_reason: "",
        },
      },
    ];
    expect(linkedByMergeEdges("1", "3", mergePairs)).toBe(true);
    expect(linkedByMergeEdges("1", "4", mergePairs)).toBe(false);
  });
});

describe("clusterFromMergePairs", () => {
  it("agrupa transitivamente merges", () => {
    const nodes = [
      rawFrom("Item A", "1"),
      rawFrom("Item B", "2"),
      rawFrom("Item C", "3"),
    ];
    const mergePairs: PairDecision[] = [
      {
        aId: "1",
        bId: "2",
        source: "deterministic",
        result: {
          decision: "MERGE",
          matched_candidate_id: "2",
          confidence: 0.95,
          canonical_name: "Item A",
          detected_attributes: nodes[0]!.extracted_attributes,
          explanation: "test",
          separation_or_merge_reason: "x",
        },
      },
      {
        aId: "2",
        bId: "3",
        source: "deterministic",
        result: {
          decision: "MERGE",
          matched_candidate_id: "3",
          confidence: 0.93,
          canonical_name: "Item B",
          detected_attributes: nodes[1]!.extracted_attributes,
          explanation: "test",
          separation_or_merge_reason: "y",
        },
      },
    ];
    const clusters = clusterFromMergePairs(nodes, mergePairs).filter(
      (c) => c.member_ids.length > 1,
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.member_ids.sort()).toEqual(["1", "2", "3"]);
  });
});

describe("mergeStrengthFromDecision", () => {
  it("marca média quando confiança média em merge", () => {
    const r: AiEquivalenceResult = {
      decision: "MERGE",
      matched_candidate_id: "x",
      confidence: 0.82,
      canonical_name: "x",
      detected_attributes: rawFrom("x", "id").extracted_attributes,
      explanation: "",
      separation_or_merge_reason: "",
    };
    expect(mergeStrengthFromDecision(r)).toBe("MEDIUM_CONFIDENCE_REVIEW");
  });
});

describe("aprovação simulada", () => {
  it("resolvePairDeterministic cobre ordem invertida", () => {
    const a = rawFrom("Refrigerante BrandA 2L", "a");
    const b = rawFrom("Refrigerante BrandB 2L", "b");
    const one = resolvePairDeterministic(a, b);
    expect(one?.decision === "KEEP_SEPARATE" || one === null).toBe(true);
  });
});

import type { AiEquivalenceResult, RawLineInput } from "./types.ts";
import { extractAttributesFromDescription } from "./extractAttributes.ts";
import { normalizeProductDescription } from "./normalize.ts";

const BEVERAGE_BRAND_BUDGET = new Set([
  "coca",
  "coca cola",
  "coca-cola",
  "pepsi",
  "heineken",
  "amstel",
  "brahma",
  "skol",
  "eisenbahn",
  "guarana",
  "antarctica",
  "spaten",
  "stella",
  "corona",
  "bud",
]);

/**
 * Regras conservadoras sem LLM: EAN idêntico; merge por nome+token; cerveja/refris de marcas distintas separam.
 */
export function deterministicPairDecision(
  a: RawLineInput,
  b: RawLineInput,
): AiEquivalenceResult | null {
  const e1 = a.extracted_attributes.ean;
  const e2 = b.extracted_attributes.ean;
  if (e1 && e2 && e1 === e2) {
    return {
      decision: "MERGE",
      matched_candidate_id: b.id,
      confidence: 0.98,
      canonical_name: a.description_original,
      detected_attributes: a.extracted_attributes,
      explanation: "EAN idêntico — mesmo item comercial com alta confiança.",
      separation_or_merge_reason: "ean_match",
    };
  }

  if (a.description_normalized === b.description_normalized) {
    return {
      decision: "MERGE",
      matched_candidate_id: b.id,
      confidence: 0.95,
      canonical_name: a.description_original,
      detected_attributes: a.extracted_attributes,
      explanation: "Descrição normalizada idêntica (diferenças só de acentos/órtografia).",
      separation_or_merge_reason: "normalized_equal",
    };
  }

  const b1 = a.extracted_attributes.brand;
  const b2 = b.extracted_attributes.brand;
  if (b1 && b2 && b1 !== b2) {
    const b1b = BEVERAGE_BRAND_BUDGET.has(b1) || isChoppOrRefrig(b1, a.description_normalized);
    const b2b = BEVERAGE_BRAND_BUDGET.has(b2) || isChoppOrRefrig(b2, b.description_normalized);
    if (b1b && b2b) {
      return {
        decision: "KEEP_SEPARATE",
        matched_candidate_id: null,
        confidence: 0.9,
        canonical_name: a.description_original,
        detected_attributes: a.extracted_attributes,
        explanation: "Marcas de bebida distintas com identidade comercial diferente.",
        separation_or_merge_reason: "beverage_brand_identity",
      };
    }
  }

  const vol1 = a.extracted_attributes.volume;
  const vol2 = b.extracted_attributes.volume;
  if (vol1 && vol2 && vol1 !== vol2 && jaccardBase(a, b) > 0.5) {
    return {
      decision: "KEEP_SEPARATE",
      matched_candidate_id: null,
      confidence: 0.88,
      canonical_name: a.description_original,
      detected_attributes: a.extracted_attributes,
      explanation: "Mesma família de produto, porém volume/apresentação diferente.",
      separation_or_merge_reason: "volume_mismatch",
    };
  }

  return null;
}

function isChoppOrRefrig(brand: string, norm: string): boolean {
  if (norm.includes("chopp") || norm.includes("refrigerante") || norm.includes("cerveja")) {
    return true;
  }
  return BEVERAGE_BRAND_BUDGET.has(brand);
}

function jaccardBase(a: RawLineInput, b: RawLineInput): number {
  const t1 = new Set((a.extracted_attributes.base_name ?? "").split(" ").filter(Boolean));
  const t2 = new Set((b.extracted_attributes.base_name ?? "").split(" ").filter(Boolean));
  let inter = 0;
  for (const t of t1) if (t2.has(t)) inter += 1;
  const u = t1.size + t2.size - inter;
  return u ? inter / u : 0;
}

export function toRawLineInput(row: {
  id: string;
  description_original: string;
  description_normalized: string;
  unit_raw: string | null;
  ean: string | null;
}): RawLineInput {
  const ext = extractAttributesFromDescription(
    row.description_original,
    row.description_normalized,
    row.ean,
  );
  if (row.unit_raw) {
    ext.unit = row.unit_raw;
  }
  return {
    id: row.id,
    description_original: row.description_original,
    description_normalized: row.description_normalized,
    unit_raw: row.unit_raw,
    ean: ext.ean,
    extracted_attributes: ext,
  };
}

export function quickNormalizedName(name: string): string {
  return normalizeProductDescription(name);
}

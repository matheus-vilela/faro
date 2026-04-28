export type ReconcileDecision =
  | "MERGE"
  | "KEEP_SEPARATE"
  | "REVIEW_REQUIRED";

export type MergeStrength =
  | "HIGH_CONFIDENCE_AUTO"
  | "MEDIUM_CONFIDENCE_REVIEW"
  | "LOW_CONFIDENCE_REVIEW";

export type DetectedAttributes = {
  base_name: string | null;
  brand: string | null;
  volume: string | null;
  unit: string | null;
  packaging: string | null;
  pack_qty: string | null;
  flavor_variant: string | null;
  supplier_hint: string | null;
  ean: string | null;
  domain_terms: string[];
};

export type AiEquivalenceResult = {
  decision: ReconcileDecision;
  matched_candidate_id: string | null;
  confidence: number;
  canonical_name: string;
  detected_attributes: DetectedAttributes;
  explanation: string;
  separation_or_merge_reason: string;
};

export type RawLineInput = {
  id: string;
  description_original: string;
  description_normalized: string;
  unit_raw: string | null;
  ean: string | null;
  extracted_attributes: DetectedAttributes;
};

export type CandidatePair = {
  a: RawLineInput;
  b: RawLineInput;
  blocking_reason: string;
};

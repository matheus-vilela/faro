/**
 * Textos e códigos de pendência para importação XML em lote (`process-import-job-batch`).
 * Mantém import_job_items.pending_reason e import_review_pending alinhados ao matcher.
 */

export type BatchImportReviewPendingCopy = {
  title: string;
  detail: string;
  reason_code: string;
};

export type BatchImportReviewCopy = BatchImportReviewPendingCopy;

const STATUS_DETAIL_FALLBACK: Record<string, string> = {
  PENDING_USER_CONFIRM:
    "O sistema encontrou um produto candidato, mas a confiança ou sinais da linha exigem confirmação humana.",
  UNIT_CONFLICT_PENDING:
    "A unidade da nota não bate com a unidade do produto no cadastro (ou não há conversão automática).",
  UNIT_VALIDATION_REQUIRED:
    "A unidade informada na linha precisa ser validada ou mapeada antes de dar entrada no estoque.",
  NEW_PRODUCT_STAGED: "Produto novo em análise; finalize o vínculo ou o cadastro antes da entrada.",
  AUTO_MATCH: "",
  USER_CONFIRMED_MATCH: "",
  NEW_PRODUCT_CREATED: "",
};

/** Rótulo curto para filtros / badges na UI. */
export function batchImportPendingStatusLabel(status: string): string {
  const s = String(status ?? "").trim();
  const labels: Record<string, string> = {
    PENDING_USER_CONFIRM: "Confirmação de vínculo",
    UNIT_CONFLICT_PENDING: "Conflito de unidade",
    UNIT_VALIDATION_REQUIRED: "Validação de unidade",
    NEW_PRODUCT_STAGED: "Produto novo",
    AUTO_MATCH: "Automático",
    USER_CONFIRMED_MATCH: "Confirmado",
    NEW_PRODUCT_CREATED: "Criado",
  };
  return labels[s] ?? "Revisão de linha";
}

export function importJobItemPendingReason(
  pm: Record<string, unknown> | undefined,
): string {
  const st = String(pm?.resolutionStatus ?? "").trim();
  if (st && batchImportPendingStatusLabel(st) !== "Revisão de linha") {
    return batchImportPendingStatusLabel(st);
  }
  const mr = String(pm?.matchReason ?? "").trim();
  if (mr) return mr.length > 240 ? `${mr.slice(0, 237)}…` : mr;
  return "Revisão do vínculo de produto";
}

export function batchImportReviewPendingTitleDetail(params: {
  productName: string;
  pm: Record<string, unknown> | undefined;
  /** Quando não há productId após findOrCreate */
  missingProduct: boolean;
}): BatchImportReviewPendingCopy {
  const name = String(params.productName ?? "").trim() || "Item";
  const pm = params.pm;
  const st = String(pm?.resolutionStatus ?? "").trim() || "UNKNOWN";
  const label = batchImportPendingStatusLabel(st);
  const title = params.missingProduct
    ? `Sem produto resolvido — ${name}`
    : `${label} — ${name}`;

  const mr = String(pm?.matchReason ?? "").trim();
  const fallback = STATUS_DETAIL_FALLBACK[st] ??
    "Revise o vínculo com o catálogo e a unidade antes de dar entrada no estoque.";
  const detail = mr || fallback;

  return {
    title,
    detail: detail.length > 600 ? `${detail.slice(0, 597)}…` : detail,
    reason_code: params.missingProduct ? "MISSING_PRODUCT" : st,
  };
}

/** Subconjunto seguro do productMatch para JSON em `import_review_pending.payload`. */
/**
 * Linha ainda precisa de intervenção humana no catálogo / vínculo de produto
 * (paridade com o que o dashboard conta em `import_review_pending`).
 */
export function lineNeedsCatalogProductReview(params: {
  resolution: string;
  productId: string | null | undefined;
  pm: Record<string, unknown> | undefined;
}): boolean {
  const r = String(params.resolution ?? "").trim();
  if (r === "SKIPPED") return false;
  const pid = String(params.productId ?? "").trim();
  const st = String(params.pm?.resolutionStatus ?? "").trim();
  if (
    st === "UNIT_CONFLICT_PENDING" ||
    st === "UNIT_VALIDATION_REQUIRED" ||
    st === "PENDING_USER_CONFIRM" ||
    st === "NEW_PRODUCT_STAGED"
  ) {
    return true;
  }
  if (params.pm?.needsConfirmation === true) return true;
  if (r === "PENDING_REVIEW") return true;
  if (!pid) return true;
  return false;
}

export function compactProductMatchForPendingPayload(
  pm: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!pm) return {};
  const pick = [
    "resolutionStatus",
    "decisionPath",
    "needsConfirmation",
    "resolvedProductId",
    "suggestedProductId",
    "suggestedProductName",
    "suggestedScore",
    "matchReason",
    "invoiceUnitNormalized",
    "catalogUnitNormalized",
    "unitConvertible",
    "borderlineLlmSuggestedName",
    "borderlineLlmRationale",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of pick) {
    if (pm[k] !== undefined) out[k] = pm[k];
  }
  return out;
}

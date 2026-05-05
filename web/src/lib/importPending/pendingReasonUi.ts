/**
 * Rótulos alinhados a `batchImportPendingMessaging` (importação XML em lote).
 * Duplicado aqui para não acoplar o bundle web às edge functions Deno.
 */

export function importPendingReasonBadgeLabel(reasonCode: string | null | undefined): string {
  const c = String(reasonCode ?? "").trim();
  const m: Record<string, string> = {
    PENDING_USER_CONFIRM: "Confirmação de vínculo",
    UNIT_CONFLICT_PENDING: "Conflito de unidade",
    UNIT_VALIDATION_REQUIRED: "Validação de unidade",
    NEW_PRODUCT_STAGED: "Produto novo",
    MISSING_PRODUCT: "Sem produto resolvido",
    AUTO_MATCH: "Automático",
    UNKNOWN: "Revisão",
  };
  return m[c] || (c ? c.replace(/_/g, " ") : "Revisão de linha");
}

export function readPendingPayloadReasonCode(
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) return null;
  const direct = String(payload.reason_code ?? "").trim();
  if (direct) return direct;
  const pm = payload.productMatch as Record<string, unknown> | undefined;
  const st = pm && String(pm.resolutionStatus ?? "").trim();
  return st || null;
}

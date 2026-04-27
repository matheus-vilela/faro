/**
 * Limiares de decisão para vínculo produto × linha de nota (importação).
 * Valores em escala 0–100 (percentual de similaridade).
 *
 * - autoMatchMinScore: ≥ este valor + unidade compatível → vínculo automático.
 * - confirmMinScore: entre este e autoMatchMinScore−1 → pedir confirmação.
 * - Abaixo de confirmMinScore → tratar como produto novo (sem sugestão forte).
 *
 * Podem ser sobrescritos por linha em `company_product_import_settings` (Supabase).
 */
export const DEFAULT_IMPORT_MATCH_THRESHOLDS = {
  autoMatchMinScore: 80,
  confirmMinScore: 80,
} as const

export type ImportMatchThresholds = {
  autoMatchMinScore: number
  confirmMinScore: number
}

export function clampThresholds(t: Partial<ImportMatchThresholds>): ImportMatchThresholds {
  const auto = Math.min(
    100,
    Math.max(0, Number(t.autoMatchMinScore ?? DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore)),
  )
  let conf = Math.min(
    100,
    Math.max(0, Number(t.confirmMinScore ?? DEFAULT_IMPORT_MATCH_THRESHOLDS.confirmMinScore)),
  )
  if (conf > auto) conf = auto
  return { autoMatchMinScore: auto, confirmMinScore: conf }
}

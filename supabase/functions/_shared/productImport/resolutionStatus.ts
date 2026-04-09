/**
 * Status de resolução por linha na importação (auditoria / suporte).
 *
 * - AUTO_MATCH: vínculo automático (score + unidade ok, ou alias/equivalência).
 * - PENDING_USER_CONFIRM: similaridade intermediária ou sinais conflitantes — precisa humano.
 * - UNIT_CONFLICT_PENDING: produto candidato forte, mas unidade da nota ≠ cadastro (sem conversão automática).
 * - NEW_PRODUCT_STAGED: será criado produto novo ao finalizar (sem match confiável).
 * - USER_CONFIRMED_MATCH: usuário escolheu produto existente na tela de conferência.
 * - NEW_PRODUCT_CREATED: produto criado no finalize (RPC).
 */
export type ImportItemResolutionStatus =
  | "AUTO_MATCH"
  | "PENDING_USER_CONFIRM"
  | "UNIT_CONFLICT_PENDING"
  | "UNIT_VALIDATION_REQUIRED"
  | "NEW_PRODUCT_STAGED"
  | "USER_CONFIRMED_MATCH"
  | "NEW_PRODUCT_CREATED"

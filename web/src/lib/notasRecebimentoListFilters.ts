import { getNfeExpenseValueBreakdown } from "@/lib/expenseDivergenceUi";

export type NotasRecebimentoFilter =
  | "all"
  | "none"
  | "pending"
  | "confirmed"
  | "pending_receipt";

/** Listagens da tela: divergência, conferência pendente e já recebidas. */
export type NotasRecebimentoListSection =
  | "divergence"
  | "awaiting"
  | "received";

/** @deprecated Preferir NotasRecebimentoListSection. */
export type NotasRecebimentoListTab = NotasRecebimentoListSection;

export function parseRecebimentoListTab(
  value: string | null | undefined,
): NotasRecebimentoListTab {
  if (value === "received" || value === "divergence") return value;
  return "awaiting";
}

export function parseRecebimentoListSection(
  value: string | null | undefined,
): NotasRecebimentoListSection | null {
  if (value === "received" || value === "awaiting" || value === "divergence") {
    return value;
  }
  return null;
}

export type NotasBoletoFilter = "all" | "with" | "without";

export type NotasOrigemFilter = "all" | "whatsapp" | "manual";

export type NotasAtencaoFilter = "all" | "unlinked_product" | "value_risk";

export type RecebimentoListKind =
  | "none"
  | "pending"
  | "confirmed"
  | "pending_receipt";

export function recebimentoKindFromRow(input: {
  status: string;
  itemStatuses: Array<{ status: string }>;
}): RecebimentoListKind {
  if (input.status === "pending") return "pending";
  const isReceived = input.status === "received";
  const hasPendingReceipt =
    isReceived &&
    input.itemStatuses.some(
      (s) => s.status === "not_received" || s.status === "partial",
    );
  if (hasPendingReceipt) return "pending_receipt";
  if (isReceived) return "confirmed";
  return "none";
}

export function filterIdsByRecebimento(
  expenseIds: string[],
  kindByExpenseId: Map<string, RecebimentoListKind>,
  filter: NotasRecebimentoFilter,
): string[] {
  if (filter === "all") return expenseIds;
  return expenseIds.filter((id) => (kindByExpenseId.get(id) ?? "none") === filter);
}

export function recebimentoListSectionFromKind(
  kind: RecebimentoListKind,
): NotasRecebimentoListSection {
  if (kind === "pending_receipt") return "divergence";
  if (kind === "confirmed") return "received";
  return "awaiting";
}

export function isAwaitingRecebimentoKind(kind: RecebimentoListKind): boolean {
  return recebimentoListSectionFromKind(kind) === "awaiting";
}

export function filterIdsByRecebimentoSection(
  expenseIds: string[],
  kindByExpenseId: Map<string, RecebimentoListKind>,
  section: NotasRecebimentoListSection,
): string[] {
  return expenseIds.filter(
    (id) =>
      recebimentoListSectionFromKind(kindByExpenseId.get(id) ?? "none") ===
      section,
  );
}

export function filterIdsByRecebimentoTab(
  expenseIds: string[],
  kindByExpenseId: Map<string, RecebimentoListKind>,
  tab: NotasRecebimentoListTab,
): string[] {
  return filterIdsByRecebimentoSection(expenseIds, kindByExpenseId, tab);
}

export function filterIdsByBoleto(
  expenseIds: string[],
  expenseIdsWithBoleto: Set<string>,
  filter: NotasBoletoFilter,
): string[] {
  if (filter === "all") return expenseIds;
  return expenseIds.filter((id) =>
    filter === "with"
      ? expenseIdsWithBoleto.has(id)
      : !expenseIdsWithBoleto.has(id),
  );
}

export function expenseHasUnlinkedProduct(
  items: Array<{ product_id?: string | null }> | null | undefined,
): boolean {
  return (items ?? []).some((it) => !it.product_id);
}

export function expenseHasValueRisk(input: {
  documentTotal: number | null | undefined;
  items: Array<{ quantity: number; unit_value: number }> | null | undefined;
  financialReconciliationJson?: Record<string, unknown> | null;
}): boolean {
  const sumItems =
    input.items?.reduce(
      (s, it) => s + Number(it.quantity) * Number(it.unit_value),
      0,
    ) ?? 0;
  return getNfeExpenseValueBreakdown({
    documentTotal: input.documentTotal,
    sumItems,
    financialReconciliationJson: input.financialReconciliationJson ?? null,
  }).needsAttention;
}

export type ManualRegistrationMode = "single" | "batch" | "technical_sheet";

export type ManualMovementKind = "entry" | "exit" | "inventory";

export type EntryClassification = "purchase" | "production" | "transfer";

export type ExitClassification =
  | "sale"
  | "production"
  | "internal_consumption"
  | "transfer"
  | "loss";

export type ManualClassification = EntryClassification | ExitClassification;

export const MANUAL_MOVEMENT_KIND_OPTIONS: {
  value: ManualMovementKind;
  label: string;
}[] = [
  { value: "entry", label: "Entrada" },
  { value: "exit", label: "Saída" },
  { value: "inventory", label: "Inventário (Contagem)" },
];

export const ENTRY_CLASSIFICATION_OPTIONS: {
  value: EntryClassification;
  label: string;
}[] = [
  { value: "purchase", label: "Despesa" },
  { value: "production", label: "Produção" },
  { value: "transfer", label: "Transferência" },
];

export const EXIT_CLASSIFICATION_OPTIONS: {
  value: ExitClassification;
  label: string;
}[] = [
  { value: "sale", label: "Venda" },
  { value: "production", label: "Produção" },
  { value: "internal_consumption", label: "Consumo interno" },
  { value: "transfer", label: "Transferência" },
  { value: "loss", label: "Perda" },
];

export const MANUAL_CLASSIFICATION_LABELS: Record<string, string> = {
  purchase: "Despesa",
  production: "Produção",
  transfer: "Transferência",
  sale: "Venda",
  internal_consumption: "Consumo interno",
  loss: "Perda",
};

export function manualClassificationLabel(
  classification: string | null | undefined,
): string | null {
  if (!classification?.trim()) return null;
  return MANUAL_CLASSIFICATION_LABELS[classification] ?? classification;
}

export type ManualStockMovementMetadata = {
  registration_mode?: string;
  registered_by_user_id?: string;
  registered_by_name?: string;
  classification?: string;
  movement_kind?: string;
  quantity_unit?: string;
};

/** Lançamento manual via sheet (única ou em lote). */
export function isManuallyRegisteredStockMovement(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const mode = (metadata as ManualStockMovementMetadata).registration_mode;
  return mode === "single" || mode === "batch";
}

export function manualStockMovementRegisteredByLabel(
  metadata: unknown,
): string | null {
  if (!isManuallyRegisteredStockMovement(metadata)) return null;
  const m = metadata as ManualStockMovementMetadata;
  const name = m.registered_by_name?.trim();
  if (name) return name;
  return null;
}

export function computeManualMovementDelta(
  kind: ManualMovementKind,
  signedInputQuantity: number,
  baseQuantityMagnitude: number,
): number {
  const base = Math.abs(baseQuantityMagnitude);
  if (kind === "entry") return base;
  if (kind === "exit") return -base;
  return signedInputQuantity >= 0 ? base : -base;
}

export function convertUnitPriceToStockUnit(
  pricePerInputUnit: number,
  inputQuantity: number,
  stockQuantity: number,
): number | null {
  if (
    !Number.isFinite(pricePerInputUnit) ||
    !Number.isFinite(inputQuantity) ||
    !Number.isFinite(stockQuantity) ||
    inputQuantity <= 0 ||
    stockQuantity <= 0
  ) {
    return null;
  }
  const totalValue = pricePerInputUnit * inputQuantity;
  return totalValue / stockQuantity;
}

export function todayDateInputValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateInputToIsoMidday(date: string): string {
  return new Date(`${date}T12:00:00`).toISOString();
}

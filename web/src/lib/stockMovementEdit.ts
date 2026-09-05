import { isManuallyRegisteredStockMovement } from "@/lib/manualStockMovement";
import type { StockMovementProductMergeMeta } from "@/types/productMergeAudit";

export type StockMovementEditMetadata = StockMovementProductMergeMeta & {
  quantity_unit?: string;
  input_quantity?: number;
  input_unit_code?: string;
  registration_mode?: string;
  registered_by_user_id?: string;
  registered_by_name?: string;
  classification?: string;
  movement_kind?: string;
  movement_at?: string;
  unit_price_input?: number;
  last_edit?: unknown;
};

export type StockMovementEditRow = {
  id: string;
  product_id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  unit_cost: number | null;
  metadata_json: StockMovementEditMetadata | null;
  expense_id?: string | null;
  products?: { name: string; unit: string } | null;
};

export type StockMovementEditMode =
  | "manual"
  | "expense"
  | "revenue"
  | "merge"
  | "readonly";

export function stockMovementEditMode(
  row: Pick<StockMovementEditRow, "reference_type" | "metadata_json">,
): StockMovementEditMode {
  const ref = (row.reference_type ?? "").trim().toLowerCase();
  if (ref === "product_merge" || ref === "product_merge_undo") return "merge";
  if (
    ref === "revenue_entry" ||
    ref === "revenue_entry_update" ||
    ref === "revenue_entry_delete"
  ) {
    return "revenue";
  }
  if (isManuallyRegisteredStockMovement(row.metadata_json)) return "manual";
  if (
    ref === "manual" ||
    ref === "waste" ||
    ref === "inventory_count"
  ) {
    const kind = row.metadata_json?.movement_kind?.trim();
    if (kind) return "manual";
  }
  if (
    ref === "expense_item" ||
    ref === "import_breakdown" ||
    ref === "expense"
  ) {
    return "expense";
  }
  return "readonly";
}

export function stockMovementIsEditable(
  row: Pick<StockMovementEditRow, "reference_type" | "metadata_json">,
): boolean {
  const mode = stockMovementEditMode(row);
  return mode === "manual" || mode === "expense";
}

export function stockMovementOriginLabel(
  row: Pick<StockMovementEditRow, "reference_type" | "metadata_json">,
): string {
  const ref = (row.reference_type ?? "").trim().toLowerCase();
  if (ref === "inventory_count") return "Contagem";
  if (
    ref === "nfe_staging_create" ||
    ref === "nfe_product_create" ||
    ref === "nfe_motor_create"
  ) {
    return "Nota fiscal";
  }
  const mode = stockMovementEditMode(row);
  if (mode === "manual") return "Manual";
  if (mode === "expense") return "Nota fiscal / despesa";
  if (mode === "revenue") return "Venda";
  if (mode === "merge") return "Unificação";
  return "Sistema";
}

/** Efeito no estoque: positivo = entrada. */
export function stockMovementSignedQuantity(
  type: string,
  quantity: number,
): number {
  const qty = Math.abs(Number(quantity));
  if (!Number.isFinite(qty)) return 0;
  return type.trim().toLowerCase() === "in" ? qty : -qty;
}

export function movementDateInputFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

import type { PendingNewProductConversion, PendingNewProductMeta } from "@/types/expense";

export type ExpenseItemVinculoKind = "linked" | "new_product" | "none";

export type ExpenseItemVinculoInput = {
  product_id?: string | null;
  import_resolution_status?: string | null;
  metadata_json?: {
    pending_new_product?: unknown;
  } | null;
};

export function parsePendingNewProduct(
  metadata: ExpenseItemVinculoInput["metadata_json"],
): PendingNewProductMeta | null {
  const raw = metadata?.pending_new_product;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  const unit = String(o.unit ?? "").trim().toLowerCase() || "un";
  if (!name) return null;
  const conversions: PendingNewProductConversion[] = [];
  if (Array.isArray(o.conversions)) {
    for (const item of o.conversions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const c = item as Record<string, unknown>;
      const primary_qty = Number(c.primary_qty);
      const secondary_qty = Number(c.secondary_qty);
      const primary_unit_code = String(c.primary_unit_code ?? "")
        .trim()
        .toLowerCase();
      const secondary_unit_code = String(c.secondary_unit_code ?? "")
        .trim()
        .toLowerCase();
      if (
        !Number.isFinite(primary_qty) ||
        !Number.isFinite(secondary_qty) ||
        primary_qty <= 0 ||
        secondary_qty <= 0 ||
        !primary_unit_code ||
        !secondary_unit_code
      ) {
        continue;
      }
      conversions.push({
        primary_qty,
        primary_unit_code,
        secondary_qty,
        secondary_unit_code,
      });
    }
  }
  return {
    name,
    unit,
    conversions,
    canonical_name:
      o.canonical_name == null || String(o.canonical_name).trim() === ""
        ? null
        : String(o.canonical_name).trim(),
    ncm:
      o.ncm == null || String(o.ncm).trim() === ""
        ? null
        : String(o.ncm).trim(),
  };
}

export function expenseItemVinculoKind(
  item: ExpenseItemVinculoInput,
): ExpenseItemVinculoKind {
  if (item.product_id) return "linked";
  if (
    item.import_resolution_status === "NEW_PRODUCT_STAGED" ||
    parsePendingNewProduct(item.metadata_json) != null
  ) {
    return "new_product";
  }
  return "none";
}

export function expenseItemVinculoLabel(kind: ExpenseItemVinculoKind): string {
  switch (kind) {
    case "linked":
      return "Vinculado";
    case "new_product":
      return "Novo no Faro";
    default:
      return "Sem vínculo";
  }
}

export function expenseItemVinculoBadgeClassName(
  kind: ExpenseItemVinculoKind,
): string {
  switch (kind) {
    case "linked":
      return "border-emerald-600/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100";
    case "new_product":
      return "border-sky-600/30 bg-sky-500/10 text-sky-950 dark:text-sky-100";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

export function expenseItemHasVinculo(item: ExpenseItemVinculoInput): boolean {
  return expenseItemVinculoKind(item) !== "none";
}

export function expenseIsReceived(expense: {
  recebimentos?:
    | { id?: string; status?: string | null }[]
    | { id?: string; status?: string | null }
    | null;
}): boolean {
  const rec = expense.recebimentos;
  const rows = Array.isArray(rec) ? rec : rec ? [rec] : [];
  return rows.some((r) => r.status === "received");
}

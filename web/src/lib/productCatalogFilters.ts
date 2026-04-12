/** Intervalo de `updated_at` para filtros do catálogo / exportação. */
export function updatedAtFilterBounds(
  preset: "all" | "today" | "7d" | "30d" | "custom",
  from: string,
  to: string,
): { gte?: string; lte?: string } | null {
  if (preset === "all") return null;
  const now = new Date();
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { gte: start.toISOString(), lte: end.toISOString() };
  }
  if (preset === "7d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { gte: start.toISOString(), lte: now.toISOString() };
  }
  if (preset === "30d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { gte: start.toISOString(), lte: now.toISOString() };
  }
  if (preset === "custom") {
    if (!from.trim() && !to.trim()) return null;
    const gte = from.trim()
      ? new Date(`${from.trim()}T00:00:00.000`).toISOString()
      : undefined;
    const lte = to.trim()
      ? new Date(`${to.trim()}T23:59:59.999`).toISOString()
      : undefined;
    if (!gte && !lte) return null;
    return { gte, lte };
  }
  return null;
}

export type ProductExportFilterState = {
  search: string;
  filterCategoryId: string;
  filterActive: "all" | "active" | "inactive";
  filterComposesCmv: "all" | "yes" | "no";
  filterUpdatedPreset: "all" | "today" | "7d" | "30d" | "custom";
  filterUpdatedFrom: string;
  filterUpdatedTo: string;
  filterStockAlert: "all" | "zero" | "below_min" | "any";
  lowStockOnly: boolean;
};

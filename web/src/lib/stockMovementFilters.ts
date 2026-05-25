export type MovementDirectionFilter = "all" | "in" | "out";

/** @deprecated use MovementDirectionFilter */
export type MovementActionFilter = MovementDirectionFilter;

type FilterableQuery = {
  eq: (column: string, value: string) => FilterableQuery;
  or: (filters: string) => FilterableQuery;
};

/** Filtro Tipo: somente entrada ou saída (perda conta como saída). */
export function applyStockMovementDirectionFilter<T extends FilterableQuery>(
  query: T,
  directionFilter: MovementDirectionFilter,
): T {
  if (directionFilter === "all") return query;
  if (directionFilter === "in") return query.eq("type", "in") as T;
  return query.or("type.eq.out,type.eq.waste") as T;
}

/** @deprecated use applyStockMovementDirectionFilter */
export function applyStockMovementActionFilter<T extends FilterableQuery>(
  query: T,
  actionFilter: MovementDirectionFilter,
): T {
  return applyStockMovementDirectionFilter(query, actionFilter);
}

export function isWasteStockMovement(row: {
  type: string;
  reference_type: string | null;
}): boolean {
  return row.type === "waste" || row.reference_type === "waste";
}

export function stockMovementTypeLabel(row: {
  type: string;
  reference_type: string | null;
  metadata_json?: { movement_kind?: string } | null;
}): "Entrada" | "Saída" {
  if (row.type === "in") return "Entrada";
  return "Saída";
}

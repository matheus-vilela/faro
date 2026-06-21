export type MovementDirectionFilter = "all" | "in" | "out";

/** @deprecated use MovementDirectionFilter */
export type MovementActionFilter = MovementDirectionFilter;

export type FilterableQuery = {
  eq: (column: string, value: string) => FilterableQuery;
  or: (filters: string) => FilterableQuery;
};

/** Filtro Tipo: somente entrada ou saída (perda conta como saída). */
export function applyStockMovementDirectionFilter(
  query: FilterableQuery,
  directionFilter: MovementDirectionFilter,
): FilterableQuery {
  if (directionFilter === "all") return query;
  if (directionFilter === "in") return query.eq("type", "in");
  return query.or("type.eq.out,type.eq.waste");
}

/** @deprecated use applyStockMovementDirectionFilter */
export function applyStockMovementActionFilter(
  query: FilterableQuery,
  actionFilter: MovementDirectionFilter,
): FilterableQuery {
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

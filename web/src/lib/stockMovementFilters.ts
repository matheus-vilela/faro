export type MovementDirectionFilter = "all" | "in" | "out";

/** @deprecated use MovementDirectionFilter */
export type MovementActionFilter = MovementDirectionFilter;

export type FilterableQuery = {
  eq: (column: string, value: string) => FilterableQuery;
  or: (filters: string) => FilterableQuery;
  not?: (column: string, operator: string, value: string) => FilterableQuery;
};

/** Filtro Tipo: somente entrada ou saída (perda conta como saída). Unificação fica de fora. */
export function applyStockMovementDirectionFilter<T extends FilterableQuery>(
  query: T,
  directionFilter: MovementDirectionFilter,
): FilterableQuery {
  if (directionFilter === "all") return query;
  if (directionFilter === "in") {
    let next = query.eq("type", "in") as T;
    if (query.not) {
      next = query.not("reference_type", "eq", "product_merge") as T;
    }
    return next;
  }
  let next = query.or("type.eq.out,type.eq.waste") as T;
  if (query.not) {
    next = query.not("reference_type", "eq", "product_merge_undo") as T;
  }
  return next;
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

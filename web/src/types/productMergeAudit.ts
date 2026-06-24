export type ProductMergeAffected = {
  stock_movement_ids: string[];
  expense_item_ids: string[];
  revenue_entry_ids: string[];
  purchase_order_item_ids: string[];
  recipe_ingredient_ids: string[];
  recipe_output_ids: string[];
  inventory_count_listing_ids_reassigned: string[];
  inventory_count_listing_ids_removed: string[];
  category_assignment_ids: string[];
  operational_config_id: string | null;
};

export type ProductMergeStockMovementBefore = {
  quantity: number;
  product_id: string;
};

export type ProductMergeEvent = {
  id: string;
  merged_at: string;
  merged_by: string | null;
  loser_id: string;
  loser_name: string;
  loser_snapshot: Record<string, unknown>;
  winner_before: Record<string, unknown>;
  loser_to_winner_factor: number;
  merged_unit_conversions: unknown;
  stock_delta_winner_unit: number;
  affected: ProductMergeAffected;
  loser_operational_config?: Record<string, unknown> | null;
  stock_movements_before: Record<string, ProductMergeStockMovementBefore>;
  aliases_added: {
    merged_catalog_names: string[];
    import_equivalence_keys: string[];
    invoice_line_labels: string[];
  };
  merge_movement_id: string | null;
  undo_movement_id?: string | null;
  undone_at: string | null;
  undone_by: string | null;
};

export type ExpenseItemProductMergeMeta = {
  event_id: string;
  merged_at: string;
  from_product_id: string;
  from_product_name: string;
  to_product_id: string;
  loser_to_winner_factor?: number;
};

export function parseProductMergeAudit(raw: unknown): ProductMergeEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ProductMergeEvent =>
      item != null &&
      typeof item === "object" &&
      typeof (item as ProductMergeEvent).id === "string",
  );
}

export function activeProductMergeEvents(
  events: ProductMergeEvent[],
): ProductMergeEvent[] {
  return events.filter((e) => !e.undone_at);
}

export function findProductMergeEvent(
  events: ProductMergeEvent[],
  eventId: string,
): ProductMergeEvent | undefined {
  return events.find((e) => e.id === eventId);
}

export function isProductMergeReferenceType(
  referenceType: string | null | undefined,
): boolean {
  return (
    referenceType === "product_merge" || referenceType === "product_merge_undo"
  );
}

export type StockMovementProductMergeMeta = {
  movement_kind?: string;
  loser_id?: string;
  loser_name?: string;
  loser_to_winner_factor?: number;
  stock_delta_winner_unit?: number;
  undone_at?: string;
};

export function stockMovementMergeUndoProps(row: {
  reference_type: string | null;
  reference_id: string | null;
  metadata_json?: StockMovementProductMergeMeta | null;
}): {
  eventId: string | null;
  loserName: string | null;
  undoneAt: string | null;
} {
  if (row.reference_type !== "product_merge") {
    return { eventId: null, loserName: null, undoneAt: null };
  }
  return {
    eventId: row.reference_id,
    loserName: row.metadata_json?.loser_name ?? null,
    undoneAt: row.metadata_json?.undone_at ?? null,
  };
}

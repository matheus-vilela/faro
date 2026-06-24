import { describe, expect, it } from "vitest";
import {
  activeProductMergeEvents,
  findProductMergeEvent,
  isProductMergeReferenceType,
  parseProductMergeAudit,
  type ProductMergeEvent,
} from "@/types/productMergeAudit";

const sampleEvent: ProductMergeEvent = {
  id: "evt-1",
  merged_at: "2026-01-01T00:00:00.000Z",
  merged_by: "user-1",
  loser_id: "loser-1",
  loser_name: "Produto B",
  loser_snapshot: {},
  winner_before: {},
  loser_to_winner_factor: 1,
  merged_unit_conversions: [],
  stock_delta_winner_unit: 5,
  affected: {
    stock_movement_ids: [],
    expense_item_ids: [],
    revenue_entry_ids: [],
    purchase_order_item_ids: [],
    recipe_ingredient_ids: [],
    recipe_output_ids: [],
    inventory_count_listing_ids_reassigned: [],
    inventory_count_listing_ids_removed: [],
    category_assignment_ids: [],
    operational_config_id: null,
  },
  stock_movements_before: {},
  aliases_added: {
    merged_catalog_names: [],
    import_equivalence_keys: [],
    invoice_line_labels: [],
  },
  merge_movement_id: "mov-1",
  undone_at: null,
  undone_by: null,
};

describe("parseProductMergeAudit", () => {
  it("parses array of events", () => {
    expect(parseProductMergeAudit([sampleEvent])).toHaveLength(1);
  });

  it("returns empty for invalid input", () => {
    expect(parseProductMergeAudit(null)).toEqual([]);
    expect(parseProductMergeAudit([{ foo: 1 }])).toEqual([]);
  });
});

describe("activeProductMergeEvents", () => {
  it("filters undone events", () => {
    const undone = { ...sampleEvent, id: "evt-2", undone_at: "2026-02-01" };
    expect(activeProductMergeEvents([sampleEvent, undone])).toEqual([sampleEvent]);
  });
});

describe("findProductMergeEvent", () => {
  it("finds by id", () => {
    expect(findProductMergeEvent([sampleEvent], "evt-1")).toEqual(sampleEvent);
  });
});

describe("isProductMergeReferenceType", () => {
  it("detects merge reference types", () => {
    expect(isProductMergeReferenceType("product_merge")).toBe(true);
    expect(isProductMergeReferenceType("product_merge_undo")).toBe(true);
    expect(isProductMergeReferenceType("manual")).toBe(false);
  });
});

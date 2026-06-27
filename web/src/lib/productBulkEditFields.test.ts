import { describe, expect, it } from "vitest";
import {
  BULK_EDIT_FIELDS,
  buildBulkEditChangesPayload,
  bulkEditFieldLabel,
  formatBulkEditPreviewDisplay,
} from "@/lib/productBulkEditFields";
import { BULK_EDIT_ERROR_MESSAGES, BULK_EDIT_FIELD_KEYS } from "@/types/productBulkEdit";

describe("productBulkEditFields v1", () => {
  it("expõe exatamente os 6 campos do escopo v1", () => {
    expect(BULK_EDIT_FIELDS).toHaveLength(6);
    expect(BULK_EDIT_FIELDS.map((f) => f.key).sort()).toEqual(
      [...BULK_EDIT_FIELD_KEYS].sort(),
    );
  });

  it("bulkEditFieldLabel retorna label ou key", () => {
    expect(bulkEditFieldLabel("ncm")).toBe("NCM");
    expect(bulkEditFieldLabel("is_active")).toBe("Ativo no catálogo");
  });

  it("buildBulkEditChangesPayload monta payload por tipo", () => {
    expect(
      buildBulkEditChangesPayload("is_active", { boolValue: false }),
    ).toEqual({ value: false });

    expect(
      buildBulkEditChangesPayload("ncm", { textValue: " 12345678 " }),
    ).toEqual({ value: "12345678" });

    expect(
      buildBulkEditChangesPayload("product_categories", {
        categoryMode: "add",
        categoryIds: ["a", "b"],
      }),
    ).toEqual({ mode: "add", category_ids: ["a", "b"] });

    expect(
      buildBulkEditChangesPayload("cmv_category_id", { cmvCategoryId: null }),
    ).toEqual({ value: null });
  });

  it("formatBulkEditPreviewDisplay resolve nomes de categorias e CMV", () => {
    const lookups = {
      productCategoryNames: { "bf46d943-8f53": "Bebidas" },
      cmvCategoryNames: { "abc-123": "Insumos" },
    };

    expect(
      formatBulkEditPreviewDisplay(
        "product_categories",
        '["bf46d943-8f53"]',
        lookups,
      ),
    ).toBe("Bebidas");

    expect(
      formatBulkEditPreviewDisplay("product_categories", "[]", lookups),
    ).toBe("Nenhuma");

    expect(
      formatBulkEditPreviewDisplay("cmv_category_id", "abc-123", lookups),
    ).toBe("Insumos");

    expect(
      formatBulkEditPreviewDisplay("operational_type", "PRODUTO_REVENDA", lookups),
    ).toBe("Revenda");
  });
});

describe("BULK_EDIT_ERROR_MESSAGES", () => {
  it("mapeia códigos conhecidos do RPC", () => {
    expect(BULK_EDIT_ERROR_MESSAGES.forbidden).toContain("gestor");
    expect(BULK_EDIT_ERROR_MESSAGES.invalid_field).toContain("permitido");
    expect(BULK_EDIT_ERROR_MESSAGES.expired).toContain("24");
  });
});

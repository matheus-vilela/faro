import { describe, expect, it } from "vitest";
import {
  INTERMEDIATE_STOCK_CONTROL,
  isIntermediateProduct,
  produceErrorMessage,
} from "./productIntermediate";

describe("isIntermediateProduct", () => {
  it("reconhece INTERMEDIATE", () => {
    expect(isIntermediateProduct({ stock_control_type: INTERMEDIATE_STOCK_CONTROL })).toBe(
      true,
    );
  });

  it("rejeita ficha normal e estoque direto", () => {
    expect(isIntermediateProduct({ stock_control_type: "RECIPE_CONTROLLED" })).toBe(
      false,
    );
    expect(isIntermediateProduct({ stock_control_type: "DIRECT" })).toBe(false);
    expect(isIntermediateProduct({ stock_control_type: null })).toBe(false);
  });
});

describe("produceErrorMessage", () => {
  it("traduz códigos conhecidos", () => {
    expect(produceErrorMessage("not_intermediate")).toMatch(/intermediário/i);
    expect(produceErrorMessage("invalid_quantity")).toMatch(/quantidade/i);
  });
});

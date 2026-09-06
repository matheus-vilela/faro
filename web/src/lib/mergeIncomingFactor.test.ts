import { describe, expect, it } from "vitest";
import {
  emptyIncomingFactor,
  incomingEffectiveFactor,
} from "@/lib/mergeIncomingFactor";
import type { Product } from "@/types/product";

function product(id: string, unit: string): Product {
  return {
    id,
    company_id: "c",
    name: id,
    sku: null,
    unit,
    min_quantity: 0,
    current_quantity: 10,
    last_unit_value: null,
  };
}

describe("incomingEffectiveFactor", () => {
  it("mesma unidade entra 1:1", () => {
    expect(
      incomingEffectiveFactor(
        product("pdv", "un"),
        product("nf", "un"),
        [],
        emptyIncomingFactor(),
      ),
    ).toBe(1);
  });

  it("proporção manual: qty winner / qty loser", () => {
    const draft = emptyIncomingFactor();
    draft.factorMode = "manual";
    draft.manualLoserQty = "2";
    draft.manualWinnerQty = "1";
    expect(
      incomingEffectiveFactor(
        product("pdv", "un"),
        product("nf", "cx"),
        [],
        draft,
      ),
    ).toBe(0.5);
  });
});

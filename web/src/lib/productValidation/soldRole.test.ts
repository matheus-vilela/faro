import { describe, expect, it } from "vitest";
import {
  correlationRightTitle,
  defaultSoldRoleForSameItem,
  soldRoleHint,
} from "@/lib/productValidation/soldRole";

describe("soldRole", () => {
  it("começa em ficha quando o nome parece dose ou prato", () => {
    expect(defaultSoldRoleForSameItem(true)).toBe("recipe");
  });

  it("começa em unificar quando não há conflito com ficha", () => {
    expect(defaultSoldRoleForSameItem(false)).toBe("same_product");
  });

  it("explica que unificar é só produto com produto", () => {
    expect(soldRoleHint("same_product")).toMatch(/Só produto com produto/i);
  });

  it("a direita da ficha de produção é insumos, não nota para unificar", () => {
    expect(correlationRightTitle("intermediate")).toBe("Insumos da produção");
    expect(correlationRightTitle("recipe")).toBe("Insumos da ficha");
    expect(correlationRightTitle("same_product")).toBe("Produto");
  });
});

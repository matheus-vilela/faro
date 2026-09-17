import { describe, expect, it } from "vitest";
import {
  isExcludedSaleMixLeafName,
  isPaymentMethodCategoryName,
} from "./saleMixRevenueLeaves";

describe("saleMixRevenueLeaves", () => {
  it("reconhece folhas de pagamento e dump", () => {
    expect(isPaymentMethodCategoryName("Dinheiro")).toBe(true);
    expect(isPaymentMethodCategoryName("Pix")).toBe(true);
    expect(isExcludedSaleMixLeafName("Adiantamento")).toBe(true);
    expect(isExcludedSaleMixLeafName("Reservas")).toBe(true);
    expect(isExcludedSaleMixLeafName("VR / Alelo")).toBe(true);
  });

  it("mantém folhas de mix", () => {
    expect(isExcludedSaleMixLeafName("Vendas de bebidas")).toBe(false);
    expect(isExcludedSaleMixLeafName("Vendas de produtos")).toBe(false);
    expect(isPaymentMethodCategoryName("Cervejas")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  boletoCountsInCashFlow,
  boletoVisibleInFluxo,
  isRevenueTaxDeductionBoletoDescription,
} from "./boletoFluxo";

describe("boletoFluxo", () => {
  it("detecta taxas de receita operacional", () => {
    expect(
      isRevenueTaxDeductionBoletoDescription("Taxas/Deduções - Venda produtos"),
    ).toBe(true);
    expect(
      isRevenueTaxDeductionBoletoDescription("Despesa: Taxas/Deduções - Café"),
    ).toBe(true);
  });

  it("detecta ajuste de taxas em receita não operacional", () => {
    expect(
      isRevenueTaxDeductionBoletoDescription("Evento X - Taxas/deducoes"),
    ).toBe(true);
  });

  it("mantém receita bruta e despesa comum no fluxo", () => {
    expect(isRevenueTaxDeductionBoletoDescription("Venda balcão")).toBe(false);
    expect(
      boletoVisibleInFluxo({
        exclude_from_fluxo: false,
        description: "NF 123 — parcela 1",
      }),
    ).toBe(true);
    expect(
      boletoVisibleInFluxo({
        exclude_from_fluxo: true,
        description: "Qualquer",
      }),
    ).toBe(false);
  });

  it("mantém transferência visível na lista, mas fora da simulação de caixa", () => {
    expect(
      boletoVisibleInFluxo({
        exclude_from_fluxo: false,
        description: "Transferência reserva",
      }),
    ).toBe(true);
    expect(
      boletoCountsInCashFlow({
        exclude_from_fluxo: false,
        description: "Transferência reserva",
        entry_kind: "transfer",
      }),
    ).toBe(false);
    expect(
      boletoCountsInCashFlow({
        exclude_from_fluxo: false,
        description: "Energia",
        entry_kind: "standard",
      }),
    ).toBe(true);
  });
});

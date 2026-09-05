import { describe, expect, it } from "vitest";
import {
  lastPriceDisplayUnit,
  lastPriceNeedsConversion,
  lastPricePerStockUnit,
  lastPriceRecorded,
  stockQtyPerPriceUnit,
} from "@/lib/lastPricePerStockUnit";

const base = {
  id: "p1",
  company_id: "c1",
  unit: "un",
  last_unit_value: 48,
  last_unit_value_unit_code: "cx",
  unit_conversions: null as unknown,
};

const cxToUn = {
  primary_qty: 1,
  primary_unit_code: "cx",
  secondary_qty: 12,
  secondary_unit_code: "un",
};

const unToCx = {
  primary_qty: 1,
  primary_unit_code: "un",
  secondary_qty: 1 / 12,
  secondary_unit_code: "cx",
};

describe("stockQtyPerPriceUnit", () => {
  it("1 cx = 12 un", () => {
    expect(stockQtyPerPriceUnit("cx", "un", [cxToUn])).toBe(12);
  });

  it("1 un = 1/12 cx (hub de estoque)", () => {
    expect(stockQtyPerPriceUnit("cx", "un", [unToCx])).toBeCloseTo(12);
  });
});

describe("lastPricePerStockUnit", () => {
  it("não duplica quando o preço já é por unidade de estoque", () => {
    expect(
      lastPricePerStockUnit({
        ...base,
        unit: "cx",
        last_unit_value_unit_code: "cx",
      }),
    ).toBeNull();
  });

  it("aplica 48 por cx com 1 cx = 12 un → 4 por un", () => {
    expect(lastPricePerStockUnit(base, [cxToUn])).toBe(4);
  });

  it("aplica a mesma proporção se a conversão estiver no sentido do estoque", () => {
    expect(lastPricePerStockUnit(base, [unToCx])).toBeCloseTo(4);
  });

  it("ignora last_unit_value_stock e usa a conversão", () => {
    expect(
      lastPricePerStockUnit(
        { ...base, last_unit_value_stock: 48 } as typeof base & {
          last_unit_value_stock: number;
        },
        [cxToUn],
      ),
    ).toBe(4);
  });

  it("converte kg → g do sistema", () => {
    expect(
      lastPricePerStockUnit({
        ...base,
        unit: "g",
        last_unit_value: 50,
        last_unit_value_unit_code: "kg",
      }),
    ).toBeCloseTo(0.05);
  });

  it("some sem preço", () => {
    expect(
      lastPricePerStockUnit({ ...base, last_unit_value: null }),
    ).toBeNull();
  });
});

describe("lastPriceNeedsConversion", () => {
  it("pede conversão quando cx não tem regra para un", () => {
    expect(lastPriceNeedsConversion(base, [])).toBe(true);
  });

  it("não pede se a conversão já existe", () => {
    expect(lastPriceNeedsConversion(base, [cxToUn])).toBe(false);
  });

  it("não pede em kg → g do sistema", () => {
    expect(
      lastPriceNeedsConversion({
        ...base,
        unit: "g",
        last_unit_value: 50,
        last_unit_value_unit_code: "kg",
      }),
    ).toBe(false);
  });
});

describe("lastPriceRecorded / lastPriceDisplayUnit", () => {
  it("lê o valor e a unidade gravados", () => {
    expect(lastPriceRecorded(base)).toBe(48);
    expect(lastPriceDisplayUnit(base)).toBe("cx");
  });
});

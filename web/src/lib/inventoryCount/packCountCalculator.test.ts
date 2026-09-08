import { describe, expect, it } from "vitest";
import { allowedUnitsForPublicCount } from "./conversionHint";
import {
  DEFAULT_UNITS_PER_PACK,
  formatPackCountExpression,
  formatPackCountQty,
  packCountLabels,
  packCountTotal,
  resolvePackCountContext,
  unitsPerPackFromAllowedUnits,
} from "./packCountCalculator";

const CX_UN = [
  {
    code: "un",
    hint: null,
    qty_in_hub: 1,
  },
  {
    code: "cx",
    hint: "1 cx = 12 un",
    qty_in_hub: 12,
  },
];

describe("packCountTotal", () => {
  it("soma caixas × por caixa + avulsas na unidade de estoque", () => {
    expect(
      packCountTotal({ boxes: 2, perBox: 12, loose: 3, hubIsPack: false }),
    ).toBe(27);
  });

  it("quando o hub já é caixa, total = caixas + avulsas / por caixa", () => {
    expect(
      packCountTotal({ boxes: 2, perBox: 12, loose: 3, hubIsPack: true }),
    ).toBe(2.25);
  });

  it("rejeita por caixa zero ou negativo", () => {
    expect(
      packCountTotal({ boxes: 1, perBox: 0, loose: 0, hubIsPack: false }),
    ).toBeNull();
  });
});

describe("unitsPerPackFromAllowedUnits", () => {
  it("usa qty_in_hub da caixa quando o hub é un", () => {
    expect(unitsPerPackFromAllowedUnits("un", "cx", CX_UN)).toEqual({
      value: 12,
      fromConversion: true,
    });
  });

  it("inverte 1 un = 1/N cx quando o hub já é caixa", () => {
    const units = [
      { code: "cx", hint: null, qty_in_hub: 1 },
      { code: "un", hint: "1 un = 0,0833 cx", qty_in_hub: 1 / 12 },
    ];
    const got = unitsPerPackFromAllowedUnits("cx", "cx", units);
    expect(got.fromConversion).toBe(true);
    expect(got.value).toBe(12);
  });

  it("cai no padrão 12 sem conversão", () => {
    expect(unitsPerPackFromAllowedUnits("un", "cx", [{ code: "un" }])).toEqual({
      value: DEFAULT_UNITS_PER_PACK,
      fromConversion: false,
    });
  });

  it("lê o hint se qty_in_hub não vier", () => {
    expect(
      unitsPerPackFromAllowedUnits("un", "cx", [
        { code: "un" },
        { code: "cx", hint: "1 cx = 24 un" },
      ]),
    ).toEqual({ value: 24, fromConversion: true });
  });
});

describe("resolvePackCountContext", () => {
  it("prefere cx a pct", () => {
    const ctx = resolvePackCountContext("un", [
      { code: "un", qty_in_hub: 1 },
      { code: "pct", qty_in_hub: 6 },
      { code: "cx", qty_in_hub: 12 },
    ]);
    expect(ctx.packCode).toBe("cx");
    expect(ctx.unitsPerPack).toBe(12);
    expect(ctx.hubIsPack).toBe(false);
    expect(ctx.labels.title).toBe("Contar em caixas");
  });

  it("usa o hub quando o estoque já é caixa", () => {
    const ctx = resolvePackCountContext("cx", [
      { code: "cx", qty_in_hub: 1 },
      { code: "un", qty_in_hub: 1 / 12 },
    ]);
    expect(ctx.packCode).toBe("cx");
    expect(ctx.hubIsPack).toBe(true);
  });

  it("alinha com allowedUnitsForPublicCount", () => {
    const conversions = [
      {
        primary_unit_code: "un",
        primary_qty: 12,
        secondary_unit_code: "cx",
        secondary_qty: 1,
      },
    ];
    const units = allowedUnitsForPublicCount("un", conversions);
    const ctx = resolvePackCountContext("un", units);
    expect(ctx.unitsPerPack).toBe(12);
    expect(ctx.fromConversion).toBe(true);
  });
});

describe("packCountLabels", () => {
  it("rotula pacote e fardo", () => {
    expect(packCountLabels("pct").title).toBe("Contar em pacotes");
    expect(packCountLabels("fd").perPack).toBe("Por fardo");
  });
});

describe("formatPackCountExpression", () => {
  it("mostra caixas × fator + avulsas", () => {
    expect(
      formatPackCountExpression({
        boxes: 2,
        perBox: 12,
        loose: 3,
        hubIsPack: false,
      }),
    ).toBe("2 × 12 + 3 =");
  });

  it("omite avulsas zeradas", () => {
    expect(
      formatPackCountExpression({
        boxes: 0,
        perBox: 12,
        loose: 0,
        hubIsPack: false,
      }),
    ).toBe("0 × 12 =");
  });
});

describe("formatPackCountQty", () => {
  it("evita casas inúteis", () => {
    expect(formatPackCountQty(27)).toBe("27");
    expect(formatPackCountQty(2.25)).toBe("2.25");
  });
});

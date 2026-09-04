import { describe, expect, it } from "vitest";
import {
  allowedUnitsForPublicCount,
  conversionHintForUnit,
  convertTypedQtyToHub,
} from "./conversionHint";

const CX_TO_UN = [
  {
    primary_unit_code: "un",
    primary_qty: 12,
    secondary_unit_code: "cx",
    secondary_qty: 1,
  },
];

describe("conversionHintForUnit", () => {
  it("mostra 1 cx = 12 un sem o estoque esperado", () => {
    expect(conversionHintForUnit("cx", "un", CX_TO_UN)).toBe("1 cx = 12 un");
  });

  it("não mostra hint na unidade de estoque", () => {
    expect(conversionHintForUnit("un", "un", CX_TO_UN)).toBeNull();
  });
});

describe("allowedUnitsForPublicCount", () => {
  it("inclui hub e conversões cadastradas", () => {
    const units = allowedUnitsForPublicCount("un", CX_TO_UN);
    const codes = units.map((u) => u.code);
    expect(codes).toContain("un");
    expect(codes).toContain("cx");
    expect(units.find((u) => u.code === "cx")?.hint).toBe("1 cx = 12 un");
  });
});

describe("convertTypedQtyToHub", () => {
  it("persiste a quantidade na unidade de estoque", () => {
    expect(convertTypedQtyToHub(2, "cx", "un", CX_TO_UN)).toBe(24);
    expect(convertTypedQtyToHub(5, "un", "un", CX_TO_UN)).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildMergedUnitConversionsForMerge,
  resolveMergeUnitFactor,
} from "@/lib/mergeProductUnits";

describe("resolveMergeUnitFactor", () => {
  it("mesma unidade de estoque → fator 1", () => {
    const r = resolveMergeUnitFactor({
      winnerHub: "un",
      winnerConversions: [],
      loserHub: "un",
      loserConversions: [],
    });
    expect(r).toEqual({ kind: "same", factor: 1 });
  });

  it("UN + L via litro (exemplo do usuário)", () => {
    const r = resolveMergeUnitFactor({
      winnerHub: "l",
      winnerConversions: [
        {
          primary_unit_code: "l",
          primary_qty: 1,
          secondary_unit_code: "un",
          secondary_qty: 1,
        },
        {
          primary_unit_code: "l",
          primary_qty: 1,
          secondary_unit_code: "cx",
          secondary_qty: 24,
        },
      ],
      loserHub: "un",
      loserConversions: [
        {
          primary_unit_code: "un",
          primary_qty: 1,
          secondary_unit_code: "ml",
          secondary_qty: 300,
        },
        {
          primary_unit_code: "un",
          primary_qty: 1,
          secondary_unit_code: "l",
          secondary_qty: 0.3,
        },
      ],
    });
    expect(r.kind).toBe("auto");
    if (r.kind === "auto") {
      expect(r.factor).toBeCloseTo(0.3, 6);
      expect(10 * r.factor).toBeCloseTo(3, 6);
    }
  });

  it("sem ponte entre dimensões → manual", () => {
    const r = resolveMergeUnitFactor({
      winnerHub: "cx",
      winnerConversions: [
        {
          primary_unit_code: "cx",
          primary_qty: 1,
          secondary_unit_code: "un",
          secondary_qty: 12,
        },
      ],
      loserHub: "kg",
      loserConversions: [
        {
          primary_unit_code: "kg",
          primary_qty: 1,
          secondary_unit_code: "g",
          secondary_qty: 1000,
        },
      ],
    });
    expect(r.kind).toBe("manual");
  });
});

describe("buildMergedUnitConversionsForMerge", () => {
  it("rebaseia conversões do removido para o hub do vencedor", () => {
    const merged = buildMergedUnitConversionsForMerge({
      winnerHub: "l",
      winnerConversions: [
        {
          primary_unit_code: "l",
          primary_qty: 1,
          secondary_unit_code: "un",
          secondary_qty: 1,
        },
      ],
      loserHub: "un",
      loserConversions: [
        {
          primary_unit_code: "un",
          primary_qty: 1,
          secondary_unit_code: "l",
          secondary_qty: 0.3,
        },
      ],
      loserToWinnerFactor: 0.3,
    });
    const unRow = merged.find(
      (r) => r.secondary_unit_code.toLowerCase() === "un",
    );
    expect(unRow).toBeDefined();
    expect(unRow!.primary_unit_code.toLowerCase()).toBe("l");
    expect(Number(unRow!.secondary_qty)).toBeCloseTo(1, 4);
  });
});

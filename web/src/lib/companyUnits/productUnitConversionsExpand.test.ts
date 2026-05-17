import { describe, expect, it } from "vitest";
import { expandMassVolumeConversionSiblings } from "./convert";

describe("expandMassVolumeConversionSiblings", () => {
  it("deriva g e mg quando cadastra conversão para kg", () => {
    const rows = expandMassVolumeConversionSiblings("un", [
      {
        primary_unit_code: "un",
        primary_qty: 1,
        secondary_unit_code: "kg",
        secondary_qty: 2,
      },
    ]);
    const bySec = Object.fromEntries(
      rows.map((r) => [r.secondary_unit_code, r.secondary_qty]),
    );
    expect(bySec.kg).toBe(2);
    expect(bySec.g).toBe(2000);
    expect(bySec.mg).toBe(2_000_000);
  });

  it("deriva l quando cadastra conversão para ml", () => {
    const rows = expandMassVolumeConversionSiblings("cx", [
      {
        primary_unit_code: "cx",
        primary_qty: 1,
        secondary_unit_code: "ml",
        secondary_qty: 750,
      },
    ]);
    const bySec = Object.fromEntries(
      rows.map((r) => [r.secondary_unit_code, r.secondary_qty]),
    );
    expect(bySec.ml).toBe(750);
    expect(bySec.l).toBe(0.75);
  });

  it("não sobrescreve conversão já cadastrada", () => {
    const rows = expandMassVolumeConversionSiblings("un", [
      {
        primary_unit_code: "un",
        primary_qty: 1,
        secondary_unit_code: "kg",
        secondary_qty: 2,
      },
      {
        primary_unit_code: "un",
        primary_qty: 1,
        secondary_unit_code: "g",
        secondary_qty: 1500,
      },
    ]);
    const g = rows.find((r) => r.secondary_unit_code === "g");
    expect(g?.secondary_qty).toBe(1500);
  });
});

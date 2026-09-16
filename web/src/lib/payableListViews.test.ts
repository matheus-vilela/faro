import { describe, expect, it } from "vitest";
import {
  boletoEmissionYmd,
  formatEmissionDateShort,
} from "@/lib/payableListViews";

describe("formatEmissionDateShort", () => {
  it("formata YYYY-MM-DD em dd/mm", () => {
    expect(formatEmissionDateShort("2026-09-10")).toBe("10/09");
  });

  it("mostra traço quando não há emissão", () => {
    expect(formatEmissionDateShort(undefined)).toBe("—");
    expect(formatEmissionDateShort("")).toBe("—");
    expect(formatEmissionDateShort(null)).toBe("—");
  });
});

describe("boletoEmissionYmd", () => {
  it("corta timestamp e trata ausência", () => {
    expect(boletoEmissionYmd({ emission_date: "2026-09-10T12:00:00" })).toBe(
      "2026-09-10",
    );
    expect(boletoEmissionYmd({})).toBe("");
  });
});

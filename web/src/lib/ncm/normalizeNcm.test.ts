import { describe, expect, it } from "vitest";
import {
  formatNcmDisplay,
  ncmChapter4,
  normalizeNcm8,
} from "@/lib/ncm/normalizeNcm";

describe("normalizeNcm8", () => {
  it("remove pontuação e completa 8 dígitos", () => {
    expect(normalizeNcm8("2202.10.00")).toBe("22021000");
    expect(normalizeNcm8("2202")).toBe("00002202");
  });

  it("trata vazio e zeros como ausente", () => {
    expect(normalizeNcm8("")).toBeNull();
    expect(normalizeNcm8(null)).toBeNull();
    expect(normalizeNcm8("00000000")).toBeNull();
    expect(normalizeNcm8("00.00.00.00")).toBeNull();
  });

  it("trunca além de 8 dígitos", () => {
    expect(normalizeNcm8("220210001")).toBe("22021000");
  });
});

describe("formatNcmDisplay", () => {
  it("formata AABB.CC.DD", () => {
    expect(formatNcmDisplay("22021000")).toBe("2202.10.00");
    expect(formatNcmDisplay("2202.10.00")).toBe("2202.10.00");
  });

  it("mostra traço quando ausente", () => {
    expect(formatNcmDisplay(null)).toBe("—");
    expect(formatNcmDisplay("00000000")).toBe("—");
  });
});

describe("ncmChapter4", () => {
  it("usa os 4 primeiros dígitos", () => {
    expect(ncmChapter4("22021000")).toBe("2202");
    expect(ncmChapter4("2203.00.00")).toBe("2203");
  });
});

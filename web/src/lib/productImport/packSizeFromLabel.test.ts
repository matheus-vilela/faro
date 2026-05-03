import { describe, expect, it } from "vitest";
import { normalizeUnitLabel } from "./unitNormalize";
import {
  massPerCountUnitFromLabelKg,
  packSizeFromLabel,
  parsePackagingNameSlashPattern,
  stripPackSizeFromLabel,
} from "./packSizeFromLabel";

describe("stripPackSizeFromLabel", () => {
  it("remove sufixo - N Kg", () => {
    expect(
      stripPackSizeFromLabel("CARVAO VEGETAL DE EUCALIPTO - 8 Kg"),
    ).toBe("CARVAO VEGETAL DE EUCALIPTO");
  });

  it("remove padrão Nsuf/massa (10B/400GR)", () => {
    expect(stripPackSizeFromLabel("PAO ALHO TRD 10B/400GR")).toBe(
      "PAO ALHO TRD",
    );
  });

  it("remove CXn (caixas no nome)", () => {
    expect(stripPackSizeFromLabel("CEBOLA NACIONAL CX4")).toBe(
      "CEBOLA NACIONAL",
    );
    expect(stripPackSizeFromLabel("PROD caixa12 fim")).toBe("PROD fim");
  });
});

describe("parsePackagingNameSlashPattern", () => {
  it("deteta 10B/400GR e conteúdo por unidade interna", () => {
    const p = parsePackagingNameSlashPattern("PAO ALHO TRD 10B/400GR");
    expect(p?.detected).toBe(true);
    expect(p?.inner_units).toBe(10);
    expect(p?.inner_suffix_raw).toBe("B");
    expect(p?.net_per_inner).toMatch(/400\s*g/i);
    expect(p?.inner_label_guess).toContain("bandeja");
  });

  it("deteta volume 6X/500ML", () => {
    const p = parsePackagingNameSlashPattern("REFRIG 6X/500ML");
    expect(p?.inner_units).toBe(6);
    expect(p?.net_per_inner).toMatch(/500\s*ml/i);
  });

  it("não deteta sem padrão", () => {
    expect(parsePackagingNameSlashPattern("PRODUTO SIMPLES 500G")).toBeNull();
  });

  it("sufixo desconhecido usa inner_label_guess «un»", () => {
    const p = parsePackagingNameSlashPattern("ITEM 12Z/1KG");
    expect(p?.inner_units).toBe(12);
    expect(p?.inner_label_guess).toBe("un");
  });
});

describe("packSizeFromLabel", () => {
  it("usa contagem interna em 10B/400GR", () => {
    const { packFactor, rationale } = packSizeFromLabel(
      "PAO ALHO TRD 10B/400GR",
    );
    expect(packFactor).toBe(10);
    expect(rationale).toContain("10");
  });

  it("CX4 → fator 4 caixas", () => {
    const { packFactor } = packSizeFromLabel("CEBOLA NACIONAL CX4");
    expect(packFactor).toBe(4);
  });
});

describe("normalizeUnitLabel (UNI NF-e)", () => {
  it("UNI -> UND", () => {
    expect(normalizeUnitLabel("UNI")).toBe("UND");
    expect(normalizeUnitLabel("uni")).toBe("UND");
  });
});

describe("massPerCountUnitFromLabelKg", () => {
  it("lê kg após traço", () => {
    expect(
      massPerCountUnitFromLabelKg("CARVAO VEGETAL DE EUCALIPTO - 8 Kg"),
    ).toBe(8);
  });
});

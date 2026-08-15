import { describe, expect, it } from "vitest";
import { acquirerSlugFromName, nestedRelation } from "@/types/acquirer";

describe("acquirerSlugFromName", () => {
  it("normaliza acentos e espaços", () => {
    expect(acquirerSlugFromName("Cielo Rede")).toBe("cielo-rede");
    expect(acquirerSlugFromName("PagSeguro")).toBe("pagseguro");
    expect(acquirerSlugFromName("  Stone  ")).toBe("stone");
  });

  it("ignora pontuação", () => {
    expect(acquirerSlugFromName("!!!")).toBe("");
  });
});

describe("nestedRelation", () => {
  it("extrai o primeiro item de array ou o objeto", () => {
    expect(nestedRelation([{ name: "Stone" }])?.name).toBe("Stone");
    expect(nestedRelation({ name: "Cielo" })?.name).toBe("Cielo");
    expect(nestedRelation(null)).toBeNull();
    expect(nestedRelation([])).toBeNull();
  });
});

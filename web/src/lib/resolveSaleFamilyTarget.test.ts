import { describe, expect, it } from "vitest";
import { resolveSaleFamilyTarget } from "@/lib/resolveSaleFamilyTarget";

const existing = [
  { id: "f1", name: "Bolinho" },
  { id: "f2", name: "Suco natural" },
];

describe("resolveSaleFamilyTarget", () => {
  it("usa o cadastro escolhido", () => {
    expect(resolveSaleFamilyTarget("f1", "Outro", existing)).toEqual({
      kind: "existing",
      id: "f1",
    });
  });

  it("casa o nome digitado com um cadastro existente", () => {
    expect(resolveSaleFamilyTarget("", "bolinho", existing)).toEqual({
      kind: "existing",
      id: "f1",
    });
  });

  it("pede cadastro novo quando o nome não existe", () => {
    expect(resolveSaleFamilyTarget("", "Pastel", existing)).toEqual({
      kind: "create",
      name: "Pastel",
    });
  });

  it("falta destino se não há escolha nem nome", () => {
    expect(resolveSaleFamilyTarget("", "  ", existing)).toEqual({
      kind: "missing",
    });
  });
});

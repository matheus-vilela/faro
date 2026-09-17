import { describe, expect, it } from "vitest";
import { contasAReceberSectionFromPath } from "@/lib/contasAReceberPaths";

describe("contasAReceberSectionFromPath", () => {
  it("trata a raiz como calendário", () => {
    expect(contasAReceberSectionFromPath("/app/contas-a-receber")).toBe(
      "calendar",
    );
    expect(contasAReceberSectionFromPath("/app/contas-a-receber/")).toBe(
      "calendar",
    );
  });

  it("reconhece a listagem", () => {
    expect(contasAReceberSectionFromPath("/app/contas-a-receber/listagem")).toBe(
      "list",
    );
  });

  it("rejeita subrota desconhecida", () => {
    expect(contasAReceberSectionFromPath("/app/contas-a-receber/foo")).toBeNull();
  });
});

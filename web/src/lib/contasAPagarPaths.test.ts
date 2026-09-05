import { describe, expect, it } from "vitest";
import { contasAPagarSectionFromPath } from "@/lib/contasAPagarPaths";

describe("contasAPagarSectionFromPath", () => {
  it("trata a raiz como calendário", () => {
    expect(contasAPagarSectionFromPath("/app/contas-a-pagar")).toBe("calendar");
    expect(contasAPagarSectionFromPath("/app/contas-a-pagar/")).toBe("calendar");
  });

  it("reconhece a listagem", () => {
    expect(contasAPagarSectionFromPath("/app/contas-a-pagar/listagem")).toBe(
      "list",
    );
  });

  it("rejeita subrota desconhecida", () => {
    expect(contasAPagarSectionFromPath("/app/contas-a-pagar/foo")).toBeNull();
  });
});

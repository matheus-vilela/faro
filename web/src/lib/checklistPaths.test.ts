import { describe, expect, it } from "vitest";
import { checklistSectionFromPath } from "./checklistPaths";

describe("checklistSectionFromPath", () => {
  it("reconhece as seções conhecidas", () => {
    expect(checklistSectionFromPath("/app/checklists")).toBe("overview");
    expect(checklistSectionFromPath("/app/checklists/")).toBe("overview");
    expect(checklistSectionFromPath("/app/checklists/historico")).toBe(
      "historico",
    );
    expect(checklistSectionFromPath("/app/checklists/conferencia")).toBe(
      "conferencia",
    );
    expect(checklistSectionFromPath("/app/checklists/ranking")).toBe("ranking");
  });

  it("rejeita subcaminho desconhecido", () => {
    expect(checklistSectionFromPath("/app/checklists/foo")).toBe(null);
    expect(checklistSectionFromPath("/app/checklists/historico/extra")).toBe(
      null,
    );
  });
});

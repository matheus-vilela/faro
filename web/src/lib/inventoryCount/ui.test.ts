import { describe, expect, it } from "vitest";
import {
  canCancelCountSession,
  inventoryCountScheduleTargetLabel,
  inventoryCountSessionGroupLabel,
} from "./ui";

describe("inventoryCountSessionGroupLabel", () => {
  it("usa Única quando não há grupo", () => {
    expect(inventoryCountSessionGroupLabel({})).toBe("Única");
    expect(inventoryCountSessionGroupLabel({ groupName: "  " })).toBe("Única");
  });

  it("mantém o nome do setor", () => {
    expect(
      inventoryCountSessionGroupLabel({ groupName: "Cozinha" }),
    ).toBe("Cozinha");
  });

  it("distingue onboarding", () => {
    expect(
      inventoryCountSessionGroupLabel({
        kind: "onboarding",
        onboardingLabel: "Contagem geral (onboarding)",
      }),
    ).toBe("Contagem geral (onboarding)");
  });
});

describe("inventoryCountScheduleTargetLabel", () => {
  it("marca lista única", () => {
    expect(
      inventoryCountScheduleTargetLabel({
        listingId: "l1",
        listingName: "Extra",
      }),
    ).toBe("Única · Extra");
  });

  it("junta setor e listagem", () => {
    expect(
      inventoryCountScheduleTargetLabel({
        listingId: "l1",
        listingName: "Fria",
        listingGroupId: "g1",
        groupName: "Cozinha",
      }),
    ).toBe("Cozinha · Fria");
  });

  it("descreve o grupo inteiro", () => {
    expect(
      inventoryCountScheduleTargetLabel({
        listingId: null,
        groupName: "Bar",
      }),
    ).toBe("Bar · todas as listagens");
  });
});

describe("canCancelCountSession", () => {
  it("só open, returned e pending_approval", () => {
    expect(canCancelCountSession("open")).toBe(true);
    expect(canCancelCountSession("returned")).toBe(true);
    expect(canCancelCountSession("pending_approval")).toBe(true);
    expect(canCancelCountSession("committed")).toBe(false);
    expect(canCancelCountSession("approved")).toBe(false);
    expect(canCancelCountSession("cancelled")).toBe(false);
  });
});

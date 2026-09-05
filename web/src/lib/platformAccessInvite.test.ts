import { describe, expect, it } from "vitest";
import { platformAccessInviteAction } from "./platformAccessInvite";

describe("platformAccessInviteAction", () => {
  it("cria quando não há acesso", () => {
    expect(platformAccessInviteAction(null)).toBe("create");
  });

  it("reconvida quando o acesso foi revogado", () => {
    expect(platformAccessInviteAction({ status: "revoked" })).toBe("reinvite");
  });

  it("bloqueia se ainda está pendente ou ativo", () => {
    expect(platformAccessInviteAction({ status: "pending" })).toBe("exists");
    expect(platformAccessInviteAction({ status: "active" })).toBe("exists");
  });
});

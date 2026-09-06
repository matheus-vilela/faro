import { describe, expect, it } from "vitest";
import { companyPurgeConfirmMatches } from "@/services/purgeCompanyOperationalData";

describe("companyPurgeConfirmMatches", () => {
  it("aceita o nome da unidade ignorando maiúsculas e espaços", () => {
    expect(companyPurgeConfirmMatches("Bar Faro", "  bar faro  ")).toBe(true);
    expect(companyPurgeConfirmMatches("Bar Faro", "Outro")).toBe(false);
    expect(companyPurgeConfirmMatches("Bar Faro", "")).toBe(false);
  });
});

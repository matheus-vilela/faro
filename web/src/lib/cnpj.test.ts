import { describe, expect, it } from "vitest";
import { isValidCnpj } from "./cnpj";

describe("isValidCnpj", () => {
  it("accepts a CNPJ with valid check digits", () => {
    expect(isValidCnpj("47774895000185")).toBe(true);
    expect(isValidCnpj("47.774.895/0001-85")).toBe(true);
  });

  it("rejects the same root with wrong check digits", () => {
    expect(isValidCnpj("47774895000188")).toBe(false);
    expect(isValidCnpj("47.774.895/0001-88")).toBe(false);
  });

  it("rejects repeated digits and short values", () => {
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("4777489500018")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
});

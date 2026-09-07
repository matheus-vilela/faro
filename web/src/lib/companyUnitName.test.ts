import { describe, expect, it } from "vitest";
import {
  hasDuplicateUnitDocument,
  hasDuplicateUnitName,
  hasDuplicateUnitNameInGroup,
  mapCompanyUnitMutationError,
  unitRowsForOwner,
} from "./companyUnitName";

const units = [
  {
    company: {
      id: "a",
      group_id: "g1",
      name: "Eulalia Casa de Samba",
      document: "47774895000185",
    },
  },
  {
    company: {
      id: "b",
      group_id: "g2",
      name: "Outro Bar",
      document: "11222333000181",
    },
  },
];

describe("hasDuplicateUnitName", () => {
  it("detects the same name in another group", () => {
    expect(hasDuplicateUnitName("Eulalia Casa de Samba", units)).toBe(true);
    expect(hasDuplicateUnitName("  eulalia casa de samba  ", units)).toBe(true);
    expect(
      hasDuplicateUnitName("Eulalia Casa de Samba", units, "a"),
    ).toBe(false);
    expect(hasDuplicateUnitName("Casa Nova", units)).toBe(false);
  });
});

describe("hasDuplicateUnitNameInGroup", () => {
  it("only flags the same group", () => {
    expect(
      hasDuplicateUnitNameInGroup("Eulalia Casa de Samba", "g1", units),
    ).toBe(true);
    expect(
      hasDuplicateUnitNameInGroup("Eulalia Casa de Samba", "g2", units),
    ).toBe(false);
  });
});

describe("hasDuplicateUnitDocument", () => {
  it("detects the same CNPJ digits", () => {
    expect(hasDuplicateUnitDocument("47.774.895/0001-85", units)).toBe(true);
    expect(hasDuplicateUnitDocument("47774895000185", units, "a")).toBe(false);
    expect(hasDuplicateUnitDocument("47774895000188", units)).toBe(false);
  });
});

describe("unitRowsForOwner", () => {
  it("keeps units from groups of that owner", () => {
    const groups = [
      { group: { owner_user_id: "owner-1" }, companies: [units[0]!] },
      { group: { owner_user_id: "owner-2" }, companies: [units[1]!] },
    ];
    expect(unitRowsForOwner(groups, "owner-1")).toEqual([units[0]]);
    expect(unitRowsForOwner(groups, "nobody")).toEqual([]);
  });
});

describe("mapCompanyUnitMutationError", () => {
  it("maps unique violations", () => {
    expect(
      mapCompanyUnitMutationError(
        { code: "23505", message: "idx_companies_group_id_name_normalized" },
        "x",
      ),
    ).toBe("Já existe uma unidade com este nome.");
    expect(
      mapCompanyUnitMutationError(
        { code: "23505", message: 'duplicate key "document"' },
        "x",
      ),
    ).toBe("Já existe uma unidade com este CNPJ.");
    expect(
      mapCompanyUnitMutationError({ details: "permission denied for table products" }, "x"),
    ).toBe("permission denied for table products");
    expect(mapCompanyUnitMutationError({}, "Erro ao remover unidade")).toBe(
      "Erro ao remover unidade",
    );
  });
});

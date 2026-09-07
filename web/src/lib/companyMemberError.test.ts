import { describe, expect, it } from "vitest";
import { mapCompanyMemberMutationError } from "./companyMemberError";

describe("mapCompanyMemberMutationError", () => {
  it("traduz unique do WhatsApp ativo", () => {
    expect(
      mapCompanyMemberMutationError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "uq_company_members_active_phone"',
      }),
    ).toBe(
      "Este WhatsApp já está cadastrado como operador ativo nesta unidade.",
    );
  });

  it("traduz pelo nome da constraint mesmo sem code", () => {
    expect(
      mapCompanyMemberMutationError({
        message:
          'duplicate key value violates unique constraint "uq_company_members_active_phone"',
      }),
    ).toMatch(/já está cadastrado/i);
  });

  it("traduz conflito com o proprietário", () => {
    expect(
      mapCompanyMemberMutationError({
        message: "Telefone já pertence ao proprietário da empresa.",
      }),
    ).toMatch(/proprietário/i);
  });
});

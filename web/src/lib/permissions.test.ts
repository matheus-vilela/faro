import { describe, expect, it } from "vitest";
import {
  canManageFinancialCadastro,
  DEFAULT_MEMBER_PERMISSIONS,
} from "./permissions";

describe("canManageFinancialCadastro", () => {
  it("libera perfil com Configurações (Membro padrão incluso)", () => {
    expect(canManageFinancialCadastro(DEFAULT_MEMBER_PERMISSIONS)).toBe(true);
    expect(canManageFinancialCadastro(["configuracoes"])).toBe(true);
    expect(canManageFinancialCadastro(["*"])).toBe(true);
  });

  it("bloqueia perfil só operacional ou só financeiro de lançamentos", () => {
    expect(canManageFinancialCadastro(["contas_a_pagar", "dre"])).toBe(false);
    expect(canManageFinancialCadastro(["produtos"])).toBe(false);
    expect(canManageFinancialCadastro([])).toBe(false);
    expect(canManageFinancialCadastro(null)).toBe(false);
  });
});

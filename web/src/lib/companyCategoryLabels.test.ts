import { describe, expect, it } from "vitest";
import { companyCategoryDisplayName } from "./companyCategoryLabels";
import { ptBrUi } from "./ptBrUiStrings";
import type { CompanyCategory } from "@/types/category";

function cat(
  partial: Partial<CompanyCategory> & Pick<CompanyCategory, "name">,
): CompanyCategory {
  return {
    id: "c1",
    company_id: "co-1",
    parent_id: null,
    sort_order: 0,
    ordem: 0,
    created_at: "",
    updated_at: "",
    natureza: "RECEITA",
    tipo: "OPERACIONAL",
    papel_receita_dre: "DEDUCAO",
    ativo: true,
    padrao_sistema: true,
    incluir_no_dre: true,
    ...partial,
  };
}

describe("companyCategoryDisplayName", () => {
  it("mostra o rótulo com acento para a folha padrão de dedução", () => {
    expect(
      companyCategoryDisplayName(
        cat({ name: "Deducoes da receita / despesas sobre vendas" }),
      ),
    ).toBe(ptBrUi.dre.deducoesReceitaLabel);
  });

  it("respeita nome personalizado mesmo em categoria padrão do sistema", () => {
    expect(
      companyCategoryDisplayName(
        cat({ name: "Deduções da receita", padrao_sistema: true }),
      ),
    ).toBe("Deduções da receita");
  });

  it("não mascara outras categorias", () => {
    expect(
      companyCategoryDisplayName(
        cat({
          name: "Vendas de produtos",
          papel_receita_dre: null,
          padrao_sistema: true,
        }),
      ),
    ).toBe("Vendas de produtos");
  });
});

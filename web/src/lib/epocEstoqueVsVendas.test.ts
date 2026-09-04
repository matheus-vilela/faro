import { describe, expect, it } from "vitest";
import type { EpocEstoqueSaidaItem } from "@/services/epocEstoqueExportService";
import {
  isEpocEmptyReportError,
  listEstoqueSemVenda,
  listEstoqueSemVendaNaoVinculado,
  parseVendaProdutosCsvItems,
} from "@/lib/epocEstoqueVsVendas";

function saida(
  sku: string,
  nome: string,
  extras: Partial<EpocEstoqueSaidaItem> = {},
): EpocEstoqueSaidaItem {
  return {
    sku,
    nome,
    categorias: [],
    categoria_path: "",
    acao: "Saída",
    obs: "",
    qtde: 1,
    qtde_unidade: "UN",
    qtde_raw: "1,000 UN",
    qtde_volume_saida: 1,
    custo_total: 0,
    ...extras,
  };
}

describe("parseVendaProdutosCsvItems", () => {
  it("lê nome, qtde e total", () => {
    const csv = `data_consumo;Produto;Quant.;Total Bruto(R$)
03/09/2026;AGUA COM GAS;8;20,00
03/09/2026;BOLINHO CUPIM;3;53,58
`;
    const items = parseVendaProdutosCsvItems(csv);
    expect(items).toHaveLength(2);
    expect(items[0]?.nome).toBe("AGUA COM GAS");
    expect(items[0]?.qtde).toBe(8);
    expect(items[1]?.nome).toBe("BOLINHO CUPIM");
  });

  it("lê SKU quando a coluna existe", () => {
    const csv = `data_consumo;Código;Produto;Quant.;Total Bruto(R$)
03/09/2026;194;AGUA COM GAS;8;20,00
`;
    const items = parseVendaProdutosCsvItems(csv);
    expect(items[0]?.sku).toBe("194");
  });
});

describe("listEstoqueSemVenda", () => {
  it("casa por nome com acento e lista o que só está no estoque", () => {
    const estoque = [
      saida("194", "AGUA COM GAS"),
      saida("1452", "BALDE DE CERVEJA"),
      saida("1028", "BOLINHO CUPIM"),
    ];
    const vendas = parseVendaProdutosCsvItems(
      `data_consumo;Produto;Quant.;Total Bruto(R$)
03/09/2026;Água com gás;8;20,00
`,
    );
    const only = listEstoqueSemVenda(estoque, vendas);
    expect(only.map((i) => i.sku)).toEqual(["1452", "1028"]);
  });

  it("casa por SKU quando a venda tem código", () => {
    const only = listEstoqueSemVenda(
      [saida("194", "AGUA COM GAS"), saida("999", "OUTRO")],
      [{ sku: "194", nome: "Nome diferente", qtde: 1, total: 1 }],
    );
    expect(only.map((i) => i.sku)).toEqual(["999"]);
  });

  it("sem vendas, todos os itens de estoque entram", () => {
    const only = listEstoqueSemVenda(
      [saida("194", "AGUA COM GAS")],
      [],
    );
    expect(only).toHaveLength(1);
  });
});

describe("listEstoqueSemVendaNaoVinculado", () => {
  it("omite variante já ligada ao agrupamento", () => {
    const only = listEstoqueSemVendaNaoVinculado(
      [saida("1028", "BOLINHO CUPIM"), saida("1100", "CACHACA")],
      [],
      [{ sku: "1028", name: "BOLINHO CUPIM" }],
    );
    expect(only.map((i) => i.sku)).toEqual(["1100"]);
  });

  it("casa vínculo por nome quando o SKU diverge", () => {
    const only = listEstoqueSemVendaNaoVinculado(
      [saida("999", "Bolinho de carne")],
      [],
      [{ sku: null, name: "BOLINHO DE CARNE" }],
    );
    expect(only).toHaveLength(0);
  });
});

describe("isEpocEmptyReportError", () => {
  it("reconhece ausência de tblExport", () => {
    expect(
      isEpocEmptyReportError(
        "Nenhuma tabela #tblExport com dados na janela consultada.",
      ),
    ).toBe(true);
    expect(isEpocEmptyReportError("validadorOz.php falhou.")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  interpretTabela3FromRows,
  parseEpocFaturamentoCsv,
  previewEpocFaturamentoInterpret,
  type EpocFaturamentoCsvRow,
} from "./epocFaturamentoInterpret";

function buildTabela3Csv(): string {
  const header = "data_consulta;secao;col_1;col_2;col_3;col_4;col_5;col_6;col_7;col_8;col_9;col_10";
  const lines: string[] = [header];
  const push = (cols: string[]) => {
    lines.push(["25/07/2026", "tabela_3", ...cols].join(";"));
  };
  // 1 título
  push(["Serviços POS", "", "", "", "", "", "", "", "", ""]);
  // 2–4 filler
  push(["", "hdr", "Qtde", "Tot.Ent", "Tot.Cons", "Prod", "Serv", "Tax", "Total", "Media"]);
  push(["", "Masc", "1", "1", "1", "1", "1", "1", "1", "1"]);
  push(["", "x", "", "", "", "", "", "", "", ""]);
  // 5 TOTAL MASC
  push([
    "",
    "TOTAL MASC:",
    "10",
    "100,00",
    "90,00",
    "50,00",
    "30,00",
    "10,00",
    "90,00",
    "9,00",
  ]);
  // 6 filler
  push(["", "y", "", "", "", "", "", "", "", ""]);
  // 7 TOTAL FEM
  push([
    "",
    "TOTAL FEM:",
    "5",
    "50,00",
    "45,00",
    "20,00",
    "20,00",
    "5,00",
    "45,00",
    "9,00",
  ]);
  // 8–13 filler
  for (let i = 0; i < 6; i++) {
    push(["", `f${i}`, "", "", "", "", "", "", "", ""]);
  }
  // 14 Total Geral
  push([
    "",
    "Total Geral:",
    "15",
    "150,00",
    "135,00",
    "70,00",
    "50,00",
    "15,00",
    "135,00",
    "9,00",
  ]);
  return `${lines.join("\n")}\n`;
}

function buildTabela5Csv(): string {
  const header = "data_consulta;secao;col_1;col_2";
  const lines: string[] = [header];
  const push = (cols: string[]) => {
    lines.push(["25/07/2026", "tabela_5", ...cols].join(";"));
  };
  push(["Produtos/Serviços", ""]);
  push(["", "Valores"]);
  push(["Produtos", "1.000,00"]);
  push(["(+) Acréscimo", "50,00"]);
  push(["(-) Estornos", "20,00"]);
  push(["Total Produtos", "1.030,00"]);
  push(["Serviços", "200,00"]);
  push(["(+) Acréscimo", "10,00"]);
  push(["(-) Estornos", "5,00"]);
  push(["Total Serviços", "205,00"]);
  return `${lines.join("\n")}\n`;
}

describe("epocFaturamentoInterpret tabela_3", () => {
  it("extrai MASC, FEM e Total Geral nas colunas esperadas", () => {
    const preview = previewEpocFaturamentoInterpret(buildTabela3Csv(), "t.csv");
    expect(preview.ok).toBe(true);
    expect(preview.tabela3).toHaveLength(1);
    const t = preview.tabela3[0]!;
    expect(t.tituloSecao).toBe("Serviços POS");
    expect(t.avisos).toEqual([]);
    expect(t.totalMasc).toMatchObject({
      linhaNaSecao: 5,
      quantidade: "10",
      totEnt: "100,00",
      totCons: "90,00",
      produtos: "50,00",
      servicos: "30,00",
      taxas: "10,00",
      total: "90,00",
      media: "9,00",
    });
    expect(t.totalFem?.linhaNaSecao).toBe(7);
    expect(t.totalFem?.quantidade).toBe("5");
    expect(t.totalGeral?.linhaNaSecao).toBe(14);
    expect(t.totalGeral?.total).toBe("135,00");
  });

  it("avisa se TOTAL MASC: não está na linha 5", () => {
    const rows: EpocFaturamentoCsvRow[] = parseEpocFaturamentoCsv(buildTabela3Csv());
    // remove a linha filler antes do MASC → MASC passa para linha 4
    const filtered = rows.filter(
      (r) => !(r.secao === "tabela_3" && r.cols[1] === "x"),
    );
    const [t] = interpretTabela3FromRows(filtered);
    expect(t?.totalMasc?.linhaNaSecao).toBe(4);
    expect(t?.avisos.some((a) => a.includes("TOTAL MASC:"))).toBe(true);
  });
});

describe("epocFaturamentoInterpret tabela_5", () => {
  it("extrai Produtos e Serviços com acréscimo, estornos e totais", () => {
    const preview = previewEpocFaturamentoInterpret(buildTabela5Csv(), "t5.csv");
    expect(preview.ok).toBe(true);
    expect(preview.tabela5).toHaveLength(1);
    const t = preview.tabela5[0]!;
    expect(t.tituloSecao).toBe("Produtos/Serviços");
    expect(t.avisos).toEqual([]);
    expect(t.produtos).toMatchObject({
      linhaInicio: 3,
      valores: "1.000,00",
      acrescimo: { valor: "50,00", linhaNaSecao: 4 },
      estornos: { valor: "20,00", linhaNaSecao: 5 },
      total: { valor: "1.030,00", rotulo: "Total Produtos" },
    });
    expect(t.servicos).toMatchObject({
      valores: "200,00",
      acrescimo: { valor: "10,00" },
      estornos: { valor: "5,00" },
      total: { valor: "205,00", rotulo: "Total Serviços" },
    });
  });
});

function buildTabela6Csv(): string {
  const header = "data_consulta;secao;col_1;col_2;col_3";
  const lines: string[] = [header];
  const push = (cols: string[]) => {
    lines.push(["25/07/2026", "tabela_6", ...cols].join(";"));
  };
  push(["Totais", "", ""]);
  push(["Descrição", "Valores(R$)", ""]);
  push(["Total Créditos", "100,00", ""]);
  push(["(-) Devoluções", "1,00", ""]);
  push(["(-) Estorno de pagamento", "2,00", ""]);
  push(["Sub-total", "97,00", ""]);
  push(["(-) Total Sangria(s)", "3,00", ""]);
  push(["(-) Total Vale(s)", "4,00", ""]);
  push(["Saldo Geral", "90,00", ""]);
  push(["(-) Total (Produtos + Serviços).**", "50,00", ""]);
  push(["Total (Produtos + Serviços) à Pagar", "40,00", ""]);
  push(["Total (Produtos + Serviços) Pagos e Estornados", "10,00", ""]);
  push(["Total Pendura(s) ( 2 )", "5,00", ""]);
  push(["Recarga de Crédito", "0,00", ""]);
  push(["Saldo Credito", "1,00", ""]);
  push(["Saldo Produto", "2,00", ""]);
  push(["Saldo Final", "88,00", ""]);
  push(["Fiscal", "", ""]);
  push(["Data", "25/07/2026", ""]);
  push(["Lixo fiscal", "99", "99,00"]);
  push(["Pendente de envio em correção de notas", "1", "10,00"]);
  push(["Valor total de notas enviadas com sucesso", "8", "800,00"]);
  push(["Valor totais de notas do período", "9", "810,00"]);
  push(["Formas de Pagamento", "", ""]);
  push(["Dinheiro", "5", "100,00"]);
  push(["PIX", "3", "200,00"]);
  push(["Total", "8", "300,00"]);
  push(["Algo depois", "0", "0"]);
  return `${lines.join("\n")}\n`;
}

describe("epocFaturamentoInterpret tabela_6", () => {
  it("extrai totais, fiscal e formas de pagamento", () => {
    const preview = previewEpocFaturamentoInterpret(buildTabela6Csv(), "t6.csv");
    expect(preview.ok).toBe(true);
    expect(preview.tabela6).toHaveLength(1);
    const t = preview.tabela6[0]!;
    expect(t.totaisNaoMapeados).toEqual([]);
    expect(t.totais.find((x) => x.chave === "total_creditos")?.valor).toBe(
      "100,00",
    );
    expect(t.totais.find((x) => x.chave === "saldo_final")?.valor).toBe(
      "88,00",
    );
    expect(t.totais.find((x) => x.chave === "total_penduras")?.valor).toBe(
      "5,00",
    );
    expect(t.fiscal).toHaveLength(3);
    expect(t.fiscal.map((f) => f.rotulo)).toEqual([
      "Pendente de envio em correção de notas",
      "Valor total de notas enviadas com sucesso",
      "Valor totais de notas do período",
    ]);
    expect(t.fiscal[0]).toMatchObject({
      chave: "pendente_envio_correcao",
      quantidade: "1",
      valor: "10,00",
    });
    expect(t.avisos.some((a) => /Data|Lixo fiscal/i.test(a))).toBe(false);
    expect(t.formasPagamento).toEqual([
      {
        forma: "Dinheiro",
        linhaNaSecao: 25,
        operacao: "5",
        valores: "100,00",
      },
      {
        forma: "PIX",
        linhaNaSecao: 26,
        operacao: "3",
        valores: "200,00",
      },
    ]);
    expect(t.formasPagamentoTotal).toMatchObject({
      forma: "Total",
      operacao: "8",
      valores: "300,00",
    });
  });

  it("avisa rótulos não mapeados no bloco totais", () => {
    const csv = buildTabela6Csv().replace(
      "Recarga de Crédito;0,00",
      "Linha Misteriosa;9,99",
    );
    const preview = previewEpocFaturamentoInterpret(csv, "t6b.csv");
    const t = preview.tabela6[0]!;
    expect(t.totaisNaoMapeados.some((x) => x.rotulo === "Linha Misteriosa")).toBe(
      true,
    );
    expect(t.avisos.some((a) => a.includes("não mapeado"))).toBe(true);
  });
});

/**
 * Interpretação do CSV consolidado de faturamento EPOC (`data_consulta;secao;col_1…`).
 * Fase atual: `tabela_3` + `tabela_5` + `tabela_6` (Totais / Fiscal / Formas de Pagamento).
 */

export type EpocFaturamentoCsvRow = {
  dataConsulta: string;
  secao: string;
  cols: string[];
};

export type Tabela3Totais = {
  /** Rótulo encontrado em col_2 (ex.: TOTAL MASC:). */
  rotulo: string;
  /** Índice 1-based da linha dentro da secção (para validar vs. 5 / 7 / 14). */
  linhaNaSecao: number;
  quantidade: string;
  totEnt: string;
  totCons: string;
  produtos: string;
  servicos: string;
  taxas: string;
  total: string;
  media: string;
};

export type Tabela3Interpretacao = {
  dataConsulta: string;
  secao: string;
  tituloSecao: string | null;
  totalLinhasSecao: number;
  totalMasc: Tabela3Totais | null;
  totalFem: Tabela3Totais | null;
  totalGeral: Tabela3Totais | null;
  avisos: string[];
};

export type Tabela5LinhaValor = {
  rotulo: string;
  linhaNaSecao: number;
  valor: string;
};

/** Bloco Produtos ou Serviços dentro de `tabela_5`. */
export type Tabela5Grupo = {
  /** col_1 da linha de início (Produtos / Serviços). */
  rotuloInicio: string;
  linhaInicio: number;
  /** col_2 da linha de início (Valores). */
  valores: string;
  acrescimo: Tabela5LinhaValor | null;
  estornos: Tabela5LinhaValor | null;
  total: Tabela5LinhaValor | null;
};

export type Tabela5Interpretacao = {
  dataConsulta: string;
  secao: string;
  tituloSecao: string | null;
  totalLinhasSecao: number;
  produtos: Tabela5Grupo | null;
  servicos: Tabela5Grupo | null;
  avisos: string[];
};

export type Tabela6LinhaValor = {
  /** Chave canônica mapeada (ou `nao_mapeado`). */
  chave: string;
  rotulo: string;
  linhaNaSecao: number;
  valor: string;
};

export type Tabela6FiscalLinha = {
  chave: string;
  rotulo: string;
  linhaNaSecao: number;
  quantidade: string;
  valor: string;
};

export type Tabela6FormaPagamento = {
  forma: string;
  linhaNaSecao: number;
  operacao: string;
  valores: string;
};

export type Tabela6Interpretacao = {
  dataConsulta: string;
  secao: string;
  tituloSecao: string | null;
  totalLinhasSecao: number;
  /** Linhas do bloco Descrição → Saldo Final (valores mapeados). */
  totais: Tabela6LinhaValor[];
  /** col_1 presentes no bloco e sem regra conhecida. */
  totaisNaoMapeados: Tabela6LinhaValor[];
  fiscal: Tabela6FiscalLinha[];
  formasPagamento: Tabela6FormaPagamento[];
  /** Primeira linha Total após Formas de Pagamento (se encontrada). */
  formasPagamentoTotal: Tabela6FormaPagamento | null;
  avisos: string[];
};

export type EpocFaturamentoInterpretPreview = {
  ok: boolean;
  error?: string;
  fileName: string;
  totalLinhas: number;
  secoes: string[];
  tabela3: Tabela3Interpretacao[];
  tabela5: Tabela5Interpretacao[];
  tabela6: Tabela6Interpretacao[];
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ";") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseEpocFaturamentoCsv(text: string): EpocFaturamentoCsvRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: EpocFaturamentoCsvRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trimEnd();
    if (!raw.trim()) continue;
    const cells = parseCsvLine(raw);
    if (i === 0 && normalizeKey(cells[0] ?? "") === "dataconsulta") continue;
    const dataConsulta = (cells[0] ?? "").trim();
    const secao = (cells[1] ?? "").trim();
    if (!dataConsulta && !secao) continue;
    rows.push({
      dataConsulta,
      secao,
      cols: cells.slice(2).map((c) => c.trim()),
    });
  }
  return rows;
}

function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function normalizeLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

const LABEL_TOTAL_MASC = "total masc:";
const LABEL_TOTAL_FEM = "total fem:";
const LABEL_TOTAL_GERAL = "total geral:";

function extractTotaisFromRow(
  row: EpocFaturamentoCsvRow,
  linhaNaSecao: number,
): Tabela3Totais {
  const cols = row.cols;
  return {
    rotulo: cols[1] ?? "",
    linhaNaSecao,
    quantidade: cols[2] ?? "",
    totEnt: cols[3] ?? "",
    totCons: cols[4] ?? "",
    produtos: cols[5] ?? "",
    servicos: cols[6] ?? "",
    taxas: cols[7] ?? "",
    total: cols[8] ?? "",
    media: cols[9] ?? "",
  };
}

function findLabeledRow(
  sectionRows: EpocFaturamentoCsvRow[],
  wantLabel: string,
): { row: EpocFaturamentoCsvRow; linhaNaSecao: number } | null {
  const want = normalizeLabel(wantLabel);
  for (let i = 0; i < sectionRows.length; i++) {
    const row = sectionRows[i]!;
    const col2 = normalizeLabel(row.cols[1] ?? "");
    if (col2 === want) {
      return { row, linhaNaSecao: i + 1 };
    }
  }
  return null;
}

/**
 * Interpreta blocos `tabela_3` (Serviços POS).
 * Critério principal: col_2 = TOTAL MASC: / TOTAL FEM: / Total Geral:.
 * Linhas esperadas na secção: 5, 7 e 14 (avisos se divergirem).
 */
export function interpretTabela3FromRows(
  rows: EpocFaturamentoCsvRow[],
): Tabela3Interpretacao[] {
  const byKey = new Map<string, EpocFaturamentoCsvRow[]>();
  for (const row of rows) {
    if (normalizeKey(row.secao) !== "tabela_3") continue;
    const key = `${row.dataConsulta}||${row.secao}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const out: Tabela3Interpretacao[] = [];
  for (const [, sectionRows] of byKey) {
    const first = sectionRows[0]!;
    const avisos: string[] = [];
    const tituloSecao = (first.cols[0] ?? "").trim() || null;

    const masc = findLabeledRow(sectionRows, LABEL_TOTAL_MASC);
    const fem = findLabeledRow(sectionRows, LABEL_TOTAL_FEM);
    const geral = findLabeledRow(sectionRows, LABEL_TOTAL_GERAL);

    if (!masc) avisos.push('Não encontrei linha com col_2 = "TOTAL MASC:".');
    else if (masc.linhaNaSecao !== 5) {
      avisos.push(
        `TOTAL MASC: na linha ${masc.linhaNaSecao} da secção (esperado: 5).`,
      );
    }

    if (!fem) avisos.push('Não encontrei linha com col_2 = "TOTAL FEM:".');
    else if (fem.linhaNaSecao !== 7) {
      avisos.push(
        `TOTAL FEM: na linha ${fem.linhaNaSecao} da secção (esperado: 7).`,
      );
    }

    if (!geral) avisos.push('Não encontrei linha com col_2 = "Total Geral:".');
    else if (geral.linhaNaSecao !== 14) {
      avisos.push(
        `Total Geral: na linha ${geral.linhaNaSecao} da secção (esperado: 14).`,
      );
    }

    out.push({
      dataConsulta: first.dataConsulta,
      secao: first.secao,
      tituloSecao,
      totalLinhasSecao: sectionRows.length,
      totalMasc: masc
        ? extractTotaisFromRow(masc.row, masc.linhaNaSecao)
        : null,
      totalFem: fem ? extractTotaisFromRow(fem.row, fem.linhaNaSecao) : null,
      totalGeral: geral
        ? extractTotaisFromRow(geral.row, geral.linhaNaSecao)
        : null,
      avisos,
    });
  }

  return out;
}

function findCol1Exact(
  sectionRows: EpocFaturamentoCsvRow[],
  wantLabel: string,
  fromIndex = 0,
): { row: EpocFaturamentoCsvRow; index: number; linhaNaSecao: number } | null {
  const want = normalizeLabel(wantLabel);
  for (let i = fromIndex; i < sectionRows.length; i++) {
    const row = sectionRows[i]!;
    if (normalizeLabel(row.cols[0] ?? "") === want) {
      return { row, index: i, linhaNaSecao: i + 1 };
    }
  }
  return null;
}

function findCol1ContainsBetween(
  sectionRows: EpocFaturamentoCsvRow[],
  startIndexExclusive: number,
  endIndexExclusive: number,
  needle: string,
): { row: EpocFaturamentoCsvRow; linhaNaSecao: number } | null {
  const want = normalizeLabel(needle);
  for (let i = startIndexExclusive + 1; i < endIndexExclusive; i++) {
    const row = sectionRows[i]!;
    const col1 = normalizeLabel(row.cols[0] ?? "");
    if (col1.includes(want)) {
      return { row, linhaNaSecao: i + 1 };
    }
  }
  return null;
}

function extractTabela5Grupo(
  sectionRows: EpocFaturamentoCsvRow[],
  inicioLabel: string,
  totalLabel: string,
  avisos: string[],
  opts?: { expectedLinhaInicio?: number },
): Tabela5Grupo | null {
  const start = findCol1Exact(sectionRows, inicioLabel);
  if (!start) {
    avisos.push(`Não encontrei linha com col_1 = "${inicioLabel}".`);
    return null;
  }
  if (
    opts?.expectedLinhaInicio != null &&
    start.linhaNaSecao !== opts.expectedLinhaInicio
  ) {
    avisos.push(
      `${inicioLabel}: na linha ${start.linhaNaSecao} da secção (esperado: ${opts.expectedLinhaInicio}).`,
    );
  }

  const total = findCol1Exact(sectionRows, totalLabel, start.index + 1);
  if (!total) {
    avisos.push(
      `Não encontrei "${totalLabel}" após a linha "${inicioLabel}".`,
    );
    return {
      rotuloInicio: start.row.cols[0] ?? inicioLabel,
      linhaInicio: start.linhaNaSecao,
      valores: start.row.cols[1] ?? "",
      acrescimo: null,
      estornos: null,
      total: null,
    };
  }

  const acrescimo = findCol1ContainsBetween(
    sectionRows,
    start.index,
    total.index,
    "(+) acrescimo",
  );
  const estornos = findCol1ContainsBetween(
    sectionRows,
    start.index,
    total.index,
    "(-) estornos",
  );

  if (!acrescimo) {
    avisos.push(
      `Entre "${inicioLabel}" e "${totalLabel}" não há linha com "(+) Acréscimo".`,
    );
  }
  if (!estornos) {
    avisos.push(
      `Entre "${inicioLabel}" e "${totalLabel}" não há linha com "(-) Estornos".`,
    );
  }

  return {
    rotuloInicio: start.row.cols[0] ?? inicioLabel,
    linhaInicio: start.linhaNaSecao,
    valores: start.row.cols[1] ?? "",
    acrescimo: acrescimo
      ? {
          rotulo: acrescimo.row.cols[0] ?? "",
          linhaNaSecao: acrescimo.linhaNaSecao,
          valor: acrescimo.row.cols[1] ?? "",
        }
      : null,
    estornos: estornos
      ? {
          rotulo: estornos.row.cols[0] ?? "",
          linhaNaSecao: estornos.linhaNaSecao,
          valor: estornos.row.cols[1] ?? "",
        }
      : null,
    total: {
      rotulo: total.row.cols[0] ?? totalLabel,
      linhaNaSecao: total.linhaNaSecao,
      valor: total.row.cols[1] ?? "",
    },
  };
}

/**
 * Interpreta blocos `tabela_5` (Produtos/Serviços).
 * Para cada grupo: linha início (valores em col_2) → até Total *;
 * no intervalo: (+) Acréscimo e (-) Estornos (valores em col_2) + Total *.
 * Produtos esperado na 3.ª linha da secção.
 */
export function interpretTabela5FromRows(
  rows: EpocFaturamentoCsvRow[],
): Tabela5Interpretacao[] {
  const byKey = new Map<string, EpocFaturamentoCsvRow[]>();
  for (const row of rows) {
    if (normalizeKey(row.secao) !== "tabela_5") continue;
    const key = `${row.dataConsulta}||${row.secao}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const out: Tabela5Interpretacao[] = [];
  for (const [, sectionRows] of byKey) {
    const first = sectionRows[0]!;
    const avisos: string[] = [];
    const tituloSecao = (first.cols[0] ?? "").trim() || null;

    const produtos = extractTabela5Grupo(
      sectionRows,
      "Produtos",
      "Total Produtos",
      avisos,
      { expectedLinhaInicio: 3 },
    );
    const servicos = extractTabela5Grupo(
      sectionRows,
      "Serviços",
      "Total Serviços",
      avisos,
    );

    out.push({
      dataConsulta: first.dataConsulta,
      secao: first.secao,
      tituloSecao,
      totalLinhasSecao: sectionRows.length,
      produtos,
      servicos,
      avisos,
    });
  }

  return out;
}

/** Cabeçalhos / títulos do bloco Totais — não são “valores de negócio”. */
const TABELA6_TOTAIS_IGNORAR = new Set(
  ["totais", "descricao", "valores(r$)", "valores"].map((s) => normalizeKey(s)),
);

/**
 * Rótulos conhecidos do bloco Descrição → Saldo Final.
 * Match: exact (após normalizeLabel) ou predicado.
 */
const TABELA6_TOTAIS_MAP: {
  chave: string;
  match: (labelNorm: string) => boolean;
}[] = [
  {
    chave: "total_creditos",
    match: (l) => l === "total creditos",
  },
  {
    chave: "devolucoes",
    match: (l) => l === "(-) devolucoes" || l.endsWith("devolucoes"),
  },
  {
    chave: "estorno_pagamento",
    match: (l) =>
      l === "(-) estorno de pagamento" || l.includes("estorno de pagamento"),
  },
  {
    chave: "sub_total",
    match: (l) => l === "sub-total" || l === "sub total",
  },
  {
    chave: "total_sangrias",
    match: (l) => l.includes("total sangria"),
  },
  {
    chave: "total_vales",
    match: (l) => l.includes("total vale"),
  },
  {
    chave: "saldo_geral",
    match: (l) => l === "saldo geral",
  },
  {
    chave: "total_produtos_servicos",
    match: (l) => {
      const t = l.replace(/\*+$/g, "").trim();
      return (
        t === "(-) total (produtos + servicos)" ||
        t === "total (produtos + servicos)" ||
        (t.includes("total (produtos + servicos)") &&
          !t.includes("pagar") &&
          !t.includes("pagos") &&
          !t.includes("estornados"))
      );
    },
  },
  {
    chave: "total_produtos_servicos_a_pagar",
    match: (l) =>
      l.includes("total (produtos + servicos)") && l.includes("pagar"),
  },
  {
    chave: "total_produtos_servicos_pagos_estornados",
    match: (l) =>
      l.includes("total (produtos + servicos)") &&
      (l.includes("pagos") || l.includes("estornados")),
  },
  {
    chave: "total_penduras",
    match: (l) => l.includes("total pendura"),
  },
  {
    chave: "recarga_credito",
    match: (l) => l === "recarga de credito" || l.includes("recarga de credito"),
  },
  {
    chave: "saldo_credito",
    match: (l) => l === "saldo credito" || l === "saldo de credito",
  },
  {
    chave: "saldo_produto",
    match: (l) => l === "saldo produto" || l === "saldo produtos",
  },
  {
    chave: "saldo_final",
    match: (l) => l === "saldo final",
  },
];

/** Apenas estas col_1 entram no bloco Fiscal; demais (ex.: Data) são ignoradas. */
const TABELA6_FISCAL_MAP: {
  chave: string;
  label: string;
}[] = [
  {
    chave: "pendente_envio_correcao",
    label: "Pendente de envio em correção de notas",
  },
  {
    chave: "notas_enviadas_sucesso",
    label: "Valor total de notas enviadas com sucesso",
  },
  {
    chave: "notas_periodo",
    label: "Valor totais de notas do período",
  },
];

function mapTabela6TotaisChave(col1: string): string | null {
  const labelNorm = normalizeLabel(col1);
  if (!labelNorm) return null;
  if (TABELA6_TOTAIS_IGNORAR.has(normalizeKey(col1))) return null;
  for (const rule of TABELA6_TOTAIS_MAP) {
    if (rule.match(labelNorm)) return rule.chave;
  }
  return "nao_mapeado";
}

/**
 * Interpreta `tabela_6`: bloco Totais (Descrição→Saldo Final), Fiscal e Formas de Pagamento.
 */
export function interpretTabela6FromRows(
  rows: EpocFaturamentoCsvRow[],
): Tabela6Interpretacao[] {
  const byKey = new Map<string, EpocFaturamentoCsvRow[]>();
  for (const row of rows) {
    if (normalizeKey(row.secao) !== "tabela_6") continue;
    const key = `${row.dataConsulta}||${row.secao}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const out: Tabela6Interpretacao[] = [];
  for (const [, sectionRows] of byKey) {
    const first = sectionRows[0]!;
    const avisos: string[] = [];
    const tituloSecao = (first.cols[0] ?? "").trim() || null;

    const descricao = findCol1Exact(sectionRows, "Descrição");
    const saldoFinal = findCol1Exact(sectionRows, "Saldo Final");
    const fiscalHeader = findCol1Exact(sectionRows, "Fiscal");
    const formasHeader = findCol1Exact(sectionRows, "Formas de Pagamento");

    if (!descricao) {
      avisos.push('Não encontrei linha com col_1 = "Descrição".');
    } else if (descricao.linhaNaSecao !== 2) {
      avisos.push(
        `Descrição na linha ${descricao.linhaNaSecao} da secção (esperado: 2).`,
      );
    }
    if (!saldoFinal) {
      avisos.push('Não encontrei linha com col_1 = "Saldo Final".');
    }
    if (!fiscalHeader) {
      avisos.push('Não encontrei linha com col_1 = "Fiscal".');
    }
    if (!formasHeader) {
      avisos.push('Não encontrei linha com col_1 = "Formas de Pagamento".');
    }

    const totais: Tabela6LinhaValor[] = [];
    const totaisNaoMapeados: Tabela6LinhaValor[] = [];
    if (descricao && saldoFinal && saldoFinal.index >= descricao.index) {
      for (let i = descricao.index; i <= saldoFinal.index; i++) {
        const row = sectionRows[i]!;
        const rotulo = (row.cols[0] ?? "").trim();
        if (!rotulo) continue;
        const chave = mapTabela6TotaisChave(rotulo);
        if (chave == null) continue; // cabeçalho ignorado
        const item: Tabela6LinhaValor = {
          chave,
          rotulo,
          linhaNaSecao: i + 1,
          valor: row.cols[1] ?? "",
        };
        if (chave === "nao_mapeado") totaisNaoMapeados.push(item);
        else totais.push(item);
      }
      if (totaisNaoMapeados.length > 0) {
        avisos.push(
          `${totaisNaoMapeados.length} rótulo(s) não mapeado(s) entre Descrição e Saldo Final: ${totaisNaoMapeados
            .map((x) => `"${x.rotulo}"`)
            .join(", ")}.`,
        );
      }
    }

    const fiscal: Tabela6FiscalLinha[] = [];
    if (fiscalHeader) {
      const endIdx = formasHeader
        ? formasHeader.index
        : sectionRows.length;
      const foundKeys = new Set<string>();
      for (let i = fiscalHeader.index + 1; i < endIdx; i++) {
        const row = sectionRows[i]!;
        const rotulo = (row.cols[0] ?? "").trim();
        if (!rotulo) continue;
        const labelNorm = normalizeLabel(rotulo);
        // Ignora Data e qualquer col_1 fora das 3 linhas conhecidas.
        if (labelNorm === "data") continue;
        const rule = TABELA6_FISCAL_MAP.find(
          (r) => normalizeLabel(r.label) === labelNorm,
        );
        if (!rule) continue;
        fiscal.push({
          chave: rule.chave,
          rotulo,
          linhaNaSecao: i + 1,
          quantidade: row.cols[1] ?? "",
          valor: row.cols[2] ?? "",
        });
        foundKeys.add(rule.chave);
      }
      for (const rule of TABELA6_FISCAL_MAP) {
        if (!foundKeys.has(rule.chave)) {
          avisos.push(`Fiscal: não encontrei "${rule.label}".`);
        }
      }
    }

    const formasPagamento: Tabela6FormaPagamento[] = [];
    let formasPagamentoTotal: Tabela6FormaPagamento | null = null;
    if (formasHeader) {
      let totalIdx = -1;
      for (let i = formasHeader.index + 1; i < sectionRows.length; i++) {
        if (normalizeLabel(sectionRows[i]!.cols[0] ?? "") === "total") {
          totalIdx = i;
          break;
        }
      }
      if (totalIdx < 0) {
        avisos.push(
          'Após "Formas de Pagamento" não encontrei a primeira linha col_1 = "Total".',
        );
      } else {
        const totalRow = sectionRows[totalIdx]!;
        formasPagamentoTotal = {
          forma: totalRow.cols[0] ?? "Total",
          linhaNaSecao: totalIdx + 1,
          operacao: totalRow.cols[1] ?? "",
          valores: totalRow.cols[2] ?? "",
        };
        for (let i = formasHeader.index + 1; i < totalIdx; i++) {
          const row = sectionRows[i]!;
          const forma = (row.cols[0] ?? "").trim();
          if (!forma) continue;
          const ln = normalizeLabel(forma);
          // pula cabeçalho de colunas, se existir
          if (
            ln === "operacao" ||
            ln === "valores" ||
            ln === "forma" ||
            ln === "formas de pagamento"
          ) {
            continue;
          }
          formasPagamento.push({
            forma,
            linhaNaSecao: i + 1,
            operacao: row.cols[1] ?? "",
            valores: row.cols[2] ?? "",
          });
        }
        if (formasPagamento.length === 0) {
          avisos.push(
            "Nenhuma forma de pagamento entre o cabeçalho e a linha Total.",
          );
        }
      }
    }

    out.push({
      dataConsulta: first.dataConsulta,
      secao: first.secao,
      tituloSecao,
      totalLinhasSecao: sectionRows.length,
      totais,
      totaisNaoMapeados,
      fiscal,
      formasPagamento,
      formasPagamentoTotal,
      avisos,
    });
  }

  return out;
}

export function previewEpocFaturamentoInterpret(
  csvText: string,
  fileName: string,
): EpocFaturamentoInterpretPreview {
  const rows = parseEpocFaturamentoCsv(csvText);
  if (rows.length === 0) {
    return {
      ok: false,
      error: "CSV sem linhas de dados reconhecíveis.",
      fileName,
      totalLinhas: 0,
      secoes: [],
      tabela3: [],
      tabela5: [],
      tabela6: [],
    };
  }
  const secoes = [...new Set(rows.map((r) => r.secao).filter(Boolean))];
  const tabela3 = interpretTabela3FromRows(rows);
  const tabela5 = interpretTabela5FromRows(rows);
  const tabela6 = interpretTabela6FromRows(rows);
  if (tabela3.length === 0 && tabela5.length === 0 && tabela6.length === 0) {
    return {
      ok: false,
      error:
        'Nenhuma secção "tabela_3", "tabela_5" ou "tabela_6" encontrada no CSV.',
      fileName,
      totalLinhas: rows.length,
      secoes,
      tabela3: [],
      tabela5: [],
      tabela6: [],
    };
  }
  return {
    ok: true,
    fileName,
    totalLinhas: rows.length,
    secoes,
    tabela3,
    tabela5,
    tabela6,
  };
}

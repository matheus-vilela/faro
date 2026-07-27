/**
 * Relatório EPOC `mod_rel_venda_servicos`: extrai `#tblExport` (+ tabela resumo) → CSV.
 */
import {
  extractElementOuterHtmlById,
  extractTableRows,
  extractTopLevelTables,
  htmlHasId,
  matrixToCsv,
  normalizeCellText,
  unwrapAcoesHtml,
} from "./epocHtmlExtract.ts";

export const MODULO_REL_VENDA_SERVICOS = "mod_rel_venda_servicos";
export const EPOC_ID_TBL_EXPORT = "tblExport";

export type VendaServicosDayExtract = {
  dataConsulta: string;
  itensCount: number;
  resumoCount: number;
  /** Linhas sem cabeçalho: [data, secao, col1…] */
  rows: string[][];
  maxCols: number;
  message?: string;
};

function extractHeaderAndBody(tableHtml: string): {
  header: string[];
  rows: string[][];
} {
  const all = extractTableRows(tableHtml);
  if (all.length === 0) return { header: [], rows: [] };
  // Preferir linha com <th> — extractTableRows já normaliza texto; se 1.ª parece cabeçalho, usa.
  const header = all[0] ?? [];
  const body = all.slice(1);
  return { header, rows: body };
}

function findResumoTableHtml(containerHtml: string, tblExportHtml: string): string | null {
  const tables = extractTopLevelTables(containerHtml);
  // A tabela de resumo é tipicamente a seguinte após #tblExport (Descrição / Valores).
  let afterExport = false;
  for (const t of tables) {
    if (!afterExport) {
      if (t.html.includes('id="tblExport"') || t.html.includes("id='tblExport'") ||
          t.html === tblExportHtml) {
        afterExport = true;
      }
      continue;
    }
    const rows = extractTableRows(t.html);
    if (rows.length === 0) continue;
    const h0 = normalizeCellText(rows[0]?.[0] ?? "").toLowerCase();
    const h1 = normalizeCellText(rows[0]?.[1] ?? "").toLowerCase();
    if (
      (h0.includes("descri") && h1.includes("valor")) ||
      rows.some((r) =>
        normalizeCellText(r[0] ?? "").toLowerCase().includes("total recebido"),
      )
    ) {
      return t.html;
    }
  }
  return null;
}

/**
 * Extrai itens de `#tblExport` e, se existir, o resumo (Descrição/Valores) ao lado.
 */
export function extractVendaServicosRowsFromAcoesHtml(
  rawAcoesText: string,
  dataConsulta: string,
): VendaServicosDayExtract {
  const html = unwrapAcoesHtml(rawAcoesText);
  if (!htmlHasId(html, EPOC_ID_TBL_EXPORT)) {
    return {
      dataConsulta,
      itensCount: 0,
      resumoCount: 0,
      rows: [],
      maxCols: 0,
      message: "Sem id=tblExport nesta resposta.",
    };
  }
  const tableHtml = extractElementOuterHtmlById(html, EPOC_ID_TBL_EXPORT);
  if (!tableHtml) {
    return {
      dataConsulta,
      itensCount: 0,
      resumoCount: 0,
      rows: [],
      maxCols: 0,
      message: "tblExport não pôde ser extraída do HTML.",
    };
  }

  const parsed = extractHeaderAndBody(tableHtml);
  const rows: string[][] = [];
  let maxCols = 0;

  if (parsed.header.length > 0) {
    maxCols = Math.max(maxCols, parsed.header.length);
    rows.push([dataConsulta, "itens_cabecalho", ...parsed.header]);
  }
  for (const cols of parsed.rows) {
    maxCols = Math.max(maxCols, cols.length);
    rows.push([dataConsulta, "itens", ...cols]);
  }

  const resumoHtml = findResumoTableHtml(html, tableHtml);
  let resumoCount = 0;
  if (resumoHtml) {
    const resumo = extractHeaderAndBody(resumoHtml);
    if (resumo.header.length > 0) {
      maxCols = Math.max(maxCols, resumo.header.length);
      rows.push([dataConsulta, "resumo_cabecalho", ...resumo.header]);
    }
    for (const cols of resumo.rows) {
      maxCols = Math.max(maxCols, cols.length);
      rows.push([dataConsulta, "resumo", ...cols]);
      resumoCount += 1;
    }
  }

  if (parsed.rows.length === 0 && resumoCount === 0) {
    return {
      dataConsulta,
      itensCount: 0,
      resumoCount: 0,
      rows: [],
      maxCols: 0,
      message: "tblExport sem linhas de dados.",
    };
  }

  return {
    dataConsulta,
    itensCount: parsed.rows.length,
    resumoCount,
    rows,
    maxCols,
  };
}

export function buildVendaServicosConsolidatedCsv(
  dayExtracts: VendaServicosDayExtract[],
): {
  csv: string;
  maxCols: number;
  totalRows: number;
  totalItens: number;
  diasComDados: number;
} {
  let maxCols = 0;
  let totalItens = 0;
  let diasComDados = 0;
  const allRows: string[][] = [];
  for (const day of dayExtracts) {
    maxCols = Math.max(maxCols, day.maxCols);
    totalItens += day.itensCount;
    if (day.itensCount > 0 || day.resumoCount > 0) diasComDados += 1;
    for (const r of day.rows) allRows.push(r);
  }
  const header = [
    "data_consulta",
    "secao",
    ...Array.from({ length: maxCols }, (_, i) => `col_${i + 1}`),
  ];
  const padded = allRows.map((r) => {
    const out = r.slice();
    while (out.length < 2 + maxCols) out.push("");
    return out.slice(0, 2 + maxCols);
  });
  return {
    csv: matrixToCsv(header, padded),
    maxCols,
    totalRows: padded.length,
    totalItens,
    diasComDados,
  };
}

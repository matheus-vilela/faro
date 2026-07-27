/**
 * Relatório EPOC `mod_rel_faturamento`: extrai `#spanImprimir` → CSV consolidado com `secao`.
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

export const EPOC_ID_SPAN_IMPRIMIR = "spanImprimir";
export const MODULO_REL_FATURAMENTO = "mod_rel_faturamento";

export type FaturamentoDayExtract = {
  dataConsulta: string;
  secaoCount: number;
  rowCount: number;
  /** Linhas CSV sem cabeçalho: [data, secao, col1…] */
  rows: string[][];
  maxCols: number;
  message?: string;
};

function captionFromTable(tableHtml: string): string | null {
  const m = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
  if (!m) return null;
  const t = normalizeCellText(m[1] ?? "");
  return t.length > 0 ? t : null;
}

/** Texto visível imediatamente antes da tabela (título de secção típico do portal). */
function precedingSectionLabel(
  containerHtml: string,
  tableStart: number,
  prevTableEnd: number,
): string | null {
  const slice = containerHtml.slice(prevTableEnd, tableStart);
  const plain = normalizeCellText(slice);
  if (!plain) return null;
  // Evita rótulos enormes (HTML residual).
  if (plain.length > 120) return plain.slice(0, 120).trim();
  return plain;
}

function sectionLabelForTable(
  containerHtml: string,
  tableHtml: string,
  tableStart: number,
  prevTableEnd: number,
  index1Based: number,
): string {
  const caption = captionFromTable(tableHtml);
  if (caption) return caption;
  const before = precedingSectionLabel(containerHtml, tableStart, prevTableEnd);
  if (before) return before;
  return `tabela_${index1Based}`;
}

/**
 * Converte HTML de resposta `acoes.php` (fase 2 faturamento) em linhas planas.
 * Inclui todas as linhas de todas as tabelas de topo em `#spanImprimir` (sem filtro).
 */
export function extractFaturamentoRowsFromAcoesHtml(
  rawAcoesText: string,
  dataConsulta: string,
): FaturamentoDayExtract {
  const html = unwrapAcoesHtml(rawAcoesText);
  if (!htmlHasId(html, EPOC_ID_SPAN_IMPRIMIR)) {
    return {
      dataConsulta,
      secaoCount: 0,
      rowCount: 0,
      rows: [],
      maxCols: 0,
      message: "Sem id=spanImprimir nesta resposta.",
    };
  }
  const spanHtml = extractElementOuterHtmlById(html, EPOC_ID_SPAN_IMPRIMIR);
  if (!spanHtml) {
    return {
      dataConsulta,
      secaoCount: 0,
      rowCount: 0,
      rows: [],
      maxCols: 0,
      message: "spanImprimir não pôde ser extraído do HTML.",
    };
  }

  const tables = extractTopLevelTables(spanHtml);
  if (tables.length === 0) {
    return {
      dataConsulta,
      secaoCount: 0,
      rowCount: 0,
      rows: [],
      maxCols: 0,
      message: "spanImprimir sem tabelas.",
    };
  }

  const rows: string[][] = [];
  let maxCols = 0;
  let prevEnd = 0;
  let secaoIdx = 0;
  for (const table of tables) {
    secaoIdx += 1;
    const secao = sectionLabelForTable(
      spanHtml,
      table.html,
      table.start,
      prevEnd,
      secaoIdx,
    );
    prevEnd = table.end;
    const tableRows = extractTableRows(table.html);
    for (const cols of tableRows) {
      maxCols = Math.max(maxCols, cols.length);
      rows.push([dataConsulta, secao, ...cols]);
    }
  }

  return {
    dataConsulta,
    secaoCount: tables.length,
    rowCount: rows.length,
    rows,
    maxCols,
  };
}

/** CSV consolidado: data_consulta;secao;col_1;… */
export function buildFaturamentoConsolidatedCsv(
  dayExtracts: FaturamentoDayExtract[],
): {
  csv: string;
  maxCols: number;
  totalRows: number;
  diasComDados: number;
} {
  let maxCols = 0;
  const allRows: string[][] = [];
  let diasComDados = 0;
  for (const day of dayExtracts) {
    maxCols = Math.max(maxCols, day.maxCols);
    if (day.rowCount > 0) diasComDados += 1;
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
    diasComDados,
  };
}

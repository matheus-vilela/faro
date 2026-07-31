/**
 * Relatório EPOC `mod_rel_produto_sintetico`: extrai `#tblExport` → CSV
 * (mesmo critério do sync de produtos: linhas com "Total recebido(R$)" preenchido).
 */
import {
  extractElementOuterHtmlById,
  htmlHasId,
  matrixToCsv,
  normalizeCellText,
  unwrapAcoesHtml,
} from "./epocHtmlExtract.ts";

export const MODULO_REL_PRODUTO_SINTETICO = "mod_rel_produto_sintetico";
export const EPOC_ID_TBL_EXPORT = "tblExport";
export const COL_TOTAL_RECEBIDO = "Total recebido(R$)";

export type ProdutoSinteticoDayExtract = {
  dataConsulta: string;
  /** Linhas incluídas no CSV (após filtro Total recebido, se a coluna existir). */
  rowCount: number;
  /** Linhas brutas da tabela (sem filtro). */
  rawRowCount: number;
  /** Linhas: [data_consulta, ...cols] */
  rows: string[][];
  header: string[];
  maxCols: number;
  message?: string;
};

function normalizeHeaderLabel(h: string): string {
  return normalizeCellText(h)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "");
}

export function findTotalRecebidoColumnIndex(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeaderLabel(headers[i] ?? "");
    if (h.includes("totalrecebido")) return i;
  }
  return -1;
}

function isTotalRecebidoCellFilled(raw: string): boolean {
  const t = raw
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
  return t.length > 0;
}

function extractHeaderAndBody(tableHtml: string): {
  header: string[];
  rows: string[][];
} {
  // Preferir linha com <th> (mesmo critério do epoc-sync-csv).
  const rows: string[][] = [];
  let header: string[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const rowInner = trM[1] ?? "";
    const isHeader = /<th\b/i.test(rowInner);
    const cols: string[] = [];
    const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cM: RegExpExecArray | null;
    while ((cM = cellRe.exec(rowInner)) !== null) {
      cols.push(normalizeCellText(cM[1] ?? ""));
    }
    if (cols.length === 0) continue;
    if (isHeader && header.length === 0) {
      header = cols;
    } else {
      rows.push(cols);
    }
  }
  if (header.length === 0 && rows.length > 0) {
    header = rows.shift() ?? [];
  }
  return { header, rows };
}

/**
 * Extrai itens de `#tblExport` do relatório produto sintético.
 * Mantém só linhas com "Total recebido(R$)" preenchido (quando a coluna existe).
 */
export function extractProdutoSinteticoRowsFromAcoesHtml(
  rawAcoesText: string,
  dataConsulta: string,
): ProdutoSinteticoDayExtract {
  const html = unwrapAcoesHtml(rawAcoesText);
  if (!htmlHasId(html, EPOC_ID_TBL_EXPORT)) {
    return {
      dataConsulta,
      rowCount: 0,
      rawRowCount: 0,
      rows: [],
      header: [],
      maxCols: 0,
      message: "Sem id=tblExport nesta resposta.",
    };
  }
  const tableHtml = extractElementOuterHtmlById(html, EPOC_ID_TBL_EXPORT);
  if (!tableHtml) {
    return {
      dataConsulta,
      rowCount: 0,
      rawRowCount: 0,
      rows: [],
      header: [],
      maxCols: 0,
      message: "tblExport não pôde ser extraída do HTML.",
    };
  }

  const parsed = extractHeaderAndBody(tableHtml);
  if (parsed.header.length === 0) {
    return {
      dataConsulta,
      rowCount: 0,
      rawRowCount: 0,
      rows: [],
      header: [],
      maxCols: 0,
      message: "Tabela sem cabeçalho legível.",
    };
  }

  const totalIdx = findTotalRecebidoColumnIndex(parsed.header);
  const targetLen = parsed.header.length;
  const rows: string[][] = [];
  for (const cols of parsed.rows) {
    const ajustada = cols.slice(0, targetLen);
    while (ajustada.length < targetLen) ajustada.push("");
    if (totalIdx >= 0) {
      const totalCell = ajustada[totalIdx] ?? "";
      if (!isTotalRecebidoCellFilled(totalCell)) continue;
    }
    rows.push([dataConsulta, ...ajustada]);
  }

  if (parsed.rows.length === 0) {
    return {
      dataConsulta,
      rowCount: 0,
      rawRowCount: 0,
      rows: [],
      header: parsed.header,
      maxCols: parsed.header.length,
      message: "tblExport sem linhas de dados.",
    };
  }

  if (rows.length === 0) {
    return {
      dataConsulta,
      rowCount: 0,
      rawRowCount: parsed.rows.length,
      rows: [],
      header: parsed.header,
      maxCols: parsed.header.length,
      message:
        totalIdx >= 0
          ? `tblExport com ${parsed.rows.length} linha(s), nenhuma com Total recebido preenchido.`
          : "tblExport sem linhas utilizáveis.",
    };
  }

  return {
    dataConsulta,
    rowCount: rows.length,
    rawRowCount: parsed.rows.length,
    rows,
    header: parsed.header,
    maxCols: parsed.header.length,
  };
}

export function buildProdutoSinteticoConsolidatedCsv(
  dayExtracts: ProdutoSinteticoDayExtract[],
): {
  csv: string;
  maxCols: number;
  totalRows: number;
  diasComDados: number;
  header: string[];
} {
  let headerBase: string[] = [];
  let maxCols = 0;
  let diasComDados = 0;
  const allRows: string[][] = [];

  for (const day of dayExtracts) {
    if (day.header.length > 0 && headerBase.length === 0) {
      headerBase = day.header.slice();
    }
    maxCols = Math.max(maxCols, day.maxCols, day.header.length);
    if (day.rowCount > 0) diasComDados += 1;
    for (const r of day.rows) allRows.push(r);
  }

  const csvHeader = ["data_consumo", ...headerBase];
  const targetLen = csvHeader.length;
  const padded = allRows.map((r) => {
    const out = r.slice();
    while (out.length < targetLen) out.push("");
    return out.slice(0, targetLen);
  });

  return {
    csv: matrixToCsv(csvHeader, padded),
    maxCols,
    totalRows: padded.length,
    diasComDados,
    header: csvHeader,
  };
}

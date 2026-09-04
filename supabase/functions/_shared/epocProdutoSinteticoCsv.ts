/**
 * Relatório EPOC `mod_rel_produto_sintetico`: extrai `#tblExport` → CSV
 * (mesmo critério do sync de produtos: linhas com "Total Bruto(R$)" preenchido).
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
export const COL_TOTAL_BRUTO = "Total Bruto(R$)";

export type ProdutoSinteticoDayExtract = {
  dataConsulta: string;
  /** Linhas incluídas no CSV (após filtro Total Bruto, se a coluna existir). */
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

const COL_PRODUTO_ALIASES = [
  "produto",
  "nomedoproduto",
  "nomeproduto",
  "descricao",
];
const COL_SKU_ALIASES = [
  "sku",
  "codigo",
  "cod",
  "codproduto",
  "codigoproduto",
];

function resolveHeaderCol(normHeaders: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const j = normHeaders.indexOf(alias);
    if (j >= 0) return j;
  }
  return -1;
}

/** SKU/nome das linhas de venda (Total Bruto preenchido, quando a coluna existe). */
export function extractSoldProdutoKeys(
  header: string[],
  rows: string[][],
): Array<{ sku: string; name: string }> {
  if (header.length === 0) return [];
  const norm = header.map(normalizeHeaderLabel);
  let produtoCol = resolveHeaderCol(norm, COL_PRODUTO_ALIASES);
  if (produtoCol < 0) {
    produtoCol = norm.findIndex(
      (h) => h.includes("produto") || h.includes("descricao"),
    );
  }
  if (produtoCol < 0) return [];
  let skuCol = resolveHeaderCol(norm, COL_SKU_ALIASES);
  if (skuCol < 0) {
    skuCol = norm.findIndex(
      (h) => h.includes("sku") || h === "codigo" || h.startsWith("cod"),
    );
  }
  const totalIdx = findTotalBrutoColumnIndex(header);
  const out: Array<{ sku: string; name: string }> = [];
  for (const row of rows) {
    if (totalIdx >= 0 && !isTotalBrutoCellFilled(row[totalIdx] ?? "")) continue;
    const name = (row[produtoCol] ?? "").trim();
    if (!name) continue;
    out.push({
      sku: skuCol >= 0 ? (row[skuCol] ?? "").trim() : "",
      name,
    });
  }
  return out;
}

export function findTotalBrutoColumnIndex(headers: string[]): number {
  const want = normalizeHeaderLabel(COL_TOTAL_BRUTO);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeaderLabel(headers[i] ?? "") === want) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeaderLabel(headers[i] ?? "");
    if (h.includes("totalbruto")) return i;
  }
  return -1;
}

function isTotalBrutoCellFilled(raw: string): boolean {
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
 * Mantém só linhas com "Total Bruto(R$)" preenchido (quando a coluna existe).
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

  const totalIdx = findTotalBrutoColumnIndex(parsed.header);
  const targetLen = parsed.header.length;
  const rows: string[][] = [];
  for (const cols of parsed.rows) {
    const ajustada = cols.slice(0, targetLen);
    while (ajustada.length < targetLen) ajustada.push("");
    if (totalIdx >= 0) {
      const totalCell = ajustada[totalIdx] ?? "";
      if (!isTotalBrutoCellFilled(totalCell)) continue;
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
          ? `tblExport com ${parsed.rows.length} linha(s), nenhuma com Total Bruto preenchido.`
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

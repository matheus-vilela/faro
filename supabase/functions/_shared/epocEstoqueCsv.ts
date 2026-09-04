/**
 * Relatório EPOC `mod_rel_estoque`: extrai `#tblExport` (grupos + itens).
 * Só linhas com ação Saída.
 */
import {
  extractElementOuterHtmlById,
  htmlHasId,
  matrixToCsv,
  normalizeCellText,
  unwrapAcoesHtml,
} from "./epocHtmlExtract.ts";
import { parsePtBrNumber } from "./epocPtBrNumber.ts";

export const MODULO_REL_ESTOQUE = "mod_rel_estoque";
export const EPOC_ID_TBL_EXPORT = "tblExport";

/** Body do `acoes.php` para um dia — mesmo do portal (action=FILTRAR). */
export function epocEstoqueFiltrarAcoesBody(
  diaBr: string,
  naoMenu: string,
  token: string,
): Record<string, string> {
  return {
    modulo: MODULO_REL_ESTOQUE,
    NaoMenu: naoMenu,
    action: "FILTRAR",
    token,
    data_de: diaBr,
    data_ate: diaBr,
    hr_de: "00:00",
    hr_ate: "23:59",
    tipo_relatorio: "N",
    cod_estq: "0",
    entrada: "on",
    saida: "on",
    baixa: "on",
    estorno: "on",
    movimentacao: "on",
    correcao: "on",
    cod_estq_sai: "0",
    cod_estq_entr: "0",
    cod_estq_grup: "",
    cod_estq_item: "0",
    cod_func: "0",
  };
}

const GROUP_RE = /^(\d+(?:\.\d+)*)\s+-\s+(.+)$/;
const ITEM_RE = /^-\s+(\S+)\s+-\s+(.+)$/;

export type EpocEstoqueSaidaItem = {
  sku: string;
  nome: string;
  categorias: string[];
  categoria_path: string;
  acao: string;
  obs: string;
  qtde: number | null;
  qtde_unidade: string;
  qtde_raw: string;
  qtde_volume_saida: number | null;
  custo_total: number | null;
};

export type EpocEstoqueDayExtract = {
  dataConsulta: string;
  items: EpocEstoqueSaidaItem[];
  rawRowCount: number;
  groupRowCount: number;
  saidaCount: number;
  otherActionCount: number;
  totalCusto: number;
  message?: string;
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function isSaidaAction(raw: string): boolean {
  const t = stripAccents(normalizeCellText(raw)).toLowerCase();
  return t === "saida";
}

function parseQtyCell(raw: string): { qty: number | null; unit: string } {
  const t = raw.replace(/\u00a0/g, " ").trim();
  const m = /^(.+?)\s+([A-Za-z%]+)$/.exec(t);
  if (m) {
    return { qty: parsePtBrNumber(m[1] ?? ""), unit: (m[2] ?? "").trim() };
  }
  return { qty: parsePtBrNumber(t), unit: "" };
}

function extractHeaderAndBody(tableHtml: string): {
  header: string[];
  rows: string[][];
} {
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

function applyGroup(
  stack: { code: string; name: string }[],
  code: string,
  name: string,
): void {
  const depth = code.split(".").length;
  stack.length = Math.max(0, depth - 1);
  stack.push({ code, name });
}

export function extractEstoqueSaidaFromAcoesHtml(
  rawAcoesText: string,
  dataConsulta: string,
): EpocEstoqueDayExtract {
  const empty = (message: string): EpocEstoqueDayExtract => ({
    dataConsulta,
    items: [],
    rawRowCount: 0,
    groupRowCount: 0,
    saidaCount: 0,
    otherActionCount: 0,
    totalCusto: 0,
    message,
  });

  const html = unwrapAcoesHtml(rawAcoesText);
  if (!htmlHasId(html, EPOC_ID_TBL_EXPORT)) {
    return empty("Sem id=tblExport nesta resposta.");
  }
  const tableHtml = extractElementOuterHtmlById(html, EPOC_ID_TBL_EXPORT);
  if (!tableHtml) {
    return empty("tblExport não pôde ser extraída do HTML.");
  }

  const parsed = extractHeaderAndBody(tableHtml);
  if (parsed.rows.length === 0) {
    return empty("tblExport sem linhas de dados.");
  }

  const stack: { code: string; name: string }[] = [];
  const items: EpocEstoqueSaidaItem[] = [];
  let groupRowCount = 0;
  let otherActionCount = 0;

  for (const cols of parsed.rows) {
    const first = (cols[0] ?? "").trim();
    if (!first || /^totais$/i.test(first)) continue;

    const group = GROUP_RE.exec(first);
    if (group) {
      applyGroup(stack, group[1] ?? "", (group[2] ?? "").trim());
      groupRowCount += 1;
      continue;
    }

    const item = ITEM_RE.exec(first);
    if (!item) continue;

    const acao = (cols[1] ?? "").trim();
    if (!isSaidaAction(acao)) {
      otherActionCount += 1;
      continue;
    }

    const qtdeRaw = (cols[3] ?? "").trim();
    const { qty, unit } = parseQtyCell(qtdeRaw);
    const categorias = stack.map((g) => g.name);
    items.push({
      sku: (item[1] ?? "").trim(),
      nome: (item[2] ?? "").trim(),
      categorias,
      categoria_path: categorias.join(" › "),
      acao: "Saída",
      obs: (cols[2] ?? "").replace(/^-\s*$/, "").trim(),
      qtde: qty,
      qtde_unidade: unit,
      qtde_raw: qtdeRaw,
      qtde_volume_saida: parsePtBrNumber(cols[4] ?? ""),
      custo_total: parsePtBrNumber(cols[5] ?? ""),
    });
  }

  const totalCusto = items.reduce((acc, it) => acc + (it.custo_total ?? 0), 0);

  if (items.length === 0) {
    return {
      dataConsulta,
      items: [],
      rawRowCount: parsed.rows.length,
      groupRowCount,
      saidaCount: 0,
      otherActionCount,
      totalCusto: 0,
      message:
        groupRowCount > 0
          ? `tblExport com ${parsed.rows.length} linha(s), nenhuma Saída utilizável.`
          : "tblExport sem linhas de Saída.",
    };
  }

  return {
    dataConsulta,
    items,
    rawRowCount: parsed.rows.length,
    groupRowCount,
    saidaCount: items.length,
    otherActionCount,
    totalCusto,
  };
}

export function buildEstoqueSaidaCsv(
  dataConsulta: string,
  items: EpocEstoqueSaidaItem[],
): string {
  const header = [
    "data",
    "sku",
    "nome",
    "categorias",
    "qtde",
    "unidade",
    "qtde_volume_saida",
    "custo_total",
  ];
  const rows = items.map((it) => [
    dataConsulta,
    it.sku,
    it.nome,
    it.categoria_path,
    it.qtde == null ? "" : String(it.qtde).replace(".", ","),
    it.qtde_unidade,
    it.qtde_volume_saida == null
      ? ""
      : String(it.qtde_volume_saida).replace(".", ","),
    it.custo_total == null ? "" : String(it.custo_total).replace(".", ","),
  ]);
  return matrixToCsv(header, rows);
}

import * as XLSX from "xlsx";

import { SYSTEM_PRODUCT_UNITS } from "@/lib/companyUnits/systemUnits";

export type ParsedProductRow = {
  name: string;
  /** Código da unidade — catálogo fixo do sistema (igual ao cadastro manual). */
  unit: string;
  current_quantity: number;
  min_quantity: number;
  last_unit_value: number | null;
  /** 1-based linha na planilha (para exibir erro) */
  sourceRow: number;
};

const NAME_KEYS = [
  "nome",
  "name",
  "produto",
  "item",
  "descricao",
  "descrição",
  "produtos",
];
const STOCK_KEYS = [
  "quantidade em estoque",
  "estoque",
  "qtd estoque",
  "qtd. estoque",
  "current_quantity",
  "qty",
  "quantidade",
  "saldo",
];
const MIN_KEYS = [
  "quantidade mínima",
  "quantidade minima",
  "minima",
  "mínima",
  "min",
  "min_quantity",
  "estoque minimo",
  "estoque mínimo",
];
const PRICE_KEYS = [
  "ultimo valor pago",
  "último valor pago",
  "ultimo preco",
  "último preço",
  "last_unit_value",
  "valor unitario",
  "valor unitário",
  "preco",
  "preço",
  "ultimo valor",
  "último valor",
];
const UNIT_KEYS = [
  "unidade",
  "unit",
  "uom",
  "medida",
  "tipo unidade",
  "und",
];

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumnIndex(
  headers: string[],
  keys: string[],
): number | null {
  const keysSorted = [...keys].sort((a, b) => b.length - a.length);
  const norm = headers.map((c) => normalizeHeader(String(c ?? "")));
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h) continue;
    for (const k of keysSorted) {
      if (h === k || h.includes(k)) return i;
    }
  }
  return null;
}

export function parseNumberFlexible(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "");
  if (s === "" || s === "-") return null;
  // Excel às vezes exporta "1.234,56"
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d+$/.test(s)) {
    s = s.replace(",", ".");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

type ColMap = {
  name: number;
  /** índice da coluna de unidade; null = não informado (usa "un") */
  unit: number | null;
  stock: number;
  min: number;
  price: number | null;
};

const ALLOWED_UNITS = new Set(
  SYSTEM_PRODUCT_UNITS.map((u) => u.code.toLowerCase()),
);

export function normalizeImportUnit(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "");
  if (!s) return "un";
  if (ALLOWED_UNITS.has(s)) return s;
  if (s === "lt" || s.includes("litro")) return "l";
  if (
    s.includes("kg") ||
    s === "quilograma" ||
    s === "kilograma" ||
    s === "quilo"
  )
    return "kg";
  if (s.includes("miligrama") || s === "mgr") return "mg";
  if ((s.includes("grama") || s === "gr") && !s.includes("miligrama")) return "g";
  if (s.includes("mililitro") || s.includes("ml")) return "ml";
  if (s.includes("caixa")) return "cx";
  if (s.includes("pacote") || s.includes("pct")) return "pct";
  if (s === "unidade" || s === "und" || s === "u") return "un";
  if (s.includes("lata")) return "lata";
  if (s.includes("garrafa")) return "garrafa";
  if (s.includes("frasco")) return "frasco";
  if (s.includes("galão") || s.includes("galao")) return "galao";
  if (s.includes("pote")) return "pote";
  if (s.includes("rolo")) return "rolo";
  if (s.includes("saco")) return "saco";
  if (s.includes("barrica")) return "barrica";
  if (s.includes("tambor")) return "tambor";
  if (s.includes("fardo")) return "fardo";
  if (s.includes("bisnaga")) return "bisnaga";
  if (s.includes("maço") || s.includes("maco")) return "maco";
  if (s.includes("bandeja") || s.includes("bandeija")) return "bandeja";
  if (s.includes("peça") || s.includes("peca") || s === "pc") return "pc";
  return "un";
}

function mapHeaders(headers: string[]): ColMap | null {
  const nameI = findColumnIndex(headers, NAME_KEYS);
  const unitI = findColumnIndex(headers, UNIT_KEYS);
  const stockI = findColumnIndex(headers, STOCK_KEYS);
  const minI = findColumnIndex(headers, MIN_KEYS);
  const priceI = findColumnIndex(headers, PRICE_KEYS);
  if (nameI !== null && stockI !== null && minI !== null) {
    return { name: nameI, unit: unitI, stock: stockI, min: minI, price: priceI };
  }
  return null;
}

function looksLikeHeaderRow(firstRow: unknown[]): boolean {
  if (!firstRow?.length) return false;
  const asText = firstRow.map((c) => String(c ?? "").trim());
  const hasName = findColumnIndex(asText, NAME_KEYS) !== null;
  const hasStock = findColumnIndex(asText, STOCK_KEYS) !== null;
  const hasMin = findColumnIndex(asText, MIN_KEYS) !== null;
  return hasName && hasStock && hasMin;
}

function rowsFromSheet(sheet: XLSX.WorkSheet): unknown[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
}

export type ParseProductImportResult = {
  rows: ParsedProductRow[];
  warnings: string[];
  skippedEmpty: number;
};

export async function parseProductImportFile(
  file: File,
): Promise<ParseProductImportResult> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array", cellDates: false });
  const firstName = workbook.SheetNames[0];
  if (!firstName) {
    return { rows: [], warnings: ["Arquivo sem abas."], skippedEmpty: 0 };
  }
  const sheet = workbook.Sheets[firstName];
  const matrix = rowsFromSheet(sheet).filter((row) =>
    row.some((c) => String(c ?? "").trim() !== ""),
  );
  if (matrix.length === 0) {
    return { rows: [], warnings: ["Planilha vazia."], skippedEmpty: 0 };
  }

  let dataStart = 0;
  let colMap: ColMap;

  const headerCandidate = matrix[0].map((c) => String(c ?? ""));
  if (looksLikeHeaderRow(matrix[0])) {
    const mapped = mapHeaders(headerCandidate);
    if (mapped) {
      colMap = mapped;
      dataStart = 1;
    } else {
      colMap = { name: 0, unit: 1, stock: 2, min: 3, price: 4 };
      dataStart = 1;
    }
  } else {
    colMap = { name: 0, unit: 1, stock: 2, min: 3, price: 4 };
    dataStart = 0;
  }

  const rows: ParsedProductRow[] = [];
  const warnings: string[] = [];
  let skippedEmpty = 0;

  const requiredCols =
    Math.max(
      colMap.name,
      colMap.unit ?? -1,
      colMap.stock,
      colMap.min,
    ) + 1;

  for (let r = dataStart; r < matrix.length; r++) {
    const line = matrix[r];
    const excelRow = r + 1;
    if (!line || line.length < requiredCols) {
      skippedEmpty++;
      continue;
    }

    const nameRaw = String(line[colMap.name] ?? "").trim();
    if (!nameRaw) {
      skippedEmpty++;
      continue;
    }

    const unitRaw =
      colMap.unit != null
        ? String(line[colMap.unit] ?? "").trim()
        : "";
    const unit = normalizeImportUnit(unitRaw);

    const stock = parseNumberFlexible(line[colMap.stock]);
    const minQ = parseNumberFlexible(line[colMap.min]);
    const price =
      colMap.price != null
        ? parseNumberFlexible(line[colMap.price])
        : null;

    if (stock === null) {
      warnings.push(`Linha ${excelRow}: quantidade em estoque inválida ou vazia (“${String(line[colMap.stock] ?? "")}”).`);
      continue;
    }
    if (minQ === null) {
      warnings.push(`Linha ${excelRow}: quantidade mínima inválida ou vazia (“${String(line[colMap.min] ?? "")}”).`);
      continue;
    }
    if (stock < 0 || minQ < 0) {
      warnings.push(`Linha ${excelRow}: quantidades não podem ser negativas.`);
      continue;
    }

    rows.push({
      name: nameRaw,
      unit,
      current_quantity: stock,
      min_quantity: minQ,
      last_unit_value: price != null && price >= 0 ? price : null,
      sourceRow: excelRow,
    });
  }

  if (!looksLikeHeaderRow(matrix[0]) && dataStart === 0) {
    warnings.push(
      "Primeira linha foi tratada como dados (ordem: nome, unidade, estoque, mínimo, último preço opcional). Se tiver cabeçalho, use a primeira linha com os títulos.",
    );
  }

  return { rows, warnings, skippedEmpty };
}

export function generateImportSku(index: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) {
    suffix += chars[arr[i]! % chars.length];
  }
  return `IMP-${index}-${suffix}`;
}

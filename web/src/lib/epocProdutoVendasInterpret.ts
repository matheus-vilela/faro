/**
 * Interpretação do CSV de venda de produtos EPOC (`data_consumo` + #tblExport).
 * Preview client-side: por dia e por produto (criar vs usar existente), qty e valores.
 */

export type CatalogProduct = {
  id: string;
  name: string;
  unit?: string | null;
  is_active?: boolean | null;
};

export type CatalogRecipe = {
  id: string;
  name: string;
};

export type ProdutoVendaSkipReason =
  | "total_invalido"
  | "data_invalida"
  | "quantidade_invalida"
  | "produto_vazio"
  | "nome_ambiguo";

export type ProdutoVendaCatalogAction =
  | "create_product"
  | "match_product"
  | "match_recipe"
  | "manual_review";

export type ProdutoVendaLine = {
  rowNumber: number;
  dataConsumo: string;
  dataIso: string | null;
  productName: string;
  quantity: number | null;
  totalRecebido: number | null;
  unitPrice: number | null;
  skipReason: ProdutoVendaSkipReason | null;
  catalogAction: ProdutoVendaCatalogAction | null;
  matchedId: string | null;
  matchedLabel: string | null;
  matchedUnit: string | null;
};

export type ProdutoVendaDaySummary = {
  dataIso: string;
  dataLabel: string;
  lineCount: number;
  quantity: number;
  totalRecebido: number;
  uniqueProducts: number;
  wouldCreate: number;
  wouldMatch: number;
};

export type ProdutoVendaProductSummary = {
  key: string;
  productName: string;
  catalogAction: ProdutoVendaCatalogAction;
  matchedId: string | null;
  matchedLabel: string | null;
  matchedUnit: string | null;
  lineCount: number;
  quantity: number;
  totalRecebido: number;
  avgUnitPrice: number | null;
  days: string[];
};

export type ProdutoVendasInterpretPreview = {
  ok: boolean;
  error?: string;
  fileName: string;
  headers: string[];
  columns: {
    dataConsumo: number;
    produto: number;
    quantidade: number;
    totalRecebido: number;
  };
  totals: {
    rawRows: number;
    validLines: number;
    skippedLines: number;
    uniqueProducts: number;
    wouldCreateProducts: number;
    wouldMatchProducts: number;
    wouldMatchRecipes: number;
    manualReview: number;
    quantity: number;
    totalRecebido: number;
    days: number;
  };
  days: ProdutoVendaDaySummary[];
  products: ProdutoVendaProductSummary[];
  skipped: Array<{
    rowNumber: number;
    productName: string;
    reason: ProdutoVendaSkipReason;
    detail: string;
  }>;
  /** Amostra das linhas válidas (cap). */
  sampleLines: ProdutoVendaLine[];
};

const COL_TOTAL_BRUTO = "Total Bruto(R$)";
const COL_PRODUTO_ALIASES = [
  "Produto",
  "Nome do produto",
  "Nome Produto",
  "Descrição",
  "Descricao",
];
const COL_QUANT_ALIASES = [
  "Quant.",
  "Quant",
  "Quantidade",
  "Qtd.",
  "Qtd",
  "QTDE",
  "Qtde",
  "Qtde.",
];

function normalizeHeaderLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function sanitizeCell(s: string): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
}

export function epocExactNameKey(raw: string): string {
  return sanitizeCell(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ";") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseEpocProdutoVendasCsv(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]!).map((c) => sanitizeCell(c));
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(parseCsvLine(lines[i]!).map((c) => sanitizeCell(c)));
  }
  return { headers, rows };
}

function resolveQuantColumnIndex(normHeaders: string[]): number {
  for (const alias of COL_QUANT_ALIASES) {
    const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i]!;
    if (h === "quant" || h === "qtd" || h === "qtde" || h === "qty") return i;
    if (h.startsWith("quantidade") || h.startsWith("qtd") || h.startsWith("qtde")) {
      return i;
    }
  }
  return -1;
}

function resolveProductColumnIndex(normHeaders: string[]): number {
  for (const alias of COL_PRODUTO_ALIASES) {
    const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i]!;
    if (h.includes("produto") || h.includes("descricao")) return i;
  }
  return -1;
}

function parseBrDateToIso(s: string): string | null {
  const t = sanitizeCell(s);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    const y = Number(br[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function parseBrMoney(s: string): number | null {
  const t = sanitizeCell(s)
    .replace(/R\$\s?/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseBrQuantity(s: string): number | null {
  const t = sanitizeCell(s).replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveCatalogAction(
  productName: string,
  products: CatalogProduct[],
  recipes: CatalogRecipe[],
): Pick<
  ProdutoVendaLine,
  "catalogAction" | "matchedId" | "matchedLabel" | "matchedUnit" | "skipReason"
> {
  const key = epocExactNameKey(productName);
  if (!key) {
    return {
      catalogAction: null,
      matchedId: null,
      matchedLabel: null,
      matchedUnit: null,
      skipReason: "produto_vazio",
    };
  }

  const activeProducts = products.filter((p) => p.is_active !== false);
  const productHits = activeProducts.filter(
    (p) => epocExactNameKey(p.name) === key,
  );
  if (productHits.length > 1) {
    return {
      catalogAction: "manual_review",
      matchedId: null,
      matchedLabel: null,
      matchedUnit: null,
      skipReason: "nome_ambiguo",
    };
  }
  if (productHits.length === 1) {
    const p = productHits[0]!;
    return {
      catalogAction: "match_product",
      matchedId: p.id,
      matchedLabel: p.name,
      matchedUnit: p.unit ?? null,
      skipReason: null,
    };
  }

  const recipeHits = recipes.filter((r) => epocExactNameKey(r.name) === key);
  if (recipeHits.length === 1) {
    const r = recipeHits[0]!;
    return {
      catalogAction: "match_recipe",
      matchedId: r.id,
      matchedLabel: r.name,
      matchedUnit: null,
      skipReason: null,
    };
  }
  if (recipeHits.length > 1) {
    return {
      catalogAction: "manual_review",
      matchedId: null,
      matchedLabel: null,
      matchedUnit: null,
      skipReason: "nome_ambiguo",
    };
  }

  return {
    catalogAction: "create_product",
    matchedId: null,
    matchedLabel: null,
    matchedUnit: null,
    skipReason: null,
  };
}

const SAMPLE_CAP = 80;

export function previewEpocProdutoVendasInterpret(
  csvText: string,
  fileName: string,
  catalogInput: { products: CatalogProduct[]; recipes: CatalogRecipe[] },
): ProdutoVendasInterpretPreview {
  const emptyCols = {
    dataConsumo: -1,
    produto: -1,
    quantidade: -1,
    totalRecebido: -1,
  };
  const emptyTotals = {
    rawRows: 0,
    validLines: 0,
    skippedLines: 0,
    uniqueProducts: 0,
    wouldCreateProducts: 0,
    wouldMatchProducts: 0,
    wouldMatchRecipes: 0,
    manualReview: 0,
    quantity: 0,
    totalRecebido: 0,
    days: 0,
  };

  const { headers, rows } = parseEpocProdutoVendasCsv(csvText);
  if (headers.length === 0) {
    return {
      ok: false,
      error: "CSV vazio ou sem cabeçalho.",
      fileName,
      headers: [],
      columns: emptyCols,
      totals: emptyTotals,
      days: [],
      products: [],
      skipped: [],
      sampleLines: [],
    };
  }

  const normHeaders = headers.map(normalizeHeaderLabel);
  const dataCol = normHeaders.indexOf(normalizeHeaderLabel("data_consumo"));
  const wantTotal = normalizeHeaderLabel(COL_TOTAL_BRUTO);
  let totalCol = normHeaders.indexOf(wantTotal);
  if (totalCol < 0) {
    totalCol = normHeaders.findIndex((h) => h.includes("totalbruto"));
  }
  const quantCol = resolveQuantColumnIndex(normHeaders);
  const produtoCol = resolveProductColumnIndex(normHeaders);

  if (dataCol < 0) {
    return {
      ok: false,
      error: 'Coluna "data_consumo" não encontrada no CSV.',
      fileName,
      headers,
      columns: {
        dataConsumo: dataCol,
        produto: produtoCol,
        quantidade: quantCol,
        totalRecebido: totalCol,
      },
      totals: { ...emptyTotals, rawRows: rows.length },
      days: [],
      products: [],
      skipped: [],
      sampleLines: [],
    };
  }
  if (totalCol < 0) {
    return {
      ok: false,
      error: `Coluna "${COL_TOTAL_BRUTO}" não encontrada no CSV.`,
      fileName,
      headers,
      columns: {
        dataConsumo: dataCol,
        produto: produtoCol,
        quantidade: quantCol,
        totalRecebido: totalCol,
      },
      totals: { ...emptyTotals, rawRows: rows.length },
      days: [],
      products: [],
      skipped: [],
      sampleLines: [],
    };
  }
  if (quantCol < 0) {
    return {
      ok: false,
      error: "Coluna de quantidade (Quant. / Qtd) não encontrada no CSV.",
      fileName,
      headers,
      columns: {
        dataConsumo: dataCol,
        produto: produtoCol,
        quantidade: quantCol,
        totalRecebido: totalCol,
      },
      totals: { ...emptyTotals, rawRows: rows.length },
      days: [],
      products: [],
      skipped: [],
      sampleLines: [],
    };
  }
  if (produtoCol < 0) {
    return {
      ok: false,
      error: 'Coluna de produto ("Produto" / descrição) não encontrada no CSV.',
      fileName,
      headers,
      columns: {
        dataConsumo: dataCol,
        produto: produtoCol,
        quantidade: quantCol,
        totalRecebido: totalCol,
      },
      totals: { ...emptyTotals, rawRows: rows.length },
      days: [],
      products: [],
      skipped: [],
      sampleLines: [],
    };
  }

  const lines: ProdutoVendaLine[] = [];
  const skipped: ProdutoVendasInterpretPreview["skipped"] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNumber = i + 2; // 1-based with header
    const dataRaw = row[dataCol] ?? "";
    const productName = sanitizeCell(row[produtoCol] ?? "");
    const qtyRaw = row[quantCol] ?? "";
    const totalRaw = row[totalCol] ?? "";

    const totalRecebido = parseBrMoney(totalRaw);
    if (totalRecebido == null) {
      skipped.push({
        rowNumber,
        productName,
        reason: "total_invalido",
        detail: totalRaw || "(vazio)",
      });
      continue;
    }

    const dataIso = parseBrDateToIso(dataRaw);
    if (!dataIso) {
      skipped.push({
        rowNumber,
        productName,
        reason: "data_invalida",
        detail: dataRaw || "(vazio)",
      });
      continue;
    }

    const quantity = parseBrQuantity(qtyRaw);
    if (quantity == null) {
      skipped.push({
        rowNumber,
        productName,
        reason: "quantidade_invalida",
        detail: qtyRaw || "(vazio)",
      });
      continue;
    }

    if (!productName) {
      skipped.push({
        rowNumber,
        productName: "",
        reason: "produto_vazio",
        detail: "(sem nome)",
      });
      continue;
    }

    const catalog = resolveCatalogAction(
      productName,
      catalogInput.products,
      catalogInput.recipes,
    );
    if (catalog.skipReason === "nome_ambiguo") {
      skipped.push({
        rowNumber,
        productName,
        reason: "nome_ambiguo",
        detail: "Mais de um produto/ficha com o mesmo nome no cadastro.",
      });
      continue;
    }

    lines.push({
      rowNumber,
      dataConsumo: dataRaw,
      dataIso,
      productName,
      quantity,
      totalRecebido,
      unitPrice: quantity > 0 ? totalRecebido / quantity : null,
      skipReason: null,
      catalogAction: catalog.catalogAction,
      matchedId: catalog.matchedId,
      matchedLabel: catalog.matchedLabel,
      matchedUnit: catalog.matchedUnit,
    });
  }

  const validLines = lines;
  const dayMap = new Map<
    string,
    {
      lineCount: number;
      quantity: number;
      totalRecebido: number;
      products: Set<string>;
      wouldCreate: number;
      wouldMatch: number;
    }
  >();
  const productMap = new Map<
    string,
    {
      productName: string;
      catalogAction: ProdutoVendaCatalogAction;
      matchedId: string | null;
      matchedLabel: string | null;
      matchedUnit: string | null;
      lineCount: number;
      quantity: number;
      totalRecebido: number;
      days: Set<string>;
    }
  >();

  for (const line of validLines) {
    const dayKey = line.dataIso!;
    const day = dayMap.get(dayKey) ?? {
      lineCount: 0,
      quantity: 0,
      totalRecebido: 0,
      products: new Set<string>(),
      wouldCreate: 0,
      wouldMatch: 0,
    };
    day.lineCount += 1;
    day.quantity += line.quantity ?? 0;
    day.totalRecebido += line.totalRecebido ?? 0;
    day.products.add(epocExactNameKey(line.productName));
    if (line.catalogAction === "create_product") day.wouldCreate += 1;
    if (
      line.catalogAction === "match_product" ||
      line.catalogAction === "match_recipe"
    ) {
      day.wouldMatch += 1;
    }
    dayMap.set(dayKey, day);

    const pKey = epocExactNameKey(line.productName);
    const prev = productMap.get(pKey);
    if (prev) {
      prev.lineCount += 1;
      prev.quantity += line.quantity ?? 0;
      prev.totalRecebido += line.totalRecebido ?? 0;
      prev.days.add(dayKey);
    } else {
      productMap.set(pKey, {
        productName: line.productName,
        catalogAction: line.catalogAction ?? "create_product",
        matchedId: line.matchedId,
        matchedLabel: line.matchedLabel,
        matchedUnit: line.matchedUnit,
        lineCount: 1,
        quantity: line.quantity ?? 0,
        totalRecebido: line.totalRecebido ?? 0,
        days: new Set([dayKey]),
      });
    }
  }

  const days: ProdutoVendaDaySummary[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dataIso, d]) => ({
      dataIso,
      dataLabel: isoToBr(dataIso),
      lineCount: d.lineCount,
      quantity: d.quantity,
      totalRecebido: d.totalRecebido,
      uniqueProducts: d.products.size,
      wouldCreate: d.wouldCreate,
      wouldMatch: d.wouldMatch,
    }));

  const products: ProdutoVendaProductSummary[] = [...productMap.entries()]
    .map(([key, p]) => ({
      key,
      productName: p.productName,
      catalogAction: p.catalogAction,
      matchedId: p.matchedId,
      matchedLabel: p.matchedLabel,
      matchedUnit: p.matchedUnit,
      lineCount: p.lineCount,
      quantity: p.quantity,
      totalRecebido: p.totalRecebido,
      avgUnitPrice: p.quantity > 0 ? p.totalRecebido / p.quantity : null,
      days: [...p.days].sort(),
    }))
    .sort((a, b) => b.totalRecebido - a.totalRecebido);

  let wouldCreateProducts = 0;
  let wouldMatchProducts = 0;
  let wouldMatchRecipes = 0;
  let manualReview = 0;
  for (const p of products) {
    if (p.catalogAction === "create_product") wouldCreateProducts += 1;
    else if (p.catalogAction === "match_product") wouldMatchProducts += 1;
    else if (p.catalogAction === "match_recipe") wouldMatchRecipes += 1;
    else if (p.catalogAction === "manual_review") manualReview += 1;
  }

  const quantity = validLines.reduce((s, l) => s + (l.quantity ?? 0), 0);
  const totalRecebido = validLines.reduce(
    (s, l) => s + (l.totalRecebido ?? 0),
    0,
  );

  return {
    ok: true,
    fileName,
    headers,
    columns: {
      dataConsumo: dataCol,
      produto: produtoCol,
      quantidade: quantCol,
      totalRecebido: totalCol,
    },
    totals: {
      rawRows: rows.length,
      validLines: validLines.length,
      skippedLines: skipped.length,
      uniqueProducts: products.length,
      wouldCreateProducts,
      wouldMatchProducts,
      wouldMatchRecipes,
      manualReview,
      quantity,
      totalRecebido,
      days: days.length,
    },
    days,
    products,
    skipped,
    sampleLines: validLines.slice(0, SAMPLE_CAP),
  };
}

export function catalogActionLabel(action: ProdutoVendaCatalogAction): string {
  switch (action) {
    case "create_product":
      return "Criar produto";
    case "match_product":
      return "Produto existente";
    case "match_recipe":
      return "Ficha existente";
    case "manual_review":
      return "Revisão manual";
  }
}

export function skipReasonLabel(reason: ProdutoVendaSkipReason): string {
  switch (reason) {
    case "total_invalido":
      return "Total bruto inválido";
    case "data_invalida":
      return "Data inválida";
    case "quantidade_invalida":
      return "Quantidade inválida";
    case "produto_vazio":
      return "Produto vazio";
    case "nome_ambiguo":
      return "Nome ambíguo no cadastro";
  }
}

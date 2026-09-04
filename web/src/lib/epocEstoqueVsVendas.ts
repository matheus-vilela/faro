import type { EpocEstoqueSaidaItem } from "@/services/epocEstoqueExportService";
import {
  epocExactNameKey,
  parseBrMoney,
  parseBrQuantity,
  parseEpocProdutoVendasCsv,
} from "@/lib/epocProdutoVendasInterpret";

export type VendaProdutoDiaItem = {
  sku: string | null;
  nome: string;
  qtde: number | null;
  total: number | null;
};

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

function normalizeHeaderLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function resolveCol(normHeaders: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const j = normHeaders.indexOf(alias);
    if (j >= 0) return j;
  }
  return -1;
}

function resolveQuantCol(normHeaders: string[]): number {
  const exact = resolveCol(normHeaders, [
    "quant.",
    "quant",
    "quantidade",
    "qtd.",
    "qtd",
    "qtde",
    "qtde.",
    "qty",
  ]);
  if (exact >= 0) return exact;
  return normHeaders.findIndex(
    (h) =>
      h.startsWith("quantidade") || h.startsWith("qtd") || h.startsWith("qtde"),
  );
}

function resolveSkuCol(normHeaders: string[]): number {
  const exact = resolveCol(normHeaders, COL_SKU_ALIASES);
  if (exact >= 0) return exact;
  return normHeaders.findIndex(
    (h) => h.includes("sku") || h === "codigo" || h.startsWith("cod"),
  );
}

function resolveProdutoCol(normHeaders: string[]): number {
  const exact = resolveCol(normHeaders, COL_PRODUTO_ALIASES);
  if (exact >= 0) return exact;
  return normHeaders.findIndex(
    (h) => h.includes("produto") || h.includes("descricao"),
  );
}

/** Relatório EPOC sem tabela no dia — não é falha de credencial. */
export function isEpocEmptyReportError(error: string): boolean {
  const t = error.toLowerCase();
  return (
    t.includes("tblexport") ||
    t.includes("nenhuma tabela") ||
    t.includes("nenhuma saída") ||
    t.includes("nenhuma saida")
  );
}

export function parseVendaProdutosCsvItems(
  csv: string,
): VendaProdutoDiaItem[] {
  const { headers, rows } = parseEpocProdutoVendasCsv(csv);
  if (headers.length === 0) return [];
  const norm = headers.map(normalizeHeaderLabel);
  const produtoCol = resolveProdutoCol(norm);
  if (produtoCol < 0) return [];
  const quantCol = resolveQuantCol(norm);
  const skuCol = resolveSkuCol(norm);
  const totalCol = norm.findIndex((h) => h.includes("totalbruto"));

  const out: VendaProdutoDiaItem[] = [];
  for (const row of rows) {
    const nome = (row[produtoCol] ?? "").trim();
    if (!nome) continue;
    const skuRaw = skuCol >= 0 ? (row[skuCol] ?? "").trim() : "";
    out.push({
      sku: skuRaw || null,
      nome,
      qtde: quantCol >= 0 ? parseBrQuantity(row[quantCol] ?? "") : null,
      total: totalCol >= 0 ? parseBrMoney(row[totalCol] ?? "") : null,
    });
  }
  return out;
}

function vendaKeys(vendas: VendaProdutoDiaItem[]): {
  names: Set<string>;
  skus: Set<string>;
} {
  const names = new Set<string>();
  const skus = new Set<string>();
  for (const v of vendas) {
    const nameKey = epocExactNameKey(v.nome);
    if (nameKey) names.add(nameKey);
    const sku = (v.sku ?? "").trim();
    if (sku) skus.add(sku);
  }
  return { names, skus };
}

function itemEstaNaVenda(
  item: EpocEstoqueSaidaItem,
  keys: { names: Set<string>; skus: Set<string> },
): boolean {
  const sku = item.sku.trim();
  if (sku && keys.skus.has(sku)) return true;
  const nameKey = epocExactNameKey(item.nome);
  return Boolean(nameKey && keys.names.has(nameKey));
}

/** Saídas de estoque cujo SKU/nome não aparece na venda do dia. */
export function listEstoqueSemVenda(
  estoque: EpocEstoqueSaidaItem[],
  vendas: VendaProdutoDiaItem[],
): EpocEstoqueSaidaItem[] {
  const keys = vendaKeys(vendas);
  const seen = new Set<string>();
  const out: EpocEstoqueSaidaItem[] = [];
  for (const item of estoque) {
    if (itemEstaNaVenda(item, keys)) continue;
    const uniq = item.sku.trim() || epocExactNameKey(item.nome);
    if (!uniq || seen.has(uniq)) continue;
    seen.add(uniq);
    out.push(item);
  }
  return out;
}

export type LinkedVariantKey = {
  sku: string | null;
  name: string;
};

export function isLinkedSaleFamilyVariant(
  item: Pick<EpocEstoqueSaidaItem, "sku" | "nome">,
  linked: LinkedVariantKey[],
): boolean {
  const sku = item.sku.trim();
  const nameKey = epocExactNameKey(item.nome);
  for (const row of linked) {
    if (sku && (row.sku ?? "").trim() === sku) return true;
    if (nameKey && epocExactNameKey(row.name) === nameKey) return true;
  }
  return false;
}

/** Só-estoque que ainda não é variante — precisa aparecer para configurar. */
export function listEstoqueSemVendaNaoVinculado(
  estoque: EpocEstoqueSaidaItem[],
  vendas: VendaProdutoDiaItem[],
  linked: LinkedVariantKey[],
): EpocEstoqueSaidaItem[] {
  return listEstoqueSemVenda(estoque, vendas).filter(
    (item) => !isLinkedSaleFamilyVariant(item, linked),
  );
}

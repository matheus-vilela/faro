import { canonicalProductName, stripDiacriticsLower } from "@/lib/productImport/canonicalName";

/**
 * Sinais de nome reutilizados no onboarding (sugestão) e no motor de
 * `importItemResolutionEngine` (bloquear caminho de receita/ficha indevido).
 */
/** Bloqueia ficha de receita / caminho automático de receita (exceto bebida em barril, tratada à parte). */
const RECIPE_FICHA_NAME_PROHIB: Array<{ re: RegExp; label: string }> = [
  { re: /\bmonitor\b/i, label: "equipamento_monitor" },
  { re: /\b(impressora|impress(a|ão))\b/i, label: "equipamento_impressora" },
  { re: /\b(hdmi|teclad|no-break|nobreak|tablet|ipad)\b/i, label: "tecnologia_mesa" },
  { re: /\b(cilindro|g[aá]s\s*(glp|co2)?|\bco2\b)\b/i, label: "gas_cilindro" },
  { re: /\b(bobina)\b/i, label: "bobina" },
  { re: /\b(mesa|utens|panela|faca|t[aá]bua)\b/i, label: "utensilio" },
  { re: /\b(limpeza|detergente|desinfet|agua sanit|papel(aria)?|veja|ype)\b/i, label: "limpeza" },
  {
    re: /\b(embalag|marmita|d\s*lanche|d\s*refe|tampa|fardo|fundo|copo\s*pl|sacol|saco\s*lixo|canud|guardan|filme|bobina\sterm)\b/i,
    label: "embalagem",
  },
  { re: /\b(administrativ|resma|caneta)\b/i, label: "administrativo" },
  { re: /\b(consumo indireto|indiret|mro|manut\w*)\b/i, label: "consumo_indireto" },
  { re: /\b(ativ[oa]?\s*imobilizado|imobiliz)\b/i, label: "ativo" },
  {
    re: /\b(m[aá]quina|equipamento|refrigera|freezer|geladeira|forno|fog[aã]o|ar\s*condic)\b/i,
    label: "equipamento",
  },
];

const BARRIL_CHOPE: RegExp = /\b(barril|chope|chopp|keg|draft)\b/i;

export function matchRecipeFichaProhibitionLabels(productName: string): string[] {
  const raw = (productName ?? "").trim();
  if (!raw) return [];
  const norm = stripDiacriticsLower(raw);
  const out: string[] = [];
  for (const { re, label } of RECIPE_FICHA_NAME_PROHIB) {
    if (re.test(raw) || re.test(canonicalProductName(raw)) || re.test(norm)) out.push(label);
  }
  return out;
}

/**
 * Sinais “negativos” amplos: inclui barril/chope (bebida) para o importador
 * e metadados de linha, sem confundir com a sugestão operacional.
 */
export function matchStrongNegativeLabels(productName: string): string[] {
  const a = matchRecipeFichaProhibitionLabels(productName);
  const raw = (productName ?? "").trim();
  if (BARRIL_CHOPE.test(raw)) {
    return [...a, "barril_chopp"];
  }
  return a;
}

export const POSITIVE_RECIPE_PATTERNS: Array<{ re: RegExp; label: string; weight: number }> = [
  {
    re: /\b(kit|combo|lanche|prato|por[cç][aã]o|receita|preparo|grelhad|assad)\b/i,
    label: "preparo_composto",
    weight: 0.12,
  },
  {
    re: /\b(burger|hamb[uú]rgu|pizza|esfiha|sushi|temaki|buffet)\b/i,
    label: "cardapio_montado",
    weight: 0.1,
  },
];

export const POSITIVE_INSUMO_PATTERNS: Array<{ re: RegExp; label: string; weight: number }> = [
  { re: /\b(kg|g | g\)|g\.|l |l\)|l\.|litro|grama)\b/i, label: "unidade_baixa_gramatura", weight: 0.06 },
  {
    re: /\b(creme|manteiga|azeite|vinagre|sal|a[cç]ucar|a[cç]úcar|farinha|polvilho)\b/i,
    label: "materia_prima",
    weight: 0.1,
  },
  { re: /\b(legume|verdur|frut|carne|frango|peixe|frieza)\b/i, label: "alimento_geral", weight: 0.05 },
];

/**
 * Nome de linha (XML) sugere operação que **não** deve seguir ficha de entrada automática
 * (ex.: equipamento, embalagem, barril de chope).
 */
export function importNameHeuristicBlocksRecipePath(productName: string): boolean {
  return matchStrongNegativeLabels(productName).length > 0;
}

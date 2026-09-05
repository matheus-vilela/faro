import type { CompanyProductCategory } from "@/types/companyProductCategory";
import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function firstCategoryWhoseNameIncludes(
  categories: CompanyProductCategory[],
  needle: string,
): CompanyProductCategory | null {
  const n = norm(needle);
  if (!n) return null;
  const sorted = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  );
  for (const c of sorted) {
    if (norm(c.name).includes(n)) return c;
  }
  return null;
}

const OPERATIONAL_TYPE_TO_KEYWORDS: Record<OperationalItemType, readonly string[]> = {
  INSUMO: [
    "hortifruti",
    "protein",
    "latic",
    "nao perec",
    "congelad",
    "embalag",
    "limpeza",
    "mercado",
    "salgad",
    "insumos - drink",
    "insumos - bar",
  ],
  PRODUTO_REVENDA: [
    "cervej",
    "destil",
    "vinho",
    "soft drink",
    "soft",
    "gelo",
    "bebida",
  ],
  ITEM_OPERACIONAL: [
    "utensil",
    "limpeza",
    "gás",
    "gas",
    "diversos",
    "embalag",
    "carvao",
  ],
  RECEITA_FICHA: [
    "salgad",
    "sobremes",
    "paes",
    "pão",
    "pao",
    "pronto",
  ],
  NAO_ESTOCAVEL: ["diversos", "gás", "gas", "limpeza"],
  REVISAO_PENDENTE: [],
};

/**
 * Tenta alinhar o nome do produto a uma categoria de catálogo (regras leves, pt-BR).
 */
function suggestFromProductName(
  productName: string,
  categories: CompanyProductCategory[],
): CompanyProductCategory | null {
  const p = productName.toLowerCase();
  const n = norm(productName);

  const tryKeywords = (kws: string[]) => {
    for (const kw of kws) {
      const hit = firstCategoryWhoseNameIncludes(categories, kw);
      if (hit) return hit;
    }
    return null;
  };

  if (/(coca|fanta|pepsi|guaran|refrigerante|refriger|suco|isoton|energ|nescau|nes)\b/i.test(p)) {
    const hit = tryKeywords(["soft drink", "soft", "bebida"]);
    if (hit) return hit;
  }
  if (/\b(cervej|chopp|lager|pilsen|ipa|stout|heine|brahma|skol)\b/.test(p)) {
    const hit = tryKeywords(["cervej", "cerve", "chopp", "bebida"]);
    if (hit) return hit;
  }
  if (/\b(água|agua|mineral|com gas|gaseific)\b/.test(p) && n.length < 40) {
    const hit = tryKeywords(["soft drink", "gelo", "bebida", "diversos"]);
    if (hit) return hit;
  }
  if (/\b(vinho|espum|champ|prosecco|malbec)\b/.test(p)) {
    const hit = tryKeywords(["vinho", "destil", "bebida", "diversos"]);
    if (hit) return hit;
  }
  if (/\b(gin|vodka|whisky|whiskey|cachaca|cachaça|rum|tequila|destil)\b/.test(p)) {
    const hit = tryKeywords(["destil", "bebida"]);
    if (hit) return hit;
  }
  if (/\b(pao|pão|french|brioch|criosp|focac)\b/.test(p)) {
    const hit = tryKeywords(["pães", "paes", "nao perec", "diversos"]);
    if (hit) return hit;
  }

  return null;
}

function tryOperationalKeywords(
  operationalType: OperationalItemType,
  categories: CompanyProductCategory[],
): CompanyProductCategory | null {
  const kws = OPERATIONAL_TYPE_TO_KEYWORDS[operationalType] ?? [];
  for (const kw of kws) {
    const hit = firstCategoryWhoseNameIncludes(categories, kw);
    if (hit) return hit;
  }
  return null;
}

/**
 * `null` se não houver categorias cadastradas; caso contrário tenta heurística e cai em "Diversos".
 */
export function suggestProductCatalogCategory(input: {
  categories: CompanyProductCategory[];
  operationalType: OperationalItemType;
  productName: string;
}): { category: CompanyProductCategory; source: "product_name" | "operational_type" | "fallback" } | null {
  const { categories, operationalType, productName } = input;
  if (categories.length === 0) return null;

  const fromName = suggestFromProductName(productName, categories);
  if (fromName) return { category: fromName, source: "product_name" };

  if (operationalType !== "REVISAO_PENDENTE" && operationalType !== "RECEITA_FICHA") {
    const fromOp = tryOperationalKeywords(operationalType, categories);
    if (fromOp) return { category: fromOp, source: "operational_type" };
  }

  if (operationalType === "RECEITA_FICHA") {
    const fromR = tryOperationalKeywords("RECEITA_FICHA", categories);
    if (fromR) return { category: fromR, source: "operational_type" };
  }

  if (operationalType === "REVISAO_PENDENTE") {
    const d = firstCategoryWhoseNameIncludes(categories, "diversos");
    if (d) return { category: d, source: "fallback" };
    return { category: categories[0]!, source: "fallback" };
  }

  const diversos = firstCategoryWhoseNameIncludes(categories, "diversos");
  if (diversos) return { category: diversos, source: "fallback" };

  const sorted = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  );
  return { category: sorted[0]!, source: "fallback" };
}

/**
 * Classificação de linhas EPOC/CSV de receita: folha DRE (company_categories RECEITA OPERACIONAL),
 * tipo operacional para produtos auto-criados, e categoria de catálogo (company_product_categories).
 */

export type RevenueOperationalLeaf = {
  id: string;
  parent_id: string | null;
  name: string;
  ordem: number | null;
};

export type RevenueCategoryPick = {
  subcategoryId: string;
  categoryId: string | null;
  confidence: number;
  reason: string;
};

export type OperationalItemType =
  | "INSUMO"
  | "PRODUTO_REVENDA"
  | "ITEM_OPERACIONAL"
  | "RECEITA_FICHA"
  | "NAO_ESTOCAVEL"
  | "REVISAO_PENDENTE";

const AI_CONFIDENCE_THRESHOLD = 0.72;

/** Mesma ideia que no job: acentos colapsados, lower, espaços. */
export function normCatalogLine(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterOperationalRevenueLeaves(
  rows: Array<{
    id: string;
    parent_id: string | null;
    name: string;
    ordem?: number | null;
    ativo?: boolean | null;
    papel_receita_dre?: string | null;
  }>,
): RevenueOperationalLeaf[] {
  const parentIds = new Set(
    rows.map((r) => r.parent_id).filter((x): x is string => !!x),
  );
  const out: RevenueOperationalLeaf[] = [];
  for (const r of rows) {
    if (parentIds.has(r.id)) continue;
    if (r.ativo === false) continue;
    if (r.papel_receita_dre === "DEDUCAO") continue;
    out.push({
      id: r.id,
      parent_id: r.parent_id ?? null,
      name: r.name,
      ordem: r.ordem ?? null,
    });
  }
  out.sort((a, b) => {
    const oa = a.ordem ?? 999;
    const ob = b.ordem ?? 999;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
  return out;
}

/** Folha DRE cujo nome é forma de pagamento, não mix de produto. */
const PAYMENT_LEAF_NAME_RE =
  /^(dinheiro|pix|especie|cash|cartao|credito|debito|voucher|vr|alelo|sodexo|ticket|vale)$/;
const PAYMENT_LEAF_PHRASE_RE =
  /^(venda\s+)?pix(\s+epoc)?$|vr\s*\/?\s*alelo|vale\s+refeicao|cartao\s+de\s+(credito|debito)/;

/** Dump / não-mix: não usar como default nem reutilizar de cache. */
const DUMP_LEAF_NAME_RE =
  /adiantamento|reservas?\s+e\s+eventos|^reservas$|outras\s+entradas/;

export function foldGrupoToken(s: string): string {
  return normCatalogLine(s)
    .replace(/^[\d]+(?:[.][\d]+)*\s*[-–:]\s*/, "")
    .replace(/[.,;]+$/g, "")
    .replace(/[/_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPaymentMethodCategoryName(name: string): boolean {
  const n = foldGrupoToken(name);
  if (!n) return true;
  if (PAYMENT_LEAF_NAME_RE.test(n) || PAYMENT_LEAF_PHRASE_RE.test(n)) return true;
  if (n.length <= 22 && /\b(dinheiro|especie|cash)\b/.test(n)) return true;
  return false;
}

export function isExcludedSaleMixLeafName(name: string): boolean {
  const n = foldGrupoToken(name);
  if (!n) return true;
  if (isPaymentMethodCategoryName(name)) return true;
  if (DUMP_LEAF_NAME_RE.test(n)) return true;
  return false;
}

export function isDrinkCatalogName(name: string): boolean {
  const n = foldGrupoToken(name);
  if (!n || isPaymentMethodCategoryName(name)) return false;
  return /(cervej|chopp|soft|destil|vinho|gelo|bebida|agua|refriger|suco|alcool|energet|cachaca|\bgin\b|conhaque|licor|coquetel)/.test(
    n,
  );
}

export function isFoodCatalogName(name: string): boolean {
  const n = foldGrupoToken(name);
  if (!n || isPaymentMethodCategoryName(name)) return false;
  return /(prato|comida|porcao|bolinho|pastel|caldo|salgado|sobremes|espet)/.test(
    n,
  );
}

const BEER_BRAND_RE =
  /\b(heineken|heine|brahma|skol|amstel|stella|budweiser|corona|praya|eisenbahn|antarctica|bohemia|spaten|therezopolis|colorado)/;

const DRINK_PRODUCT_RE =
  /\b(cervej|chopp|chop\b|long\s*neck|lata\b|garrafa|drink|caipir|daiquir|mojito|whisk|vodka|gin\b|cachaca|cachaça|tequila|vinho|espum|prosecco|sangria)\b/;
const SOFT_PRODUCT_RE =
  /\b(refrigerante|refri\b|guaran|pepsi|coca|fanta|sprite|schweppes|tonica|tônica|gatorade|red\s*bull|monster\b|isoton|energ)\b/;
const WATER_JUICE_RE =
  /\b(suco\b|nectar|agua\b|água|mineral|com\s+gas|gaseific|smoothie)\b/;

export function productLineLooksLikeDrink(productLine: string): boolean {
  const n = normCatalogLine(productLine);
  if (!n) return false;
  if (BEER_BRAND_RE.test(n)) return true;
  if (DRINK_PRODUCT_RE.test(n) || SOFT_PRODUCT_RE.test(n) || WATER_JUICE_RE.test(n)) {
    return true;
  }
  if (/\b(ml|litro|l)\b.*\b(cervej|refriger|suco|agua|vinho)\b/.test(n)) return true;
  return false;
}

export function productLineLooksLikeFood(productLine: string): boolean {
  const n = normCatalogLine(productLine);
  if (!n) return false;
  return /\b(prato|porcao|porção|executivo|combo|menu|lanche|espetinho|hamburg|pizza|massa|rango|marmita|acomp|bolinho|pastel|caldo|feijoada)\b/.test(
    n,
  );
}

/** Grupo EPOC → nome do seed de catálogo; null = ignorar (pagamento / vazio). */
export function resolveEpocGrupoCatalogName(grupoName: string): string | null {
  if (isPaymentMethodCategoryName(grupoName)) return null;
  const n = foldGrupoToken(grupoName);
  if (!n) return null;
  if (/(cervej|chopp)/.test(n)) return "Cervejas";
  if (/(destil|cachaca|conhaque|licor|\bgin\b)/.test(n)) return "Destilados";
  if (/vinho/.test(n)) return "Vinhos";
  if (/(refriger|soft|energet|suco|agua)/.test(n)) return "Soft Drink";
  if (/^gelo$/.test(n) || /\bgelo\b/.test(n)) return "Gelo";
  const original = String(grupoName ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return original || null;
}

export function pickDefaultRevenueLeaf(
  leaves: RevenueOperationalLeaf[],
): RevenueOperationalLeaf | null {
  const usable = leaves.filter((l) => !isExcludedSaleMixLeafName(l.name));
  const pool = usable.length ? usable : leaves;
  if (!pool.length) return null;
  const byProd = pool.find(
    (l) =>
      /venda.*produto|produtos/i.test(l.name) && !/bebida/i.test(l.name),
  );
  return byProd ?? pool[0]!;
}

export function findBebidasRevenueLeaf(
  leaves: RevenueOperationalLeaf[],
): RevenueOperationalLeaf | null {
  const usable = leaves.filter((l) => !isExcludedSaleMixLeafName(l.name));
  return (
    usable.find((l) => /venda.*bebida|bebidas/i.test(l.name)) ||
    usable.find((l) => /bebida/i.test(l.name)) ||
    null
  );
}

export function findProdutosRevenueLeaf(
  leaves: RevenueOperationalLeaf[],
): RevenueOperationalLeaf | null {
  const usable = leaves.filter((l) => !isExcludedSaleMixLeafName(l.name));
  return (
    usable.find(
      (l) =>
        /venda.*produto|produtos/i.test(l.name) && !/bebida/i.test(l.name),
    ) || null
  );
}

export function isUsableCachedSaleLeaf(
  subcategoryId: string,
  leaves: RevenueOperationalLeaf[],
): boolean {
  const leaf = leaves.find((l) => l.id === subcategoryId);
  if (!leaf) return false;
  return !isExcludedSaleMixLeafName(leaf.name);
}

export type ClassifyRevenueOptions = {
  catalogNames?: string[] | null;
};

/**
 * Heurísticas PT-BR (restaurante / EPOC) + catálogo/Grupo + correspondência da folha.
 */
export function classifyRevenueCategoryHeuristic(
  productLine: string,
  leaves: RevenueOperationalLeaf[],
  defaultLeaf: RevenueOperationalLeaf,
  options?: ClassifyRevenueOptions,
): RevenueCategoryPick {
  const n = normCatalogLine(productLine);
  const catalogNames = (options?.catalogNames ?? []).filter(Boolean);
  if (!n) {
    return {
      subcategoryId: defaultLeaf.id,
      categoryId: defaultLeaf.parent_id,
      confidence: 0.2,
      reason: "empty_line",
    };
  }

  const leafMatch = (re: RegExp) =>
    leaves.find((l) => !isExcludedSaleMixLeafName(l.name) && re.test(l.name));
  const leafIncludes = (...subs: string[]) =>
    leaves.find((l) => {
      if (isExcludedSaleMixLeafName(l.name)) return false;
      const x = normCatalogLine(l.name);
      return subs.every((s) => x.includes(s));
    });

  const pick = (
    hit: RevenueOperationalLeaf,
    confidence: number,
    reason: string,
  ): RevenueCategoryPick => ({
    subcategoryId: hit.id,
    categoryId: hit.parent_id,
    confidence,
    reason,
  });

  // Taxa de serviço / gorjeta / couvert / % serviço
  if (
    /\b(gorjeta|gorget|couvert|couver|taxa\s+de\s+serv|taxa\s+serv|servico\s+digital|taxa\s+servico)\b/.test(n) ||
    /\b10\s*%\s*(serv|garcom|garc)/.test(n) ||
    (/\btaxa\b/.test(n) && /\b(serv|garcom|garc|couvert)\b/.test(n)) ||
    /\bperc\b.*\b(serv|garcom)/.test(n)
  ) {
    const hit =
      leafIncludes("taxa", "serv") ||
      leafMatch(/taxa.*servi|servi.*taxa/i) ||
      leaves.find(
        (l) =>
          !isExcludedSaleMixLeafName(l.name) &&
          /taxa/i.test(l.name) &&
          /serv/i.test(l.name),
      );
    if (hit) return pick(hit, 0.94, "heuristic_taxa_servico");
  }

  // Delivery / marketplaces
  if (
    /\b(ifood|rappi|uber\s*eats|99\s*food|z\s*delivery|aiqfome|cardapio\s+web|delivery)\b/.test(n) ||
    /\b(taxa\s+entrega|taxa\s+de\s+entrega|frete\s+entrega)\b/.test(n)
  ) {
    const hit =
      leafMatch(/delivery|entrega/i) ||
      leafIncludes("receita", "delivery") ||
      leaves.find(
        (l) => !isExcludedSaleMixLeafName(l.name) && /delivery/i.test(l.name),
      );
    if (hit) return pick(hit, 0.9, "heuristic_delivery");
  }

  const catalogDrink = catalogNames.some((c) => isDrinkCatalogName(c));
  const catalogFood = catalogNames.some((c) => isFoodCatalogName(c));
  const bebidasLeaf = findBebidasRevenueLeaf(leaves);
  const produtosLeaf = findProdutosRevenueLeaf(leaves) ?? defaultLeaf;

  if (catalogDrink || productLineLooksLikeDrink(productLine)) {
    if (bebidasLeaf) {
      return pick(
        bebidasLeaf,
        catalogDrink ? 0.93 : 0.91,
        catalogDrink ? "catalog_bebidas" : "heuristic_bebidas",
      );
    }
  }

  // Cobrança de copo / rolha / gelo
  if (
    /\b(copo|rolha|gelo|gelinho|shooter)\b/.test(n) &&
    !/\b(prato|porcao|porção|combo\s+executivo)\b/.test(n)
  ) {
    if (bebidasLeaf) return pick(bebidasLeaf, 0.72, "heuristic_copo_rolha_gelo");
  }

  // Nome da folha contido na linha (ex.: promoções nomeadas) — nunca pagamento/dump
  for (const l of leaves) {
    if (isExcludedSaleMixLeafName(l.name)) continue;
    const ln = normCatalogLine(l.name);
    if (ln.length >= 5 && n.includes(ln)) {
      return pick(l, 0.78, "leaf_label_substring");
    }
  }

  if (catalogFood || productLineLooksLikeFood(productLine)) {
    return pick(
      produtosLeaf,
      catalogFood ? 0.74 : 0.68,
      catalogFood ? "catalog_produtos" : "heuristic_alimentacao_linha",
    );
  }

  return pick(defaultLeaf, 0.45, "heuristic_fallback_default_leaf");
}

/** Tipo operacional para produto criado pelo import (sem ficha técnica). */
export function deriveOperationalTypeForAutoProduct(
  revenueLeafName: string,
  productLine: string,
): OperationalItemType {
  const leafN = normCatalogLine(revenueLeafName);
  const lineN = normCatalogLine(productLine);

  if (/taxa|serv|gorjet|couvert/.test(leafN) || /\b(gorjeta|couvert|taxa\s+de\s+serv)\b/.test(lineN)) {
    return "NAO_ESTOCAVEL";
  }
  if (/delivery|entrega/.test(leafN) || /\b(ifood|rappi|uber\s*eats|delivery)\b/.test(lineN)) {
    return "NAO_ESTOCAVEL";
  }
  if (/bebida/.test(leafN)) {
    return "PRODUTO_REVENDA";
  }
  if (
    /\b(prato|porcao|porção|executivo|combo|lanche|espet|hamburg|pizza|massa|rango)\b/.test(lineN)
  ) {
    return "ITEM_OPERACIONAL";
  }
  if (/outras/.test(leafN)) {
    return "ITEM_OPERACIONAL";
  }
  return "PRODUTO_REVENDA";
}

export function mapOperationalTypeToStockControl(t: OperationalItemType): string {
  switch (t) {
    case "INSUMO":
    case "NAO_ESTOCAVEL":
      return "SERVICE";
    case "RECEITA_FICHA":
      return "RECIPE_CONTROLLED";
    case "PRODUTO_REVENDA":
    case "ITEM_OPERACIONAL":
    case "REVISAO_PENDENTE":
    default:
      return "DIRECT";
  }
}

export type CompanyProductCat = { id: string; name: string };

/** Categoria cujo nome contém o trecho `needle` (como no web `suggestProductCatalogCategory`). */
function firstCategoryWhoseNameIncludes(
  categories: CompanyProductCat[],
  needle: string,
): CompanyProductCat | null {
  const n = normCatalogLine(needle);
  if (!n) return null;
  const sorted = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  );
  for (const c of sorted) {
    if (normCatalogLine(c.name).includes(n)) return c;
  }
  return null;
}

/** Alinha-se a `suggestProductCatalogCategory` do web (heurísticas enxutas). */
export function suggestCompanyProductCatalogCategoryId(
  productName: string,
  categories: CompanyProductCat[],
): { categoryId: string; source: string } | null {
  if (!categories.length) return null;
  const p = productName.toLowerCase();

  const tryKws = (kws: string[], source: string) => {
    for (const kw of kws) {
      const hit = firstCategoryWhoseNameIncludes(categories, kw);
      if (hit) return { categoryId: hit.id, source };
    }
    return null;
  };

  if (/(coca|fanta|pepsi|guaran|refrigerante|refriger|suco|isoton|energ|nescau|nes)\b/i.test(p)) {
    const r = tryKws(["refriger", "suco", "bebida", "leite e bebida", "mini"], "name_soft_drinks");
    if (r) return r;
  }
  if (/\b(cervej|chopp|lager|pilsen|ipa|stout|heineken|heine|brahma|skol|amstel|stella|corona|praya)\b/i.test(p) || /\bheine/.test(p)) {
    const r = tryKws(["cervej", "cerve", "chopp", "bebida"], "name_beer");
    if (r) return r;
  }
  if (/\b(água|agua|mineral|com gas|gaseific)\b/i.test(p) && p.length < 48) {
    const r = tryKws(["bebida", "refriger", "suco", "leite e bebida", "agua", "diversos"], "name_water");
    if (r) return r;
  }
  if (/\b(vinho|espum|champ|prosecco|malbec)\b/i.test(p)) {
    const r = tryKws(["vinho", "alcool", "bebida", "diversos"], "name_wine");
    if (r) return r;
  }
  if (/\b(pao|pão|french|brioch|criosp|focac)\b/i.test(p)) {
    const r = tryKws(["pães", "paes", "fari", "diversos"], "name_bread");
    if (r) return r;
  }
  if (/\b(prato|porcao|porção|executivo|combo|lanche|pastel|salgad|doce)\b/i.test(p)) {
    const r = tryKws(["comidas prontas", "porção", "pastel", "salgados", "doces"], "name_food");
    if (r) return r;
  }

  const diversos = firstCategoryWhoseNameIncludes(categories, "diversos");
  if (diversos) return { categoryId: diversos.id, source: "fallback_diversos" };
  const sorted = [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  );
  return { categoryId: sorted[0]!.id, source: "fallback_first" };
}

export type StoredRevenueCat = {
  subcategory_id: string;
  category_id: string | null;
  confidence: number;
  reason: string;
  src: "heuristic" | "openai" | "default";
};

export function needsOpenAiRefinement(pick: RevenueCategoryPick): boolean {
  return pick.confidence < AI_CONFIDENCE_THRESHOLD;
}

export type OpenAiAssign = { idx: number; leaf_id: string };

/**
 * Um único prompt: mapeia índices de rótulos → id de folha (UUID) existente na lista.
 */
export async function batchClassifyRevenueLeavesWithOpenAi(input: {
  apiKey: string;
  model: string;
  leaves: RevenueOperationalLeaf[];
  /** Rótulos únicos (ex.: nome da linha EPOC), na ordem enviada. */
  labels: string[];
}): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const { apiKey, model, leaves, labels } = input;
  if (!labels.length || !leaves.length) return out;

  const leafJson = leaves.map((l) => ({ id: l.id, name: l.name }));
  const allowed = new Set(leaves.map((l) => l.id));

  const sys =
    "Você classifica lançamentos de PDV/restaurante (exportação EPOC ou similar) em UMA folha de receita operacional do DRE. " +
    "Responda APENAS JSON válido (sem markdown), formato: " +
    '{"assignments":[{"idx":0,"leaf_id":"<uuid>"}...]}. ' +
    "Cada idx é o índice no array \"labels\" (0-based). leaf_id DEVE ser exatamente um dos ids fornecidos em leaves. " +
    "Regras: taxa de serviço/gorjeta/couvert/percentual garçom → folha de taxa de serviço se existir; " +
    "cerveja/refrigerante/suco/água/vinho/doses → folha de bebidas; ifood/rappi/uber eats/delivery → folha de delivery; " +
    "pratos, porções, lanches, comidas → folha de vendas de produtos alimentícios quando existir; " +
    "itens genéricos ou ambíguos → melhor folha entre \"outras receitas operacionais\" ou \"vendas de produtos\" conforme o nome.";

  const user = JSON.stringify({ leaves: leafJson, labels }, null, 0);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return out;

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return out;

  try {
    const parsed = JSON.parse(content) as { assignments?: OpenAiAssign[] };
    if (!Array.isArray(parsed.assignments)) return out;
    for (const a of parsed.assignments) {
      const idx = Number(a.idx);
      const lid = typeof a.leaf_id === "string" ? a.leaf_id.trim() : "";
      if (!Number.isInteger(idx) || idx < 0 || idx >= labels.length) continue;
      if (!allowed.has(lid)) continue;
      out.set(idx, lid);
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function leafById(
  leaves: RevenueOperationalLeaf[],
  id: string,
): RevenueOperationalLeaf | null {
  return leaves.find((l) => l.id === id) ?? null;
}

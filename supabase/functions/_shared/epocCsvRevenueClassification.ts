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

export function pickDefaultRevenueLeaf(leaves: RevenueOperationalLeaf[]): RevenueOperationalLeaf | null {
  if (!leaves.length) return null;
  const byProd = leaves.find((l) => /venda.*produto|produtos/i.test(l.name));
  return byProd ?? leaves[0]!;
}

/**
 * Heurísticas PT-BR (restaurante / EPOC) + correspondência do nome da folha no texto da linha.
 */
export function classifyRevenueCategoryHeuristic(
  productLine: string,
  leaves: RevenueOperationalLeaf[],
  defaultLeaf: RevenueOperationalLeaf,
): RevenueCategoryPick {
  const n = normCatalogLine(productLine);
  if (!n) {
    return {
      subcategoryId: defaultLeaf.id,
      categoryId: defaultLeaf.parent_id,
      confidence: 0.2,
      reason: "empty_line",
    };
  }

  const leafMatch = (re: RegExp) => leaves.find((l) => re.test(l.name));
  const leafIncludes = (...subs: string[]) =>
    leaves.find((l) => {
      const x = normCatalogLine(l.name);
      return subs.every((s) => x.includes(s));
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
      leaves.find((l) => /taxa/i.test(l.name) && /serv/i.test(l.name));
    if (hit) {
      return {
        subcategoryId: hit.id,
        categoryId: hit.parent_id,
        confidence: 0.94,
        reason: "heuristic_taxa_servico",
      };
    }
  }

  // Delivery / marketplaces
  if (
    /\b(ifood|rappi|uber\s*eats|99\s*food|z\s*delivery|aiqfome|cardapio\s+web|delivery)\b/.test(n) ||
    /\b(taxa\s+entrega|taxa\s+de\s+entrega|frete\s+entrega)\b/.test(n)
  ) {
    const hit =
      leafMatch(/delivery|entrega/i) ||
      leafIncludes("receita", "delivery") ||
      leaves.find((l) => /delivery/i.test(l.name));
    if (hit) {
      return {
        subcategoryId: hit.id,
        categoryId: hit.parent_id,
        confidence: 0.9,
        reason: "heuristic_delivery",
      };
    }
  }

  // Bebidas (alcool / soft / agua / suco em dose)
  if (
    /\b(cervej|chopp|chop\b|long\s*neck|lata\b|garrafa|drink|caipir|daiquir|mojito|whisk|vodka|gin\b|cachaca|cachaça|tequila|vinho|espum|prosecco|sangria)\b/.test(n) ||
    /\b(refrigerante|refri\b|guaran|pepsi|coca|fanta|sprite|schweppes|tonica|tônica|gatorade|red\s*bull|monster\b|isoton|energ)\b/.test(n) ||
    /\b(suco\b|nectar|agua\b|água|mineral|com\s+gas|gaseific|smoothie)\b/.test(n) ||
    /\b(ml|litro|l)\b.*\b(cervej|refriger|suco|agua|vinho)\b/.test(n)
  ) {
    const hit = leafMatch(/bebida/i) || leafIncludes("venda", "bebida");
    if (hit) {
      return {
        subcategoryId: hit.id,
        categoryId: hit.parent_id,
        confidence: 0.91,
        reason: "heuristic_bebidas",
      };
    }
  }

  // Cobrança de copo / rolha / gelo (receita operacional, costuma ir em bebidas ou outras)
  if (/\b(copo|rolha|gelo|gelinho|shooter)\b/.test(n) && !/\b(prato|porcao|porção|combo\s+executivo)\b/.test(n)) {
    const hit = leafMatch(/bebida/i) || leafMatch(/outras/i);
    if (hit) {
      return {
        subcategoryId: hit.id,
        categoryId: hit.parent_id,
        confidence: 0.72,
        reason: "heuristic_copo_rolha_gelo",
      };
    }
  }

  // Nome da folha contido na linha (ex.: promoções nomeadas)
  for (const l of leaves) {
    const ln = normCatalogLine(l.name);
    if (ln.length >= 5 && n.includes(ln)) {
      return {
        subcategoryId: l.id,
        categoryId: l.parent_id,
        confidence: 0.78,
        reason: "leaf_label_substring",
      };
    }
  }

  // Pratos / porções / comida (não bebida): preferir vendas de produtos ou outras operacionais
  if (
    /\b(prato|porcao|porção|executivo|combo|menu|lanche|espetinho|hamburg|pizza|massa|rango|marmita|acomp)\b/.test(n)
  ) {
    const hit = leafMatch(/venda.*produto|produtos/i) || leafMatch(/outras.*operac/i);
    if (hit) {
      return {
        subcategoryId: hit.id,
        categoryId: hit.parent_id,
        confidence: 0.68,
        reason: "heuristic_alimentacao_linha",
      };
    }
  }

  return {
    subcategoryId: defaultLeaf.id,
    categoryId: defaultLeaf.parent_id,
    confidence: 0.45,
    reason: "heuristic_fallback_default_leaf",
  };
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
  if (/\b(cervej|chopp|lager|pilsen|ipa|stout|heine|brahma|skol)\b/i.test(p)) {
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

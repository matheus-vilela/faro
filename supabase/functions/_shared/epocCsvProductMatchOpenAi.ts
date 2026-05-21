/**
 * Batch OpenAI: itens EPOC sem match exato por nome → vincular a produto/ficha existente
 * ou instruções de cadastro (produto vs ficha, unidade, conversão para UN).
 */
import type { EpocCatalogProduct } from "./epocCsvProductResolution.ts";

export type EpocRecipeCatalogEntry = {
  id: string;
  name: string;
  output_product_id: string | null;
};

export type EpocOpenAiCreateHint = {
  catalog_name: string;
  kind: "PRODUCT" | "RECIPE";
  unit: string;
  instructions: string;
  /** Quantidade de UN por 1 unidade de estoque (ex.: 1 cx = 12 un → 12). */
  un_per_stock_unit?: number | null;
};

export type EpocOpenAiMatchAssignment = {
  idx: number;
  action:
    | "MATCH_PRODUCT"
    | "MATCH_RECIPE"
    | "CREATE_PRODUCT"
    | "CREATE_RECIPE"
    | "MANUAL_REVIEW";
  product_id?: string | null;
  recipe_id?: string | null;
  create?: EpocOpenAiCreateHint | null;
  instructions?: string | null;
};

export type EpocOpenAiMatchResult = {
  assignments: EpocOpenAiMatchAssignment[];
};

const CATALOG_CAP = 2500;

function compactCatalogPayload(
  products: EpocCatalogProduct[],
  recipes: EpocRecipeCatalogEntry[],
): { products: { id: string; name: string; unit?: string | null }[]; recipes: { id: string; name: string; output_product_id: string | null }[] } {
  const prods = products.slice(0, CATALOG_CAP).map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit ?? null,
  }));
  const recs = recipes.slice(0, CATALOG_CAP).map((r) => ({
    id: r.id,
    name: r.name,
    output_product_id: r.output_product_id,
  }));
  return { products: prods, recipes: recs };
}

export async function batchResolveEpocUnmatchedWithOpenAi(input: {
  apiKey: string;
  model: string;
  csvLines: string[];
  products: EpocCatalogProduct[];
  recipes: EpocRecipeCatalogEntry[];
}): Promise<Map<number, EpocOpenAiMatchAssignment>> {
  const out = new Map<number, EpocOpenAiMatchAssignment>();
  const { apiKey, model, csvLines, products, recipes } = input;
  if (!csvLines.length || !apiKey) return out;

  const catalog = compactCatalogPayload(products, recipes);
  const sys =
    "Você reconcilia linhas de venda EPOC (PDV) com o cadastro existente de produtos e fichas técnicas (receitas). " +
    "Todas as vendas EPOC são lançadas em UN (unidade). " +
    'Responda APENAS JSON válido: {"assignments":[{"idx":0,"action":"MATCH_PRODUCT"|"MATCH_RECIPE"|"CREATE_PRODUCT"|"CREATE_RECIPE"|"MANUAL_REVIEW",...}]}. ' +
    "idx = índice em csv_lines (0-based). " +
    "Regras: " +
    "(1) MATCH_PRODUCT/MATCH_RECIPE só com id existente no catálogo enviado; o nome do CSV deve ser o MESMO item (mesmo produto de venda), não apenas mesma categoria. " +
    '(2) "AGUA COM GAS" NÃO é o mesmo que "AGUA MINERAL CRYSTAL COM GAS" — prefira CREATE ou MANUAL_REVIEW. ' +
    "(3) CREATE_*: create.catalog_name (nome de cadastro limpo), create.kind (PRODUCT=revenda/insumo embalado, RECIPE=preparo/ficha), create.unit (unidade de estoque, prefira un se incerto), create.instructions (passos curtos em PT), create.un_per_stock_unit se unit≠un (quantas UN equivalem a 1 unidade de estoque). " +
    "(4) MANUAL_REVIEW: sem match seguro; instructions explica o que o usuário deve fazer. " +
    "(5) MATCH_RECIPE: recipe_id + product_id (output do produto da ficha).";

  const user = JSON.stringify(
    {
      csv_lines: csvLines,
      catalog_products: catalog.products,
      catalog_recipes: catalog.recipes,
    },
    null,
    0,
  );

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
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
    const parsed = JSON.parse(content) as EpocOpenAiMatchResult;
    if (!Array.isArray(parsed.assignments)) return out;
    for (const a of parsed.assignments) {
      const idx = Number(a.idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= csvLines.length) continue;
      const action = a.action;
      if (
        action !== "MATCH_PRODUCT" &&
        action !== "MATCH_RECIPE" &&
        action !== "CREATE_PRODUCT" &&
        action !== "CREATE_RECIPE" &&
        action !== "MANUAL_REVIEW"
      ) {
        continue;
      }
      out.set(idx, a);
    }
  } catch {
    /* ignore */
  }
  return out;
}

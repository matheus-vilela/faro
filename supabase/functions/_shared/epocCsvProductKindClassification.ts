/**
 * Classifica rótulos EPOC/CSV como produto de venda (revenda/insumo embalado) ou ficha técnica (preparo).
 * Heurísticas PT-BR + batch OpenAI para rótulos ambíguos.
 */

export type EpocProductKind = "PRODUCT" | "RECIPE";

export type EpocProductKindPick = {
  kind: EpocProductKind;
  confidence: number;
  reason: string;
};

const AI_CONFIDENCE_THRESHOLD = 0.72;

export function normEpocProductLine(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Indícios fortes de item preparado / composto (ficha técnica no PDV). */
const RECIPE_STRONG =
  /\b(caipirinha|caipiroska|mojito|daiquiri|margarita|negroni|cosmopolitan|cosmo\b|sakerinha|batida\b|coquetel|cocktail|drink\b|chopp\s+com|chopinho|sangria|pina\s*colada|caipiroska|bloody\s*mary|martini|gimlet|aperol\s*spritz|spritz\b|gin\s+tonic|g\s*&\s*t\b|moscow\s*mule|old\s*fashioned|whisky\s+sour|caipirissima)\b/;

const RECIPE_COMPOSITE =
  /\b(balde\b|combo\b|executivo\b|porcao|porção|prato\b|lanche\b|hamburg|hambúrguer|pizza\b|espetinho|pastel\b|porcionad|dose\s+dupla|dose\s+tripla|2\s*doses|dupla\s+dose|tripla\s+dose|kit\s|menu\b|refeicao|refeição|marmita|bowl\b|poke\b|wrap\b|salada\s+montada|tábua|tabua\b|fondue\b|rodizio|rodízio|feijoada\b|parmegiana|strogonoff|file\b|filé|bife\b|frango\s+a\s|frango\s+na|nuggets|batata\s+frita|porção\s+de)\b/;

/** Bebida embalada / insumo de bar (produto). */
const PRODUCT_PACKAGED =
  /\b(heineken|brahma|skol|stella|corona|budweiser|antarctica|original\b|spaten|eisenbahn|bohemia|patagonia|amstel|kaiser|itaipava|schin|petra\b|devassa|colorado)\b/;

const PRODUCT_BOTTLE_UNIT =
  /\b(long\s*neck|lata\b|garrafa\b|600\s*ml|350\s*ml|310\s*ml|269\s*ml|473\s*ml|550\s*ml|2\s*l|2l\b|1\s*l|1l\b|litro\b|litros\b)\b/;

const PRODUCT_SPIRIT_BRAND =
  /\b(cachaça|cachaca|vodka|whisky|whiskey|gin\b|rum\b|tequila|conhaque|licor\b|aperol|campari|vermute|absolut|smirnoff|red\s*label|black\s*label|johnnie|jack\s*daniels|tanqueray|beefeater|51\b|ypioca|leblon|sagatiba|velho\s*barreiro|são\s*francisco|sao\s*francisco)\b/;

const PRODUCT_SOFT =
  /\b(coca|fanta|sprite|pepsi|guaraná|guarana|schweppes|red\s*bull|monster\b|gatorade|água|agua\b|mineral|refrigerante|refri\b|suco\b|nectar|isoton|energ)\b/;

/** "Balde" e similares são ficha; cerveja isolada costuma ser produto. */
function looksLikeBeerBucket(n: string): boolean {
  return /\b(balde|kit|combo|promo)\b/.test(n) && /\b(cervej|chopp|chop\b|beer)\b/.test(n);
}

function looksLikePackagedBeer(n: string): boolean {
  if (looksLikeBeerBucket(n)) return false;
  if (PRODUCT_PACKAGED.test(n)) return true;
  if (/\b(cervej|chopp|chop\b|pilsen|lager|ipa|weiss)\b/.test(n) && PRODUCT_BOTTLE_UNIT.test(n)) {
    return true;
  }
  if (/\b(cervej|chopp)\b/.test(n) && !RECIPE_COMPOSITE.test(n) && !RECIPE_STRONG.test(n)) {
    return !/\b(balde|combo|porcao|porção|prato)\b/.test(n);
  }
  return false;
}

export function classifyEpocProductKindHeuristic(
  productLine: string,
): EpocProductKindPick {
  const n = normEpocProductLine(productLine);
  if (!n) {
    return { kind: "PRODUCT", confidence: 0.2, reason: "empty_line" };
  }

  if (RECIPE_STRONG.test(n)) {
    return { kind: "RECIPE", confidence: 0.93, reason: "heuristic_cocktail_prep" };
  }
  if (looksLikeBeerBucket(n)) {
    return { kind: "RECIPE", confidence: 0.9, reason: "heuristic_beer_bucket" };
  }
  if (RECIPE_COMPOSITE.test(n)) {
    return { kind: "RECIPE", confidence: 0.88, reason: "heuristic_food_or_combo" };
  }

  if (looksLikePackagedBeer(n)) {
    return { kind: "PRODUCT", confidence: 0.9, reason: "heuristic_packaged_beer" };
  }
  if (PRODUCT_SPIRIT_BRAND.test(n) && !RECIPE_STRONG.test(n)) {
    return { kind: "PRODUCT", confidence: 0.86, reason: "heuristic_spirit_product" };
  }
  if (PRODUCT_SOFT.test(n) && !RECIPE_COMPOSITE.test(n)) {
    return { kind: "PRODUCT", confidence: 0.84, reason: "heuristic_soft_drink" };
  }

  if (/\b(dose\b|shot\b|shooter)\b/.test(n) && PRODUCT_SPIRIT_BRAND.test(n)) {
    return { kind: "PRODUCT", confidence: 0.75, reason: "heuristic_spirit_dose" };
  }

  return { kind: "PRODUCT", confidence: 0.45, reason: "heuristic_fallback_product" };
}

export function needsEpocProductKindOpenAi(pick: EpocProductKindPick): boolean {
  return pick.confidence < AI_CONFIDENCE_THRESHOLD;
}

export type EpocProductKindAssign = { idx: number; kind: EpocProductKind };

export async function batchClassifyEpocProductKindWithOpenAi(input: {
  apiKey: string;
  model: string;
  labels: string[];
}): Promise<Map<number, EpocProductKind>> {
  const out = new Map<number, EpocProductKind>();
  const { apiKey, model, labels } = input;
  if (!labels.length) return out;

  const sys =
    "Você classifica itens de cardápio/PDV de bar e restaurante (exportação EPOC) em exatamente um tipo: " +
    '"PRODUCT" (produto vendido como unidade embalada ou insumo de bar — ex.: garrafa/lata/dose de cachaça, Heineken long neck, Coca-Cola) ' +
    'ou "RECIPE" (preparo composto / ficha técnica — ex.: caipirinha, mojito, balde de cerveja, combo executivo, porção de fritas). ' +
    'Responda APENAS JSON válido (sem markdown): {"assignments":[{"idx":0,"kind":"PRODUCT"|"RECIPE"}...]}. ' +
    "idx é o índice no array labels (0-based). " +
    "Regras: drinks misturados e pratos preparados → RECIPE; marcas de cerveja/refrigerante/destilado em unidade avulsa → PRODUCT; " +
    '"balde", "combo", "porção", "executivo" com bebida ou comida → RECIPE; cachaça/vodka/gin como garrafa ou dose simples → PRODUCT.';

  const user = JSON.stringify({ labels }, null, 0);

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
    const parsed = JSON.parse(content) as { assignments?: EpocProductKindAssign[] };
    if (!Array.isArray(parsed.assignments)) return out;
    for (const a of parsed.assignments) {
      const idx = Number(a.idx);
      const k = a.kind === "RECIPE" ? "RECIPE" : a.kind === "PRODUCT" ? "PRODUCT" : null;
      if (!Number.isInteger(idx) || idx < 0 || idx >= labels.length || !k) continue;
      out.set(idx, k);
    }
  } catch {
    /* ignore */
  }
  return out;
}

export type StoredEpocProductKind = {
  kind: EpocProductKind;
  confidence: number;
  reason: string;
  src: "heuristic" | "openai" | "default";
};

import { stripDiacriticsLower } from "@/lib/productImport/canonicalName";
import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";

/** Segmento de operação (ajuste fino; sem persistência dedicada, default "geral"). */
export type HospitalityOperationSegment =
  | "geral"
  | "bar_cervejaria"
  | "restaurante"
  | "pizzaria"
  | "cafeteria"
  | "lanchonete";

export type OperationalFamilyCode =
  | "CERVEJA"
  | "SUCO"
  | "VINHO"
  | "DESTILADO"
  | "N_ALCOOL"
  | "REFRIGERANTE"
  | "AGUA"
  | "EMBALAGEM"
  | "HORTIFRUTI"
  | "CARNES_LATICINIOS"
  | "DRY_STORE"
  | "EQUIPAMENTO"
  | "LIMPEZA_MRO"
  | "MIXOLOGIA"
  | "RECEITADO_MONTADO"
  | "DESCONHECIDO";

const SEGMENT_BEVERAGE_BOOST: Partial<Record<HospitalityOperationSegment, number>> = {
  bar_cervejaria: 0.06,
  lanchonete: 0.03,
  geral: 0,
  restaurante: 0.02,
  pizzaria: 0.01,
  cafeteria: 0.02,
};

const SEGMENT_KITCHEN_BOOST: Partial<Record<HospitalityOperationSegment, number>> = {
  restaurante: 0.04,
  pizzaria: 0.04,
  cafeteria: 0.02,
  lanchonete: 0.02,
  bar_cervejaria: 0.01,
  geral: 0,
};

/** Termos que derrubam receita/ficha (equip., limpeza, MRO, embalagem). */
export const RECIPE_FICHA_BLOCK_PATTERNS: Array<{ re: RegExp; label: string; weight: number }> = [
  { re: /\b(monitor|display|led|lcd|teclado|mouse|impressor|canon|hp|hp\s|hp\d)\b/i, label: "equipamento_info", weight: 1.0 },
  { re: /\b(hdmi|usb|vga|nobreak|no-break|bateri|lampad|fio\sm\w+|\bcabo\b|plug)\b/i, label: "acessorio_ti", weight: 0.95 },
  { re: /\b(tablet|ipad|galaxy\s*tab|smartphone|celul)\b/i, label: "eletronico", weight: 0.9 },
  {
    re: /\b(detergente|detergent|deterg\w*|desinfet|alvej|agua\s*sanit|papel\stoalh|papel\shig|luva\s*nitr|saco\s*lixo|veja|ype)\b/i,
    label: "limpeza",
    weight: 0.9,
  },
  { re: /\b(embalag|marmita|d\s*lanche|d\s*refe|tampa\s*pote|pote\smicro|fundo\swax|fundo\spet|fardo\s*copo|copo\s*descart|tampa\scop|sacol|papel\s*refe|filme\s*pvc|bobina\sterm|guardan|canud)\b/i, label: "embalagem", weight: 0.85 },
  { re: /\b(consumo\s*indiret|mro|manut\w*)\b/i, label: "consumo_indireto", weight: 0.7 },
  { re: /\b(balan[cç]a|grelha\s*el[eé]t|fog(ão|o)\s*indu|m[aá]quina|equipam|refrigera|freezer|geladeira|ar\s*condic)\b/i, label: "equipamento_coz", weight: 0.75 },
  { re: /\b(cilindr|bombon|regulad|g[aá]s\s*glp|g[aá]s\s*co2|\bco2\b)\b/i, label: "gas_mro", weight: 0.6 },
  { re: /\b(ativ[oa]?\s*imobiliz|imobiliz)\b/i, label: "imobilizado", weight: 0.8 },
];

/** Bebida alcoólica / cervejaria — sinais fortes. */
const BEER_STYLE_OR_ALIAS: RegExp[] = [
  /\b(cerv\w*|cervej\w*|\bbeer\b|cervejaria)\b/i,
  /\b(ipa|apa|stout|porter|lager|pilsen|pilsner|pils\b|pale\s*ale|amber\s*ale|weiss|weizen|wheat|hefe|hefewe|wit\w*)\b/i,
  /\b( session\s*ipa|neipa|doppel|bock|goose|guinness)\b/i,
  /\b(chope|chopp|chop\b|draft|draught)\b/i,
  /\b(barril|keg|keg\s*\d+)\b/i,
];

const SPIRIT: RegExp = /\b(vodk|gim?\b|gin|rum|ron|cacha[çc]a|tequil|whisk|wisk|bourbon|cognac|absinto|licor|vermut)\b/i;
const WINE: RegExp = /\b(vinh|champ|espum|prosecc|sangr)\b/i;

const RETAIL_BEVERAGE_PACK: RegExp[] = [
  /\b(lata|long[\s-]?neck|retorn|gfa|garraf|famo|fardo)\b/i,
  /\b(350|355|473|600|1000|100\d)\s*ml\b/i,
  /\b\d{2,3}\s*ml\b/i,
  /\b(30|50|60)\s*L\b/i,
];

const SOFT: RegExp[] = [
  /\b(refri|refrig|gua?ran[aá]|coca|fanta|sprite|pepsi|peppsi|dolly)\b/i,
  /\b(suco|n[eé]ctar|xarope\s*monin|monin|polpa)\b/i, // "polpa" conflita cozinha — ponderado
  /\b(água|agua)(?:\s+com\s+g[áa]s|\s*mineral|\s*de\s+coqueiro)?\b/i,
  /\b(energ|red\s*bull|monster|burn)\b/i,
  /\b(t[oô]nica|soda|schweppes)\b/i,
  /\b(ch[aá]|caf[eé]|mocha|espresso|latte)\b/i, // beb N-A em bar
];

const KITCHEN_INSUMO: RegExp[] = [
  /\b(lim(ão|a[oô])|tahiti|hortel|menta|manjeric|coentro)\b/i,
  /a[çc][uú]car|acu?car|refinad/i,
  /\b(sal\s|grosso|fino|kosher|marinho)\b/i,
  /farinha|polvilh|f[eé]cula|amid/i,
  /azeite|vinag|oleo|óleo|manteig|marga/i,
  /tomate|cebola|alho|piment(ão|a)|bacon|mussare|mu[cç]are|requeij|catupi|presunto|calab|pep/i,
  /fil[eé]|picanh|alcatr|frango|peito|bovin|sui[nñ]/i,
  /arroz|feij|lentilh|macarr|masa\b|esfiha|pizza|fermento|ferment[íi]/i,
  /calda|pur[eê]|blend|xarope simples|xarope de a[cç]uc|xarope de agua|base\s*coqu/i,
  /gelo|gelo\s*seco/i,
  /maion|molho(?!m\s*especial)|extrato|ketchup|mostar/i, // moho/molho
];

const HORTI_WEIGHT: RegExp = /\b(kg|g\b|g\.|gastro|fardo|embal\w*)\b/i;
const SUGAR_KG: RegExp = /a[çc]uc|acu?car|refinad|demerar/i;

/** Casos fortes de revenda (bebida) sem ser receita. */
const STRONG_DRAFT_OR_RETAIL: RegExp = /\b(barril|chope|chopp|keg|lata|long[\s-]?neck)\b/i;

const RECIPE_POSITIVE: Array<{ re: RegExp; label: string; w: number }> = [
  { re: /\b(kit|combo|lanche\w*|prato|por[cç][aã]o|preparo|grelhad|assad\w*|frito)\b/i, label: "prato", w: 0.08 },
  { re: /\b(montad|fatiad|disco|por[cç][aã]o\sfam)\b/i, label: "prato2", w: 0.06 },
  { re: /\b(burger|hamb[uú]rgu|pizza\w*|sushi|temaki|buffet|rod[ií]z)\b/i, label: "cardapio", w: 0.09 },
  { re: /molho\s*da\s*casa|moho\s*da\s*casa|miso\s*da\s*casa|maionese\s*da\s*casa|especialidade\s*da\s*casa/i, label: "casa", w: 0.1 },
];

export function detectOperationalFamily(
  line: string,
  winningType: OperationalItemType,
): OperationalFamilyCode {
  const t = line.toLowerCase();
  if (winningType === "PRODUTO_REVENDA") {
    for (const re of BEER_STYLE_OR_ALIAS) {
      if (re.test(t)) return "CERVEJA";
    }
    if (SPIRIT.test(t)) return "DESTILADO";
    if (WINE.test(t)) return "VINHO";
    for (const re of SOFT) {
      if (re.test(t)) {
        if (/\/suco|polpa|xarope/.test(t) && /ml|L|kg|g\b/.test(t)) return "N_ALCOOL";
        return "REFRIGERANTE";
      }
    }
    if (/\b(água|agua|mineral|com gás|com gas)\b/i.test(t)) return "AGUA";
    return "N_ALCOOL";
  }
  if (winningType === "INSUMO") {
    if (/(legume|verdur|frut|lim|a[cç]uc|hort)/i.test(t)) return "HORTIFRUTI";
    if (/(bacon|muss|mu[cç]are|requeij|iogur|leite|queijo)/i.test(t)) return "CARNES_LATICINIOS";
    if (SPIRIT.test(t)) return "MIXOLOGIA";
    return "DRY_STORE";
  }
  if (winningType === "RECEITA_FICHA") return "RECEITADO_MONTADO";
  if (winningType === "ITEM_OPERACIONAL") {
    if (RECIPE_FICHA_BLOCK_PATTERNS.some((b) => b.re.test(t) && /limpe|deterg|papel|lixo|embal|mro/i.test(t)))
      return "LIMPEZA_MRO";
    return "EQUIPAMENTO";
  }
  return "DESCONHECIDO";
}

export function applyRecipeFichaBlockScore(baseRecipe: number, line: string): { next: number; blocks: string[] } {
  const blocks: string[] = [];
  let penalty = 0;
  for (const { re, label, weight } of RECIPE_FICHA_BLOCK_PATTERNS) {
    if (re.test(line) || re.test(stripDiacriticsLower(line))) {
      blocks.push(label);
      penalty = Math.max(penalty, weight);
    }
  }
  return {
    next: baseRecipe * (1 - Math.min(0.98, penalty * 0.9)),
    blocks,
  };
}

function segmentBoost(
  kind: "bev" | "kitchen",
  segment: HospitalityOperationSegment,
): number {
  if (kind === "bev") return SEGMENT_BEVERAGE_BOOST[segment] ?? 0;
  return SEGMENT_KITCHEN_BOOST[segment] ?? 0;
}

export type CategoryScores = {
  PRODUTO_REVENDA: number;
  INSUMO: number;
  RECEITA_FICHA: number;
  ITEM_OPERACIONAL: number;
  NAO_ESTOCAVEL: number;
  REVISAO_PENDENTE: number;
};

const ZERO_SCORE: CategoryScores = {
  PRODUTO_REVENDA: 0,
  INSUMO: 0,
  RECEITA_FICHA: 0,
  ITEM_OPERACIONAL: 0,
  NAO_ESTOCAVEL: 0,
  REVISAO_PENDENTE: 0,
};

/**
 * Núcleo de pontuação multi-classe. Retorna scores 0..1 aprox. por tipo operacional.
 */
export function scoreHospitalityByName(input: {
  name: string;
  norm: string;
  operationSegment: HospitalityOperationSegment;
}): {
  scores: CategoryScores;
  signalLabels: string[];
  recipeBlocks: string[];
} {
  const raw = (input.name ?? "").trim();
  const t = input.norm || stripDiacriticsLower(raw);
  const line = t.length > 0 ? t : stripDiacriticsLower(raw);
  const seg = input.operationSegment;

  const signals: string[] = [];
  const scores: CategoryScores = { ...ZERO_SCORE };

  // --- Sinais de bloqueio de receita (não forçam subtipo, só penalizam receita) ---
  const { blocks: recipeBlocks } = applyRecipeFichaBlockScore(1, raw);

  // --- Receita positiva (fraco) ---
  let rec = 0.05;
  for (const p of RECIPE_POSITIVE) {
    if (p.re.test(raw) || p.re.test(line)) {
      rec += p.w;
      signals.push(`receita_hint:${p.label}`);
    }
  }
  if (RECIPE_FICHA_BLOCK_PATTERNS.some((b) => b.label === "embalagem" && b.re.test(line))) {
    // embalagem não é "receita" mesmo com "molho" falso
    rec *= 0.3;
  }
  const { next: recAfter } = applyRecipeFichaBlockScore(rec, raw);
  scores.RECEITA_FICHA = Math.min(0.55, recAfter);

  // --- Keg / draft / cervejaria (forte PRODUTO_REVENDA) ---
  let bev = 0.1;
  for (const re of BEER_STYLE_OR_ALIAS) {
    if (re.test(raw) || re.test(line)) {
      bev += 0.32;
      signals.push("bebida:estilo_ou_cervej");
      break;
    }
  }
  for (const re of RETAIL_BEVERAGE_PACK) {
    if (re.test(raw) || re.test(line)) {
      bev += 0.1;
      signals.push("bebida:embal_volume");
    }
  }
  if (STRONG_DRAFT_OR_RETAIL.test(line)) {
    bev += 0.12;
    signals.push("bebida:chope_ou_barril");
  }
  for (const re of SOFT) {
    if (re.test(line)) {
      bev += 0.2;
      signals.push("bebida:soft");
      // polpa 10kg -> mais insumo (baixo bev) — depois ajusta insumo
    }
  }
  if (SPIRIT.test(line) && /\b(750|700|1[\.,]?75|1[\.,]?0|1000|600)\s*ml|ml\s*(750|700)\b/i.test(line)) {
    bev += 0.22;
    signals.push("bebida:destilado_tamanho");
  }
  if (SPIRIT.test(line) && !KITCHEN_INSUMO.some((r) => r.test(line)) && bev < 0.4) bev += 0.2;

  bev += segmentBoost("bev", seg);
  // Polpa 10kg / hortifrutti: reduz "bebida" e sobe "insumo" depois
  if (/\bpolpa\s+\d|\d+\s*kg|lim\w*(\s+|\s*-\s*)\d+\s*kg|tahiti/i.test(line)) {
    bev -= 0.2;
  }

  scores.PRODUTO_REVENDA = Math.min(0.99, bev);

  // --- Insumo cozinha / bar (preparo) ---
  let ins = 0.08;
  for (const re of KITCHEN_INSUMO) {
    if (re.test(raw) || re.test(line)) {
      ins += 0.12;
      signals.push("insumo:coz_bar");
    }
  }
  if (HORTI_WEIGHT.test(line) && (/\b(legume|verdur|frut|tahit|cebola|piment|tomat|alho|batat)\b/i.test(line) || SUGAR_KG.test(line))) {
    ins += 0.2;
    signals.push("insumo:peso_ou_fresco");
  }
  if (/\b(xarope\s*de|xarope\s*simples|xarope\s*agua|base\s*coqu)\b/i.test(line)) {
    ins += 0.18;
    signals.push("insumo:xarope_base");
  }
  if (/\b( lim|limao|lima|tahit)\b/i.test(line) && /\b(kg|g\b|g\.)[.,]?\d*|\d+\s*kg/i.test(line)) {
    ins += 0.2;
  }
  if (SPIRIT.test(line) && (/\b(dose|coquetel|mix|barman|bartend|gota)\b/i.test(line) || /50\s*ml|20\s*ml|30\s*ml/) ) {
    ins += 0.2;
  }
  ins += segmentBoost("kitchen", seg);
  if (SUGAR_KG.test(line) && /kg|g\.\d|5\s*kg|10\s*kg|1\s*kg/i.test(line)) {
    ins += 0.15;
  }
  scores.INSUMO = Math.min(0.99, ins);

  // --- MRO / limpeza / embalagem: ITEM_OPERACIONAL ---
  let mro = 0.05;
  for (const b of RECIPE_FICHA_BLOCK_PATTERNS) {
    if (b.label === "limpeza" || b.label === "embalagem" || b.label === "equipamento_info") {
      if (b.re.test(line)) {
        mro = Math.max(mro, b.weight);
        signals.push(`mro:${b.label}`);
      }
    }
  }
  for (const b of RECIPE_FICHA_BLOCK_PATTERNS) {
    if (b.label === "equipamento_coz" && b.re.test(line)) mro = Math.max(mro, 0.45);
  }
  scores.ITEM_OPERACIONAL = Math.min(0.95, mro + 0.1);

  // --- Eletrônicos puros: REVISAO_PENDENTE ---
  if (/\b(monitor|led|lcd|impress|hdmi|teclad|no-break|nobreak|tablet|ipad)\b/i.test(line)) {
    scores.REVISAO_PENDENTE = 0.7;
    signals.push("revisar:tecnologia");
  } else {
    scores.REVISAO_PENDENTE = 0.2;
  }

  // --- Ajuste: polpa/limão em kg pesa em INSUMO vs PRODUTO_REVENDA ---
  if (/\bpolpa\b/i.test(line) && /\b(kg|g\b|cx\s*10|10kg)\b/i.test(line)) {
    scores.PRODUTO_REVENDA *= 0.4;
    scores.INSUMO += 0.15;
  }
  if (/(lim\w* tahit|tahiti|lima)\w*/i.test(line) && /10\s*kg|kg|cx/i.test(line)) {
    scores.INSUMO = Math.max(scores.INSUMO, 0.78);
    scores.PRODUTO_REVENDA = Math.min(scores.PRODUTO_REVENDA, 0.25);
  }

  // Muito ambíguo: sem sinais
  if (scores.PRODUTO_REVENDA < 0.2 && scores.INSUMO < 0.2 && scores.ITEM_OPERACIONAL < 0.25) {
    scores.REVISAO_PENDENTE = Math.max(0.45, scores.REVISAO_PENDENTE);
  }

  // Normaliza soma aprox. (cada eixo 0-1)
  (Object.keys(scores) as (keyof CategoryScores)[]).forEach((k) => {
    scores[k] = Math.max(0, Math.min(0.99, Number(scores[k] ?? 0)));
  });

  return { scores, signalLabels: signals, recipeBlocks };
}

export function bestOperationalTypeFromScores(
  scores: CategoryScores,
  stockControlType: string | null | undefined,
): { type: OperationalItemType; top: number; second: number; gap: number } {
  if (stockControlType === "RECIPE_CONTROLLED" || stockControlType === "COMPOSITE") {
    return { type: "RECEITA_FICHA", top: 0.85, second: 0, gap: 0.5 };
  }
  const entries = (Object.keys(scores) as (keyof CategoryScores)[]).map(
    (k) => [k, scores[k] ?? 0] as const,
  );
  entries.sort((a, b) => b[1] - a[1]);
  const [t1, s1] = entries[0];
  const s2 = entries[1]?.[1] ?? 0;
  return {
    type: t1,
    top: s1,
    second: s2,
    gap: s1 - s2,
  };
}

/**
 * Gera 1-2 frases em pt-BR para o utilizador.
 */
export function buildSuggestionSummaryPt(_input: {
  name: string;
  winning: OperationalItemType;
  family: OperationalFamilyCode;
  scores: CategoryScores;
  signalLabels: string[];
  recipeBlocks: string[];
}): string {
  const { name, winning, family, signalLabels, recipeBlocks, scores } = _input;
  const n = (name || "").trim().slice(0, 80);
  if (winning === "PRODUTO_REVENDA" && (family === "CERVEJA" || family === "N_ALCOOL")) {
    return `Sugestão: produto de revenda (bebida). Padrão em “${n}” indica cerveja, embalagem ou bebida pronta.`;
  }
  if (winning === "INSUMO" && (family === "HORTIFRUTI" || family === "MIXOLOGIA" || family === "DRY_STORE")) {
    return `Sugestão: insumo de preparo (cozinha/bar). Sinais de matéria-prima, peso de hortifrutti ou xarope/base.`;
  }
  if (winning === "RECEITA_FICHA" && scores.RECEITA_FICHA < 0.2) {
    return `Atenção: sinais de receita/montado são fracos; confirme se existe ficha de preparo.`;
  }
  if (winning === "ITEM_OPERACIONAL" && (signalLabels.some((s) => s.startsWith("mro:")) || recipeBlocks.length > 0)) {
    return `Sugestão: item operacional / consumo indireto (limpeza, embalagem ou MRO) — evita enquadramento em receita.`;
  }
  if (winning === "PRODUTO_REVENDA" && family === "DESTILADO") {
    return `Sugestão: produto de revenda (destilado em formato típico de varejo, ex. 750ml). Ajuste se o uso for só preparo.`;
  }
  if (winning === "REVISAO_PENDENTE") {
    return `Sugestão: revisar manualmente. O nome não bateu com regras fortes; confira unidade e uso na operação.`;
  }
  if (winning === "INSUMO" && /gin|vodka|destil|whisk/i.test(n) && /750|700|1l|1000|600/i.test(n)) {
    return `Pode ser insumo de mixo ou bebida de revenda. Verifique se o giro é caixa (revenda) ou bar (por dose/preparo).`;
  }
  return `Classificação sugerida com base no nome e padrões de restaurante/bar.`;
}

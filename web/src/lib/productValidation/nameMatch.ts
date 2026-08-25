import {
  beverageSkuVolumeConflict,
  extractBeverageVolumeMl,
  isBeverageSkuLine,
} from "@/lib/productImport/beverageSkuIdentity";
import {
  canonicalProductName,
  expandCatalogNameAbbreviations,
} from "@/lib/productImport/canonicalName";
import { scoreNameMatch } from "@/lib/productImport/matchingScore";
import type { ValidationNameScore } from "@/lib/productValidation/types";

/** Tokens de categoria/embalagem da nota — não bastam para dizer que é o mesmo item do PDV. */
const CATEGORY_FILLER = new Set([
  "cerveja",
  "cerv",
  "refrigerante",
  "refri",
  "suco",
  "nectar",
  "agua",
  "garrafa",
  "lata",
  "pet",
  "cx",
  "caixa",
  "und",
  "un",
  "unid",
  "unidade",
  "gfa",
  "ln",
  "long",
  "neck",
  "fardo",
  "pack",
  "pct",
  "ml",
  "l",
  "lt",
  "kg",
  "g",
  "com",
  "sem",
]);

/** Tira caixa/fardo no fim; mantém volume (600ML) — o sanitize de cadastro apagaria isso. */
function stripInvoiceCaseCount(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+\d+\s*(?:cx|caixas?|fardos?|fds?|packs?|pcts?)\s*$/iu, "")
    .replace(/\s+(?:cx|caixas?|fardos?|fds?|packs?|pcts?)\s*\d+\s*$/iu, "")
    .trim();
}

/** PDV costuma gravar "Heineken 600" sem ml; a nota traz 600ML. */
function coerceBareBeverageMl(name: string): string {
  const s = String(name ?? "").trim();
  if (!s || extractBeverageVolumeMl(s) != null) return s;
  const m = s.match(/(^|[\s-])(\d{3,4})(?=$|[\s])/);
  if (!m?.[2]) return s;
  const ml = Number(m[2]);
  if (ml < 190 || ml > 2000) return s;
  const withMl = `${s.slice(0, m.index)!}${m[1]!}${m[2]}ML${s.slice(
    (m.index ?? 0) + m[0].length,
  )}`;
  if (isBeverageSkuLine(s) || isBeverageSkuLine(withMl)) return withMl;
  return s;
}

function prepareName(raw: string): string {
  const expanded = expandCatalogNameAbbreviations(stripInvoiceCaseCount(raw));
  return coerceBareBeverageMl(expanded);
}

function tokensOf(raw: string): string[] {
  const parts = canonicalProductName(prepareName(raw)).split(" ").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const split = p.match(/^(\d{2,4})(ml|l|lt|kg|g)$/);
    if (split) {
      out.push(split[1]!, split[2]!);
    } else {
      out.push(p);
    }
  }
  return out;
}

function isVolumeToken(t: string): boolean {
  return /^\d{2,4}$/.test(t);
}

function distinctiveTokens(tokens: string[]): string[] {
  return tokens.filter(
    (t) =>
      (t.length > 2 && !CATEGORY_FILLER.has(t)) || isVolumeToken(t),
  );
}

function tokenPresent(needle: string, haystack: Set<string>): boolean {
  if (haystack.has(needle)) return true;
  if (isVolumeToken(needle)) {
    for (const t of haystack) {
      if (t === needle || t.startsWith(needle)) return true;
    }
    return false;
  }
  if (needle.length < 4) return false;
  for (const t of haystack) {
    if (t.length < 4) continue;
    if (t.includes(needle) || needle.includes(t)) return true;
  }
  return false;
}

/**
 * Cobertura do nome curto do PDV pelos tokens da nota, ignorando ruído de categoria.
 * Penaliza nota com marca/extra que o PDV não trouxe (água genérica ≠ Crystal).
 */
function coverageScore(epocName: string, nfeName: string): number {
  const epocTok = tokensOf(epocName);
  const nfeTok = tokensOf(nfeName);
  const nfeSet = new Set(nfeTok);
  const distinctive = distinctiveTokens(epocTok);
  if (distinctive.length === 0) return 0;

  const hits = distinctive.filter((t) => tokenPresent(t, nfeSet));
  const cov = hits.length / distinctive.length;
  if (cov < 0.75) return Math.round(cov * 48);

  let score = Math.round(72 + cov * 22);
  const extra = distinctiveTokens(nfeTok).filter(
    (t) => !isVolumeToken(t) && !tokenPresent(t, new Set(epocTok)),
  );
  if (extra.length >= 2) score = Math.min(score, 68);
  else if (extra.length === 1 && distinctive.length <= 2) {
    score = Math.min(score, 78);
  }
  return score;
}

function reasonForScore(
  score: number,
  epocName: string,
  nfeName: string,
  volumeConflict: boolean,
): string[] {
  const reasons: string[] = [];
  if (volumeConflict) {
    reasons.push("Volume ou embalagem de bebida diferente no nome");
    return reasons;
  }
  if (score >= 96) reasons.push("Nomes equivalentes depois de normalizar");
  else if (score >= 85) {
    reasons.push("O nome da nota cobre o item vendido no PDV");
  } else if (score >= 55) {
    reasons.push("Nomes parecidos; confira se é o mesmo item");
  }
  const extra = distinctiveTokens(tokensOf(nfeName)).filter(
    (t) => !isVolumeToken(t) && !tokenPresent(t, new Set(tokensOf(epocName))),
  );
  if (extra.length >= 2 && score <= 68) {
    reasons.push("A nota traz marca ou descrição a mais que o PDV");
  }
  return reasons;
}

/**
 * Score 0–100 só por nome (EPOC × descrição de NF-e).
 * Não usa EAN, SKU nem NCM — esses códigos não atravessam PDV × nota.
 */
export function scoreEpocToNfeName(
  epocName: string,
  nfeName: string,
): ValidationNameScore {
  const epoc = prepareName(epocName);
  const nfe = prepareName(nfeName);
  if (!epoc || !nfe) return { score: 0, reasons: [] };

  const volumeConflict = beverageSkuVolumeConflict(epoc, nfe);
  const base = scoreNameMatch(epoc, nfe);
  const cover = coverageScore(epocName, nfeName);
  let score = Math.max(base, cover);
  if (volumeConflict) score = Math.min(score, 42);

  return {
    score,
    reasons: reasonForScore(score, epocName, nfeName, volumeConflict),
  };
}

export function scoreHintToPurchaseName(
  hintName: string,
  purchaseName: string,
): ValidationNameScore {
  const hint = canonicalProductName(hintName);
  const purchase = canonicalProductName(purchaseName);
  if (!hint || !purchase) return { score: 0, reasons: [] };
  if (hint === purchase) {
    return {
      score: 100,
      reasons: [`Nome da compra parece o insumo “${hintName}”`],
    };
  }
  const hintTok = hint.split(" ").filter(Boolean);
  const purchaseTok = new Set(purchase.split(" ").filter(Boolean));
  const covered =
    hintTok.length > 0 && hintTok.every((t) => t.length > 1 && purchaseTok.has(t));
  if (purchase.includes(hint) || covered) {
    const shorter = Math.min(hint.length, purchase.length);
    const longer = Math.max(hint.length, purchase.length);
    const score = Math.round(82 + (shorter / longer) * 16);
    return {
      score: Math.min(98, score),
      reasons:
        score >= 85
          ? [`Nome da compra parece o insumo “${hintName}”`]
          : [`Possível insumo “${hintName}” pelo nome da nota`],
    };
  }
  return { score: 0, reasons: [] };
}

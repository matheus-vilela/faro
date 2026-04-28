import { jaccard, tokenizeNormalized } from "./normalize";
import type { CandidatePair, RawLineInput } from "./types";

/**
 * Gera pares candidatos (blocking) sem enviar o universo completo à IA.
 * Estratégia: mesmo EAN; mesmo prefixo 4 chars; Jaccard de tokens > 0,25.
 */
export function buildCandidatePairs(
  items: RawLineInput[],
  maxPairs = 400,
): CandidatePair[] {
  const out: CandidatePair[] = [];
  const n = items.length;
  const byEan = new Map<string, RawLineInput[]>();
  for (const it of items) {
    const e = it.extracted_attributes.ean;
    if (e && e.length >= 8) {
      const list = byEan.get(e) ?? [];
      list.push(it);
      byEan.set(e, list);
    }
  }
  for (const [, group] of byEan) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (out.length >= maxPairs) return dedupePairs(out);
        out.push({
          a: group[i]!,
          b: group[j]!,
          blocking_reason: "ean_equal",
        });
      }
    }
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (out.length >= maxPairs) return dedupePairs(out);
      const a = items[i]!;
      const b = items[j]!;
      if (a.extracted_attributes.ean && a.extracted_attributes.ean === b.extracted_attributes.ean) {
        continue;
      }
      const preA = a.description_normalized.slice(0, 4);
      const preB = b.description_normalized.slice(0, 4);
      if (preA && preA === preB) {
        out.push({ a, b, blocking_reason: "prefix4" });
        continue;
      }
      const ja = tokenizeNormalized(a.description_normalized);
      const jb = tokenizeNormalized(b.description_normalized);
      if (jaccard(ja, jb) >= 0.25) {
        out.push({ a, b, blocking_reason: "jaccard_token" });
      }
    }
  }
  return dedupePairs(out);
}

function pairKey(x: string, y: string): string {
  return x < y ? `${x}\0${y}` : `${y}\0${x}`;
}

function dedupePairs(pairs: CandidatePair[]): CandidatePair[] {
  const seen = new Set<string>();
  const out: CandidatePair[] = [];
  for (const p of pairs) {
    const k = pairKey(p.a.id, p.b.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

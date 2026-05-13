/**
 * Nome canônico para deduplicação: acentos, caixa, pontuação, tokens de ruído.
 */

const NOISE_TOKENS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "com",
  "sem",
  "para",
  "a",
  "o",
  "em",
])

const PLURAL_TO_SING: Record<string, string> = {
  batatas: "batata",
  tomates: "tomate",
  cebolas: "cebola",
  ovos: "ovo",
  laranjas: "laranja",
  macas: "maca",
  maças: "maca",
}

/** Remove acentos e colapsa espaços. */
export function stripDiacriticsLower(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
}

/** Normalização “rótulo de nota” — alinhada à ideia de normalize_invoice_product_label (SQL). */
export function normalizeInvoiceProductLabel(raw: string): string {
  const t = stripDiacriticsLower(raw)
  return t.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
}

/**
 * Remove do **final** do nome sugerido quantidade de embalagem e unidade comercial/medida
 * (ex.: "… 100 UNIDADES", "… 12 x 500 ml", "… 5 kg") para o cadastro de produto.
 * Preserva sufixos tipo "6mm" (dimensão no meio do nome, não `N + unidade` no fim).
 */
export function stripTrailingPackagingQtyAndUnitsForCatalogName(
  raw: string | null | undefined,
): string {
  const orig = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
  if (!orig) return ""
  const packOrMeasureTail = [
    /\s+\d+[\.,]?\d*\s+x\s+\d+[\.,]?\d*\s+(?:unidades?|unids?|unds?|pecas?|pças?|cx|caixas?)\s*$/iu,
    /\s+\d+[\.,]?\d*\s+x\s+\d+[\.,]?\d*\s+(?:kg|g|mg|l|lt|ml)\s*$/iu,
    /\s+\d+[\.,]?\d*\s+(?:unidades?|unids?|unds?|duzias?|pecas?|pças?|cx|caixas?|fardos?|pcts?|packs?)\s*$/iu,
    /\s+\d+[\.,]?\d*\s+(?:un|und)\b\s*$/iu,
    /\s+\d+[\.,]?\d*\s+(?:kg|g|mg|l|lt|ml|m2|m3|m²|m³)\s*$/iu,
  ]
  let s = orig
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    for (const re of packOrMeasureTail) {
      const t = s.replace(re, "").trim()
      if (t !== s) {
        s = t
        changed = true
      }
    }
    if (!changed) break
  }
  return s.length ? s : orig
}

function singularizeToken(t: string): string {
  if (t.length <= 3) return t
  return PLURAL_TO_SING[t] ?? t
}

/**
 * Nome canônico para matching: tokens limpos, sem ruído comum, plural simples.
 */
export function canonicalProductName(raw: string): string {
  const base = normalizeInvoiceProductLabel(raw)
  if (!base) return ""
  const parts = base.split(" ").filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    if (NOISE_TOKENS.has(p)) continue
    out.push(singularizeToken(p))
  }
  return out.join(" ").trim()
}

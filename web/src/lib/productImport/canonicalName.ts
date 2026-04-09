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

/**
 * Nome canônico para deduplicação: acentos, caixa, pontuação, tokens de ruído.
 */
import { stripPackSizeFromLabel } from "./packSizeFromLabel"

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

/** Remove `*`, `#` e espaços no início (comum em descrições de NF-e). */
export function stripLeadingInvoiceDecorativeMarks(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
  for (let i = 0; i < 8; i++) {
    const t = s.replace(/^\s*[*#]+\s*/u, "").trim()
    if (t === s) break
    s = t
  }
  return s
}

/**
 * Remove do **final** do nome sugerido quantidade de embalagem e unidade comercial/medida
 * (ex.: "… 100 UNIDADES", "… 12 x 500 ml", "… 5 kg", "… 6X950ML", "… 1,002 KG PCT") para o cadastro de produto.
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
    /\s+\d+\s*[xX]\s*\d+[\.,]?\d*\s*(?:ml|m[lL]|lt|l|kg|g|mg)\s*$/iu,
    /\s+\d+[xX]\d+[\.,]?\d*(?:ml|m[lL]|lt|l|kg|g|mg)\s*$/iu,
    /\d+[xX]\d+[\.,]?\d*(?:ml|m[lL]|lt|l|kg|g|mg)\s*$/iu,
    /\s+\d+[\.,]?\d*\s+(?:kg|g|mg|l|lt|ml)\s+(?:pct|pcts?|pçs?|pc\b|cx|caixas?|fardos?|fds?|packs?|emb\.?)\s*$/iu,
    /\s+(?:pc|pct|pçs?)\s+\d+[\.,]?\d*\s*(?:kg|g|mg|l|lt|ml)\s*$/iu,
    /\s+(?:pct|pcts?|pçs?|cx|fds?|fardos?)\s*$/iu,
  ]
  let s = orig
  for (let pass = 0; pass < 16; pass++) {
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

/** Indica se o nome já especifica gaseificação (com/sem gás). */
export function mineralWaterHasGasSpecification(
  catalogName: string | null | undefined,
): boolean {
  const n = stripDiacriticsLower(catalogName)
  if (!n) return false
  return (
    /\b(com|sem|c\/|s\/)\s*gas\b/.test(n) ||
    /\bgaseificad/.test(n) ||
    /\bgasada\b/.test(n) ||
    /\bcom\s+gases\b/.test(n)
  )
}

/**
 * Água mineral sem especificação de gás → padrão SEM GAS (cadastro de bares).
 */
export function applyCatalogProductNameDefaults(
  catalogNameUpper: string | null | undefined,
): string {
  const name = String(catalogNameUpper ?? "").trim()
  if (!name) return ""
  const n = stripDiacriticsLower(name)
  if (!/\bagua\b/.test(n) || !/\bmineral\b/.test(n)) return name
  if (mineralWaterHasGasSpecification(name)) return name
  return `${name} SEM GAS`
}

/** Abreviações comuns em xProd de NF-e → nome de cadastro. */
export function expandCatalogNameAbbreviations(
  catalogNameUpper: string | null | undefined,
): string {
  let s = String(catalogNameUpper ?? "").trim()
  if (!s) return ""
  if (/^CERV\b/.test(s)) s = s.replace(/^CERV\b/, "CERVEJA")
  if (/^REFR\b/.test(s)) s = s.replace(/^REFR\b/, "REFRIGERANTE")
  return s
}

/** MAIÚSCULAS sem acentos — padrão do catálogo Faro. */
function toCatalogCase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
}

/** Nome de cadastro: limpa prefixos/sufixos de NF-e e normaliza em MAIÚSCULAS. */
export function sanitizeCatalogProductName(raw: string | null | undefined): string {
  const led = stripLeadingInvoiceDecorativeMarks(raw)
  let cleaned = stripTrailingPackagingQtyAndUnitsForCatalogName(led).trim()
  cleaned = stripPackSizeFromLabel(cleaned).trim() || cleaned
  cleaned = stripTrailingPackagingQtyAndUnitsForCatalogName(cleaned).trim()
  if (!cleaned) return ""
  return applyCatalogProductNameDefaults(
    expandCatalogNameAbbreviations(toCatalogCase(cleaned)),
  )
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

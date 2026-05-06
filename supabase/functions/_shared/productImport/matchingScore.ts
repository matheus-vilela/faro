import { canonicalProductName, normalizeInvoiceProductLabel } from "./canonicalName.ts"

/**
 * Primeiro token da linha da nota sugere produto processado (bebida, polpa, etc.);
 * não usar para matching genérico (ex.: "água" sozinho).
 */
const COMPOSITE_INVOICE_LEADING_TOKENS = new Set([
  "refrigerante",
  "refri",
  "suco",
  "nectar",
  "néctar",
  "nct",
  "polpa",
  "xarope",
  "cha",
  "chá",
  "mate",
  "cerveja",
  "vodka",
  "whisky",
  "whiskey",
  "energetico",
  "energético",
  "isotonico",
  "isotônico",
  "gin",
  "rum",
  "cachaca",
  "cachaça",
])

/**
 * Cadastro parece ser só sabor/ingrediente (1 token) e a nota é item composto
 * (≥2 tokens) cujo último token coincide — ex.: catálogo "Morango" vs nota "Refrigerante Morango".
 * Nesses casos o score por substring não deve empurrar vínculo automático.
 */
export function isFlavorOnlyCatalogInsideCompositeInvoice(
  invoiceLine: string,
  catalogName: string,
): boolean {
  const cx = canonicalProductName(invoiceLine)
  const cy = canonicalProductName(catalogName)
  if (!cx || !cy) return false
  const invTok = cx.split(" ").filter(Boolean)
  const catTok = cy.split(" ").filter(Boolean)
  if (catTok.length !== 1 || invTok.length < 2) return false
  const flavor = catTok[0]!
  if (invTok[invTok.length - 1] !== flavor) return false
  const first = invTok[0]!
  return COMPOSITE_INVOICE_LEADING_TOKENS.has(first)
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
    }
  }
  return dp[m]![n]!
}

/** 0–100 — compara nomes (rótulo + canônico + Levenshtein). */
export function scoreNameMatch(
  invoiceLine: string | null | undefined,
  catalogName: string | null | undefined,
): number {
  const x = normalizeInvoiceProductLabel(invoiceLine)
  const y = normalizeInvoiceProductLabel(catalogName)
  if (!x.length && !y.length) return 100
  if (!x.length || !y.length) return 0
  if (x === y) return 100

  const cx = canonicalProductName(invoiceLine)
  const cy = canonicalProductName(catalogName)
  if (cx && cx === cy) return 98
  if (cx && cy) {
    if (cx.includes(cy) || cy.includes(cx)) {
      const shorter = Math.min(cx.length, cy.length)
      const longer = Math.max(cx.length, cy.length)
      let s = Math.round(82 + (shorter / longer) * 12)
      if (isFlavorOnlyCatalogInsideCompositeInvoice(invoiceLine, catalogName)) {
        s = Math.min(s, 68)
      }
      return s
    }
    const d = levenshtein(cx, cy)
    const maxLen = Math.max(cx.length, cy.length)
    const base = Math.round((1 - d / maxLen) * 100)
    return Math.max(0, Math.min(100, base))
  }

  const d0 = levenshtein(x, y)
  const maxLen0 = Math.max(x.length, y.length)
  return Math.max(0, Math.min(100, Math.round((1 - d0 / maxLen0) * 100)))
}

export function digitsOnly(s: string | null | undefined): string {
  if (!s) return ""
  return String(s).replace(/\D/g, "")
}

/** Ajusta score com sinais fracos (NCM/EAN); limitado a 100. */
export function applySecondarySignals(params: {
  baseScore: number
  invoiceNcm?: string | null
  invoiceEan?: string | null
  productNcm?: string | null
  productBarcode?: string | null
}): { score: number; reasons: string[] } {
  let score = params.baseScore
  const reasons: string[] = []

  const ncmInv = digitsOnly(params.invoiceNcm).slice(0, 8)
  const ncmProd = digitsOnly(params.productNcm).slice(0, 8)
  if (ncmInv.length >= 4 && ncmProd.length >= 4 && ncmInv === ncmProd) {
    score = Math.min(100, Math.max(score, 88))
    reasons.push("NCM igual ao cadastro")
  }

  const eanInv = digitsOnly(params.invoiceEan)
  const bc = digitsOnly(params.productBarcode)
  if (eanInv.length >= 8 && bc.length >= 8 && eanInv === bc) {
    score = Math.min(100, score + 25)
    reasons.push("EAN/código de barras igual ao cadastro")
  }

  return { score: Math.min(100, Math.max(0, score)), reasons }
}

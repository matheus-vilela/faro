/** Espelha a extração usada na Edge Function (despesa via WhatsApp). */

export type ExtractedExpenseItem = {
  productName: string
  quantity: number
  unitValue: number
  lineTotal: number
  unitCommercial?: string | null
  unitTax?: string | null
  ncm?: string | null
  ean?: string | null
}

/** Metadados de vínculo com catálogo (edge / rascunho WhatsApp). */
export type ItemProductMatch = {
  /** Produto já resolvido automaticamente (id). */
  resolvedProductId?: string | null
  /** Preenchido quando score ≥ limiar de confirmação (caso contrário prefira cadastro novo). */
  suggestedProductId?: string | null
  suggestedProductName?: string | null
  /** 0–100 */
  suggestedScore?: number
  needsConfirmation?: boolean
  resolutionStatus?: string
  matchReason?: string
  invoiceUnitNormalized?: string
  catalogUnitNormalized?: string
  unitConvertible?: boolean
  stockQuantity?: number
  conversionFactorApplied?: number
  resolutionSource?: string
}

/** Alinhado à edge: escala 0–1 para checagens legadas (92% = 0.92). */
export const WHATSAPP_PRODUCT_AUTO_LINK_MIN = 0.92

export type ExtractedExpenseItemWithMatch = ExtractedExpenseItem & {
  productId?: string | null
  productMatch?: ItemProductMatch
}

export type BusinessIntent =
  | 'compra_insumos'
  | 'conta_pagar'
  | 'conta_receber'

export type ExtractedDocumentResult = {
  validDocument: boolean
  invalidReason?: string
  _requiresProductConfirmation?: boolean
  documentKind:
    | 'nota_fiscal'
    | 'cupom_fiscal'
    | 'romaneio'
    | 'recibo'
    | 'outro'
    | null
  /** compra_insumos = despesa; conta_pagar / conta_receber = lançamento no fluxo de caixa (WhatsApp). */
  businessIntent?: BusinessIntent | null
  dueDate?: string | null
  boletoTitle?: string | null
  supplierName: string | null
  supplierDocument: string | null
  invoiceNumber: string | null
  invoiceSeries: string | null
  totalAmount: number | null
  items: ExtractedExpenseItemWithMatch[]
  notes: string | null
  /** Preenchido pela IA na edge; fluxo web pode ignorar. */
  likelyNotEffectivePurchase?: boolean
  likelyNotPurchaseReason?: string | null
}

export function sumItems(items: ExtractedExpenseItem[]): number {
  let s = 0
  for (const it of items) {
    s += Number(it.lineTotal)
  }
  return Math.round(s * 100) / 100
}

export function scaleItemsToTotal(
  items: ExtractedExpenseItem[],
  totalTarget: number,
): ExtractedExpenseItem[] {
  const sum = sumItems(items)
  if (sum <= 0 || items.length === 0) return items
  const factor = totalTarget / sum
  return items.map((it) => {
    const newLine = Math.round(it.lineTotal * factor * 100) / 100
    const q = Math.max(0.0001, it.quantity)
    const newUnit = Math.round((newLine / q) * 10000) / 10000
    return {
      ...it,
      lineTotal: newLine,
      unitValue: newUnit,
    }
  })
}

export function recalcLineTotal(it: ExtractedExpenseItem): ExtractedExpenseItem {
  const q = Number(it.quantity)
  const uv = Number(it.unitValue)
  if (!Number.isFinite(q) || !Number.isFinite(uv) || q <= 0 || uv <= 0) {
    return { ...it, lineTotal: 0 }
  }
  const line = Math.round(q * uv * 100) / 100
  return { ...it, lineTotal: line }
}

/** Formata número para exibição em input (pt-BR). */
export function formatDecimalPtBrInput(n: number, maxFrac = 4): string {
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n)
}

/** Valor unitário / moeda: sempre 2 casas decimais (ex.: 7,7 → 7,70). */
export function formatCurrencyPtBrInput(n: number): string {
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/**
 * Interpreta texto digitado (pt-BR: vírgula decimal, ponto opcional).
 * Retorna null se vazio ou inválido.
 */
export function parseDecimalPtBrInput(s: string): number | null {
  const t = s.trim().replace(/\s/g, '')
  if (t === '') return null
  const normalized = t.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

/** Filtra teclas durante digitação de valor monetário/decimal. */
export function sanitizeDecimalPtBrTyping(raw: string): string {
  return raw.replace(/[^\d.,]/g, '')
}

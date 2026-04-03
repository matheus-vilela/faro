/** Espelha a extração usada na Edge Function (despesa via WhatsApp). */

export type ExtractedExpenseItem = {
  productName: string
  quantity: number
  unitValue: number
  lineTotal: number
}

export type ExtractedDocumentResult = {
  validDocument: boolean
  invalidReason?: string
  documentKind:
    | 'nota_fiscal'
    | 'cupom_fiscal'
    | 'romaneio'
    | 'recibo'
    | 'outro'
    | null
  supplierName: string | null
  supplierDocument: string | null
  invoiceNumber: string | null
  invoiceSeries: string | null
  totalAmount: number | null
  items: ExtractedExpenseItem[]
  notes: string | null
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
  const q = Math.max(0.0001, Number(it.quantity))
  const uv = Number(it.unitValue)
  const line = Math.round(q * uv * 100) / 100
  return { ...it, lineTotal: line }
}

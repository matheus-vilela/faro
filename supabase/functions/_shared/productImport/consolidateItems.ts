import { canonicalProductName } from "./canonicalName.ts"
import { normalizeUnitLabel, type NormalizedUnitCode } from "./unitNormalize.ts"

/** Campos mínimos de linha + metadados de NF (unidade, NCM, EAN). */
export type InvoiceItemFields = {
  productName: string
  quantity: number
  unitValue: number
  lineTotal: number
  unitCommercial?: string | null
  unitTax?: string | null
  invoiceUnitRaw?: string | null
  ncm?: string | null
  ean?: string | null
}

export type ExtractedItemWithInvoiceMeta = InvoiceItemFields & {
  _consolidatedFrom?: number
}

/** Prioriza unidade comercial, depois tributável, para refletir a nota. */
export function pickInvoiceUnitRaw(it: InvoiceItemFields): string | null {
  const a = it.invoiceUnitRaw?.trim()
  if (a) return a
  const c = it.unitCommercial?.trim()
  if (c) return c
  const t = it.unitTax?.trim()
  return t ?? null
}

export function consolidationKey(it: ExtractedItemWithInvoiceMeta): string {
  const canon = canonicalProductName(it.productName ?? "")
  const u = pickInvoiceUnitRaw(it)
  const nu: NormalizedUnitCode = u ? normalizeUnitLabel(u) : "UNKN"
  const ncm = (it.ncm ?? "").replace(/\D/g, "").slice(0, 8)
  const ean = (it.ean ?? "").replace(/\D/g, "").slice(0, 14)
  return `${canon}::${nu}::${ncm}::${ean}`
}

/**
 * Agrupa linhas equivalentes na mesma nota antes de matching/persistência.
 * Mesmo nome canônico + mesma unidade normalizada + NCM/EAN alinhados.
 */
export function consolidateInvoiceItems<T extends ExtractedItemWithInvoiceMeta>(
  items: T[],
): T[] {
  if (items.length <= 1) return items

  const map = new Map<string, T & { _consolidatedFrom?: number }>()

  for (const it of items) {
    const k = consolidationKey(it)
    const existing = map.get(k)
    if (!existing) {
      map.set(k, { ...it, _consolidatedFrom: 1 })
      continue
    }
    const q1 = Math.max(0.0001, Number(existing.quantity))
    const q2 = Math.max(0.0001, Number(it.quantity))
    const newQty = q1 + q2
    const lineTotal =
      Math.round((Number(existing.lineTotal) + Number(it.lineTotal)) * 100) / 100
    const unitValue = Math.round((lineTotal / newQty) * 10000) / 10000
    map.set(k, {
      ...existing,
      quantity: newQty,
      lineTotal,
      unitValue,
      _consolidatedFrom: (existing._consolidatedFrom ?? 1) + 1,
    })
  }

  return [...map.values()]
}

import { canonicalProductName } from "./canonicalName.ts"
import { nfeUsesUnTaxUnitBase } from "./nfeCommercialTaxUnitConversion.ts"
import { normalizeUnitLabel, type NormalizedUnitCode } from "./unitNormalize.ts"

/** Campos mínimos de linha + metadados de NF (unidade, NCM, EAN). */
export type InvoiceItemFields = {
  productName: string
  quantity: number
  unitValue: number
  lineTotal: number
  unitCommercial?: string | null
  unitTax?: string | null
  quantityCommercial?: number | null
  quantityTax?: number | null
  invoiceUnitRaw?: string | null
  ncm?: string | null
  ean?: string | null
}

export type ExtractedItemWithInvoiceMeta = InvoiceItemFields & {
  _consolidatedFrom?: number
}

/** Prioriza unidade comercial; se uTrib for UN distinta de uCom, prioriza UN (estoque). */
export function pickInvoiceUnitRaw(it: InvoiceItemFields): string | null {
  const c = it.unitCommercial?.trim()
  const t = it.unitTax?.trim()
  if (c && t && nfeUsesUnTaxUnitBase(c, t)) return t
  const a = it.invoiceUnitRaw?.trim()
  if (a) return a
  if (c) return c
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
  const clean = (items ?? []).filter(
    (it): it is T => it != null && typeof it === "object",
  )
  if (clean.length <= 1) return clean

  const map = new Map<string, T & { _consolidatedFrom?: number }>()

  for (const it of clean) {
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
    const q1c = Number(existing.quantityCommercial ?? existing.quantity)
    const q2c = Number(it.quantityCommercial ?? it.quantity)
    const q1t = Number(existing.quantityTax ?? 0)
    const q2t = Number(it.quantityTax ?? 0)
    const newQCom =
      Math.round((Math.max(0, q1c) + Math.max(0, q2c)) * 10000) / 10000
    const newQTrib =
      q1t > 0 && q2t > 0
        ? Math.round((q1t + q2t) * 10000) / 10000
        : q1t > 0
          ? q1t
          : q2t > 0
            ? q2t
            : null
    map.set(k, {
      ...existing,
      quantity: newQty,
      quantityCommercial: newQCom > 0 ? newQCom : null,
      quantityTax: newQTrib,
      lineTotal,
      unitValue,
      _consolidatedFrom: (existing._consolidatedFrom ?? 1) + 1,
    })
  }

  return [...map.values()]
}

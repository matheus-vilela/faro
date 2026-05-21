import { ProductUnitConversionsSection } from '@/components/products/ProductUnitConversionsSection'
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SECTION,
  PRODUCT_SHEET_SELECT,
} from '@/components/products/productSheetStyles'
import { ProductCategoryTagsField } from '@/components/products/ProductCategoryTagsField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  getLockedSystemSecondaryQty,
  convertUnitPriceForProduct,
  convertQuantityForProduct,
  rebaseProductConversionsToHub,
} from '@/lib/companyUnits/convert'
import { sanitizeCatalogProductName } from '@/lib/productImport/canonicalName'
import {
  defaultProductStockUnitCode,
  getSystemProductUnitSelectOptionsWithLegacy,
} from '@/lib/companyUnits/productUnitOptions'
import { supabase } from '@/lib/supabase'
import type { CompanyProductCategory } from '@/types/companyProductCategory'
import type { Product } from '@/types/product'
import { prepareProductUnitConversionsForPersist } from '@/lib/productUnitConversionsService'
import type { ProductUnitConversionDraft } from '@/types/productUnitConversion'
import { Package, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

function generateRandomSku(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = 'SKU-'
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  for (let i = 0; i < 8; i++) {
    result += chars[array[i]! % chars.length]
  }
  return result
}

interface CreateProductSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  /** Nome sugerido ao abrir (ex.: termo da busca no seletor de insumos). */
  defaultName?: string
  onSuccess?: (product: Product) => void
}

export function CreateProductSheet({
  open,
  onOpenChange,
  companyId,
  defaultName,
  onSuccess,
}: CreateProductSheetProps) {
  const roundUnitPrice = (value: number) =>
    Math.round((value + Number.EPSILON) * 1e8) / 1e8
  const formatCurrencyInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (!digits) return ''
    const cents = Number(digits) / 100
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents)
  }
  const parseCurrencyInput = (raw: string): number | null => {
    const digits = raw.replace(/\D/g, '')
    if (!digits) return null
    return Number(digits) / 100
  }

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [unit, setUnit] = useState('un')
  const [minQuantity, setMinQuantity] = useState('')
  const [lastUnitValue, setLastUnitValue] = useState('')
  const [lastUnitValueUnitCode, setLastUnitValueUnitCode] = useState('un')
  const [barcode, setBarcode] = useState('')
  const [composesCmv, setComposesCmv] = useState(true)
  const [companyProductCategories, setCompanyProductCategories] = useState<
    CompanyProductCategory[]
  >([])
  const [productCategoryIds, setProductCategoryIds] = useState<string[]>([])
  const [pendingConversions, setPendingConversions] = useState<
    ProductUnitConversionDraft[]
  >([])
  const [loading, setLoading] = useState(false)

  const loadCompanyProductCategories = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('company_product_categories')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
    if (error) {
      console.error(error)
      setCompanyProductCategories([])
      return
    }
    setCompanyProductCategories((data ?? []) as CompanyProductCategory[])
  }, [companyId])

  useEffect(() => {
    if (!open || !companyId) return
    void loadCompanyProductCategories()
    setUnit(defaultProductStockUnitCode())
    setLastUnitValueUnitCode(defaultProductStockUnitCode())
    setComposesCmv(true)
    setPendingConversions([])
    const suggested = defaultName?.trim()
    if (suggested) {
      setName(sanitizeCatalogProductName(suggested) || suggested)
    } else {
      setName('')
    }
    setSku('')
    setMinQuantity('')
    setLastUnitValue('')
    setBarcode('')
    setProductCategoryIds([])
  }, [open, companyId, defaultName, loadCompanyProductCategories])

  const unitOptions = useMemo(
    () => getSystemProductUnitSelectOptionsWithLegacy(unit),
    [unit],
  )
  const lastUnitValueUnitOptions = useMemo(() => {
    const allowed = new Set<string>([unit])
    for (const r of pendingConversions) {
      if (r.primary_unit_code.trim().toLowerCase() === unit.trim().toLowerCase()) {
        allowed.add(r.secondary_unit_code)
      }
    }
    for (const candidate of ['mg', 'g', 'kg', 'ml', 'l']) {
      if (candidate.toLowerCase() === unit.trim().toLowerCase()) continue
      if (getLockedSystemSecondaryQty(1, unit, candidate) != null) {
        allowed.add(candidate)
      }
    }
    const base = getSystemProductUnitSelectOptionsWithLegacy(lastUnitValueUnitCode)
    return base.filter((o) => allowed.has(o.value))
  }, [lastUnitValueUnitCode, pendingConversions, unit])

  const handleUnitChange = (next: string) => {
    const prev = unit
    if (prev === next) return
    const raw = minQuantity.trim().replace(/\s/g, '').replace(',', '.')
    const m = parseFloat(raw)
    const mOk = raw !== '' && Number.isFinite(m) && m >= 0
    const convRows = pendingConversions.map((r) => ({
      primary_unit_code: r.primary_unit_code,
      secondary_unit_code: r.secondary_unit_code,
      primary_qty: Number(r.primary_qty),
      secondary_qty: Number(r.secondary_qty),
    }))
    const cm = mOk
      ? convertQuantityForProduct(m, prev, next, prev, convRows)
      : null
    const rebasedConversions = rebaseProductConversionsToHub(convRows, prev, next)
    setUnit(next)
    if (pendingConversions.length > 0 && rebasedConversions.length === 0) {
      toast.message('Não foi possível reaproveitar as conversões com a nova unidade.')
    }
    setPendingConversions(
      rebasedConversions.map((r) => ({
        company_id: companyId,
        primary_qty: r.primary_qty,
        primary_unit_code: next,
        secondary_qty: r.secondary_qty,
        secondary_unit_code: r.secondary_unit_code,
      })),
    )
    if (cm != null) {
      setMinQuantity(String(cm))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const catalogName = sanitizeCatalogProductName(name)
    if (!companyId || !catalogName) return
    setLoading(true)
    const finalSku = sku.trim() || generateRandomSku()
    const parsedLast = parseCurrencyInput(lastUnitValue)
    const lastUnitValueToSave =
      parsedLast != null && !Number.isNaN(parsedLast) && parsedLast >= 0
        ? parsedLast
        : null
    const lastUnitValueStockToSave =
      lastUnitValueToSave != null
        ? roundUnitPrice(
            convertUnitPriceForProduct(
              lastUnitValueToSave,
              lastUnitValueUnitCode || unit,
              unit,
              unit,
              pendingConversions.map((r) => ({
                primary_unit_code: r.primary_unit_code,
                secondary_unit_code: r.secondary_unit_code,
                primary_qty: Number(r.primary_qty),
                secondary_qty: Number(r.secondary_qty),
              })),
            ) ?? lastUnitValueToSave,
          )
        : null
    const { data, error } = await supabase
      .from('products')
      .insert({
        company_id: companyId,
        name: catalogName,
        sku: finalSku,
        unit,
        min_quantity: parseFloat(minQuantity || '0') || 0,
        current_quantity: 0,
        barcode: barcode.trim() || null,
        composes_cmv: composesCmv,
        ...(lastUnitValueToSave != null
          ? {
              last_unit_value: lastUnitValueToSave,
              last_unit_value_unit_code: lastUnitValueUnitCode || unit,
              last_unit_value_stock: lastUnitValueStockToSave,
              average_cost: lastUnitValueStockToSave,
            }
          : {}),
      })
      .select()
      .single()
    if (error) {
      console.error(error)
      setLoading(false)
      return
    }
    const product = data as Product
    if (productCategoryIds.length > 0) {
      const { error: linkErr } = await supabase
        .from('product_category_assignments')
        .insert(
          productCategoryIds.map((category_id) => ({
            company_id: companyId,
            product_id: product.id,
            category_id,
          })),
        )
      if (linkErr) {
        console.error(linkErr)
        setLoading(false)
        return
      }
    }
    if (pendingConversions.length > 0) {
      const toPersist = prepareProductUnitConversionsForPersist(
        unit,
        pendingConversions.map((r) => ({
          ...r,
          company_id: companyId,
          product_id: product.id,
        })),
      )
      const { error: convErr } = await supabase
        .from('product_unit_conversions')
        .insert(
          toPersist.map((r) => ({
            company_id: companyId,
            product_id: product.id,
            primary_qty: r.primary_qty,
            primary_unit_code: r.primary_unit_code,
            secondary_qty: r.secondary_qty,
            secondary_unit_code: r.secondary_unit_code,
          })),
        )
      if (convErr) {
        console.error(convErr)
        setLoading(false)
        return
      }
    }
    setLoading(false)
    setName('')
    setSku('')
    setUnit(defaultProductStockUnitCode())
    setLastUnitValueUnitCode(defaultProductStockUnitCode())
    setMinQuantity('')
    setLastUnitValue('')
    setBarcode('')
    setComposesCmv(true)
    setProductCategoryIds([])
    setPendingConversions([])
    onOpenChange(false)
    onSuccess?.(product)
  }

  const canSubmit = !!name.trim() && !loading

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl sm:max-w-2xl lg:max-w-3xl">
        <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 pr-6">
              <SheetTitle className="text-xl font-semibold sm:text-2xl">
                Novo produto
              </SheetTitle>
              <SheetDescription>
                Cadastre o item para estoque, notas e vendas.
              </SheetDescription>
              <p className="text-sm text-muted-foreground">
                Campos alinhados à edição do catálogo.
              </p>
            </div>
          </div>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
            <div className="space-y-4 p-6">
              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Identificação
                </p>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="create-name">Nome *</Label>
                    <Input
                      id="create-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Nome do produto"
                      required
                      className={PRODUCT_SHEET_INPUT}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="create-sku">Código (SKU)</Label>
                      <Input
                        id="create-sku"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        placeholder="Opcional – geração automática se vazio"
                        className={PRODUCT_SHEET_INPUT}
                      />
                    </div>
                    <div>
                      <Label htmlFor="create-barcode">Código de barras</Label>
                      <Input
                        id="create-barcode"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value)}
                        placeholder="Opcional — EAN ou alfanumérico"
                        className={PRODUCT_SHEET_INPUT}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Unidade</Label>
                    <Select value={unit} onValueChange={handleUnitChange}>
                      <SelectTrigger className={PRODUCT_SHEET_SELECT}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Categorias de produto
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Várias categorias; crie novas pelo campo abaixo se precisar.
                </p>
                <ProductCategoryTagsField
                  companyId={companyId}
                  categories={companyProductCategories}
                  selectedIds={productCategoryIds}
                  onChange={setProductCategoryIds}
                  onCategoriesChange={() => void loadCompanyProductCategories()}
                  disabled={loading}
                  label=""
                  hint=""
                />
              </div>

              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  CMV e preço de referência
                </p>
                <div className="flex flex-row items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="create-composes-cmv" className="text-base">
                      Este produto compõe CMV?
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Se sim, vendas geram custo de mercadoria vendida na folha
                      CMV da empresa. Se não, a venda não gera CMV.
                    </p>
                  </div>
                  <Switch
                    id="create-composes-cmv"
                    checked={composesCmv}
                    onCheckedChange={setComposesCmv}
                    disabled={loading}
                  />
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="create-last-unit">
                      Último valor pago (opcional)
                    </Label>
                    <Input
                      id="create-last-unit"
                      type="text"
                      inputMode="numeric"
                      value={lastUnitValue}
                      onChange={(e) =>
                        setLastUnitValue(formatCurrencyInput(e.target.value))
                      }
                      placeholder="Ex.: R$ 25,00"
                      className={PRODUCT_SHEET_INPUT}
                    />
                  </div>
                  <div>
                    <Label>Unidade do valor</Label>
                    <Select
                      value={lastUnitValueUnitCode}
                      onValueChange={setLastUnitValueUnitCode}
                    >
                      <SelectTrigger className={PRODUCT_SHEET_SELECT}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {lastUnitValueUnitOptions.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Referência manual por {lastUnitValueUnitCode}. O sistema
                    converte internamente para manter o valor total do estoque.
                  </p>
                </div>
              </div>

              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Quantidades
                </p>
                <div>
                  <Label htmlFor="create-min">Quantidade mínima (alerta)</Label>
                  <Input
                    id="create-min"
                    type="number"
                    step="0.01"
                    min="0"
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                    placeholder="0"
                    className={PRODUCT_SHEET_INPUT}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Será exibido alerta quando o estoque estiver abaixo deste
                    valor. O estoque inicial é zero.
                  </p>
                </div>
              </div>

              <ProductUnitConversionsSection
                companyId={companyId}
                stockUnitCode={unit}
                value={pendingConversions}
                onChange={setPendingConversions}
                disabled={loading}
                sectionClassName={PRODUCT_SHEET_SECTION}
              />
            </div>
          </div>

          <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              {loading ? 'Cadastrando...' : 'Cadastrar produto'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

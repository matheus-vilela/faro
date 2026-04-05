import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  categoryPathLabel,
  isSelectableCmvProductGroup,
} from '@/lib/companyCategoryLabels'
import { supabase } from '@/lib/supabase'
import type { CompanyCategory } from '@/types/category'
import type { Product } from '@/types/product'
import { Package, Plus } from 'lucide-react'

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

const UNIT_OPTIONS = [
  { value: 'un', label: 'Unidade' },
  { value: 'kg', label: 'Quilograma (kg)' },
  { value: 'g', label: 'Gramas (g)' },
  { value: 'l', label: 'Litro (l)' },
  { value: 'ml', label: 'Mililitro (ml)' },
  { value: 'cx', label: 'Caixa' },
  { value: 'pct', label: 'Pacote' },
]

interface CreateProductSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onSuccess?: (product: Product) => void
}

export function CreateProductSheet({
  open,
  onOpenChange,
  companyId,
  onSuccess,
}: CreateProductSheetProps) {
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [unit, setUnit] = useState('un')
  const [minQuantity, setMinQuantity] = useState('')
  const [lastUnitValue, setLastUnitValue] = useState('')
  const [barcode, setBarcode] = useState('')
  const [cmvCategoryId, setCmvCategoryId] = useState<string>('')
  const [cmvCategoriesFull, setCmvCategoriesFull] = useState<CompanyCategory[]>(
    [],
  )
  const [loading, setLoading] = useState(false)

  const loadCmvCategories = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('company_categories')
      .select('*')
      .eq('company_id', companyId)
      .eq('natureza', 'DESPESA')
      .eq('tipo', 'CMV')
      .or('ativo.is.null,ativo.eq.true')
      .order('ordem', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error(error)
      setCmvCategoriesFull([])
      return
    }
    setCmvCategoriesFull((data ?? []) as CompanyCategory[])
  }, [companyId])

  useEffect(() => {
    if (!open || !companyId) return
    void loadCmvCategories()
  }, [open, companyId, loadCmvCategories])

  const cmvById = useMemo(
    () => new Map(cmvCategoriesFull.map((c) => [c.id, c])),
    [cmvCategoriesFull],
  )

  const cmvSelectableSorted = useMemo(() => {
    return cmvCategoriesFull
      .filter((c) => isSelectableCmvProductGroup(c))
      .sort((a, b) =>
        categoryPathLabel(a.id, cmvById).localeCompare(
          categoryPathLabel(b.id, cmvById),
          'pt-BR',
        ),
      )
  }, [cmvCategoriesFull, cmvById])

  const defaultCmvLeafId = useMemo(() => {
    const outras = cmvSelectableSorted.find((c) =>
      c.name.toLowerCase().includes('outras'),
    )
    return outras?.id ?? cmvSelectableSorted[0]?.id ?? ''
  }, [cmvSelectableSorted])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !name.trim()) return
    const resolvedCmv = cmvCategoryId || defaultCmvLeafId
    if (!resolvedCmv) {
      return
    }
    setLoading(true)
    const finalSku = sku.trim() || generateRandomSku()
    const parsedLast = parseFloat(
      lastUnitValue.trim().replace(/\s/g, '').replace(',', '.'),
    )
    const lastUnitValueToSave =
      lastUnitValue.trim() !== '' &&
      !Number.isNaN(parsedLast) &&
      parsedLast >= 0
        ? parsedLast
        : null
    const { data, error } = await supabase
      .from('products')
      .insert({
        company_id: companyId,
        name: name.trim(),
        sku: finalSku,
        unit,
        min_quantity: parseFloat(minQuantity || '0') || 0,
        current_quantity: 0,
        barcode: barcode.trim() || null,
        cmv_category_id: resolvedCmv,
        ...(lastUnitValueToSave != null
          ? { last_unit_value: lastUnitValueToSave }
          : {}),
      })
      .select()
      .single()
    setLoading(false)
    if (error) {
      console.error(error)
      return
    }
    const product = data as Product
    setName('')
    setSku('')
    setUnit('un')
    setMinQuantity('')
    setLastUnitValue('')
    setBarcode('')
    setCmvCategoryId('')
    onOpenChange(false)
    onSuccess?.(product)
  }

  const cmvSelectValue = cmvCategoryId || defaultCmvLeafId || '__none__'
  const canSubmit =
    !!name.trim() &&
    !!cmvSelectableSorted.length &&
    !!(cmvCategoryId || defaultCmvLeafId) &&
    !loading

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Novo produto
          </SheetTitle>
          <SheetDescription>
            Cadastre produtos para controlar estoque e vincular às notas
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label>Nome *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do produto"
              required
            />
          </div>
          <div>
            <Label>Código (SKU)</Label>
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Opcional – deixe em branco para gerar automaticamente"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Informe um código ou deixe em branco para gerar um aleatório
            </p>
          </div>
          <div>
            <Label>Código de barras (etiquetas)</Label>
            <Input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Opcional — EAN ou código alfanumérico"
            />
          </div>
          <div>
            <Label>Unidade</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Categoria de despesa (CMV) *</Label>
            <Select
              value={cmvSelectValue}
              onValueChange={(v) =>
                setCmvCategoryId(v === '__none__' ? '' : v)
              }
              disabled={cmvSelectableSorted.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o grupo de CMV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>
                  Selecione o grupo de CMV
                </SelectItem>
                {cmvSelectableSorted.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {categoryPathLabel(c.id, cmvById)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Escolha uma subcategoria de CMV (o grupo principal &quot;CMV&quot;
              não pode ser selecionado). Cadastre em Configurações › Categorias
              se necessário.
            </p>
          </div>
          <div>
            <Label>Quantidade mínima (alerta)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Será exibido alerta quando o estoque estiver abaixo deste valor
            </p>
          </div>
          <div>
            <Label>Último valor pago (opcional)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={lastUnitValue}
              onChange={(e) => setLastUnitValue(e.target.value)}
              placeholder="Ex.: último preço de compra por unidade"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Referência de preço por {unit}; usada no estoque e CMV até haver
              movimentações valoradas
            </p>
          </div>
          <SheetFooter>
            <Button type="submit" disabled={!canSubmit}>
              <Plus className="h-4 w-4 mr-2" />
              {loading ? 'Cadastrando...' : 'Cadastrar produto'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

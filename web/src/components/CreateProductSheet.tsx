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
  buildChildrenMap,
  companyCategoryDisplayName,
  isLeafCategory,
  isSelectableReceitaLeaf,
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
  const [revenueCategoryId, setRevenueCategoryId] = useState<string>('')
  const [receitaLeaves, setReceitaLeaves] = useState<CompanyCategory[]>([])
  const [loading, setLoading] = useState(false)

  const loadReceitaCategories = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('company_categories')
      .select('*')
      .eq('company_id', companyId)
      .eq('natureza', 'RECEITA')
      .eq('tipo', 'OPERACIONAL')
      .or('ativo.is.null,ativo.eq.true')
      .order('ordem', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error(error)
      setReceitaLeaves([])
      return
    }
    const list = (data ?? []) as CompanyCategory[]
    const cm = buildChildrenMap(list)
    const leaves = list.filter(
      (c) => isSelectableReceitaLeaf(c) && isLeafCategory(c.id, cm),
    )
    setReceitaLeaves(leaves)
  }, [companyId])

  useEffect(() => {
    if (!open || !companyId) return
    void loadReceitaCategories()
  }, [open, companyId, loadReceitaCategories])

  const defaultReceitaLeafId = useMemo(() => {
    const vendas = receitaLeaves.find((c) =>
      c.name.toLowerCase().includes('vendas') &&
      c.name.toLowerCase().includes('produt'),
    )
    return vendas?.id ?? receitaLeaves[0]?.id ?? ''
  }, [receitaLeaves])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !name.trim()) return
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
        revenue_category_id: revenueCategoryId || defaultReceitaLeafId || null,
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
    setRevenueCategoryId('')
    onOpenChange(false)
    onSuccess?.(product)
  }

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
            <Label>Categoria de receita (venda pontual)</Label>
            <Select
              value={revenueCategoryId || defaultReceitaLeafId || '__auto__'}
              onValueChange={(v) =>
                setRevenueCategoryId(v === '__auto__' ? '' : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Padrão do sistema" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">
                  Padrão (ex.: Vendas de produtos)
                </SelectItem>
                {receitaLeaves.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {companyCategoryDisplayName(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Usada no lançamento de receitas por venda de produto e no DRE
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
            <Button type="submit" disabled={!name.trim() || loading}>
              <Plus className="h-4 w-4 mr-2" />
              {loading ? 'Cadastrando...' : 'Cadastrar produto'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

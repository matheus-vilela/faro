import { useState } from 'react'
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
import { supabase } from '@/lib/supabase'
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
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !name.trim()) return
    setLoading(true)
    const finalSku = sku.trim() || generateRandomSku()
    const { data, error } = await supabase
      .from('products')
      .insert({
        company_id: companyId,
        name: name.trim(),
        sku: finalSku,
        unit,
        min_quantity: parseFloat(minQuantity || '0') || 0,
        current_quantity: 0,
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

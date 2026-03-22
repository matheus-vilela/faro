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
import { supabase } from '@/lib/supabase'
import { maskCpfCnpj, maskPhone } from '@/lib/masks'
import type { Supplier } from '@/types/supplier'
import { Building2, Plus } from 'lucide-react'

interface CreateSupplierSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onSuccess?: (supplier: Supplier) => void
}

export function CreateSupplierSheet({
  open,
  onOpenChange,
  companyId,
  onSuccess,
}: CreateSupplierSheetProps) {
  const [name, setName] = useState('')
  const [document, setDocument] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId || !name.trim()) return
    setLoading(true)
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        company_id: companyId,
        name: name.trim(),
        document: document.trim().replace(/\D/g, '') || null,
        email: email.trim() || null,
        phone: phone.trim().replace(/\D/g, '') || null,
        notes: notes.trim() || null,
      })
      .select()
      .single()
    setLoading(false)
    if (error) {
      console.error(error)
      return
    }
    const supplier = data as Supplier
    setName('')
    setDocument('')
    setEmail('')
    setPhone('')
    setNotes('')
    onOpenChange(false)
    onSuccess?.(supplier)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Novo fornecedor
          </SheetTitle>
          <SheetDescription>
            Dados básicos do fornecedor
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do fornecedor"
                required
              />
            </div>
            <div>
              <Label>CNPJ/CPF</Label>
              <Input
                value={document}
                onChange={(e) => setDocument(maskCpfCnpj(e.target.value))}
                placeholder="000.000.000-00 ou 00.000.000/0001-00"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(11) 99999-9999"
              />
            </div>
          </div>
          <div>
            <Label>Observações</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <SheetFooter>
            <Button type="submit" disabled={!name.trim() || loading}>
              <Plus className="h-4 w-4 mr-2" />
              {loading ? 'Cadastrando...' : 'Cadastrar fornecedor'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import type { Company } from '@/contexts/CompanyContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Building2, ChevronDown, Plus } from 'lucide-react'

export function CompanySelector() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { companies, currentCompany, setCurrentCompany, refetchCompanies } = useCompany()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [document, setDocument] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelectCompany = (company: Company) => {
    setCurrentCompany(company)
  }

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const companyId = crypto.randomUUID()
      const { error: companyError } = await supabase
        .from('companies')
        .insert({
          id: companyId,
          name,
          document: document || null,
          email: email || null,
        })

      if (companyError) throw companyError

      const { error: linkError } = await supabase.from('user_companies').insert({
        user_id: user.id,
        company_id: companyId,
        role: 'owner',
      })

      if (linkError) throw linkError

      const company = {
        id: companyId,
        name,
        document: document || null,
        email: email || null,
        phone: null,
        address: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Company

      await refetchCompanies()
      setCurrentCompany(company)
      setCreateOpen(false)
      setName('')
      setDocument('')
      setEmail('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao criar empresa')
    } finally {
      setLoading(false)
    }
  }

  const openCreateDialog = () => {
    setError(null)
    setName('')
    setDocument('')
    setEmail('')
    setCreateOpen(true)
  }

  if (!currentCompany) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            title={currentCompany.name}
            aria-label={`Empresa: ${currentCompany.name}`}
            className="h-9 w-9 shrink-0 md:h-auto md:min-w-[180px] md:w-auto md:justify-between md:px-4 md:py-2 [&>svg]:shrink-0"
          >
            <Building2 className="h-4 w-4" />
            <span className="hidden truncate md:inline">{currentCompany.name}</span>
            <ChevronDown className="hidden h-4 w-4 opacity-50 md:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          {companies.map((company) => (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleSelectCompany(company)}
            >
              <Building2 className="mr-2 h-4 w-4" />
              <span className={company.id === currentCompany.id ? 'font-medium' : ''}>
                {company.name}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Nova empresa
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/empresas')}>
            Gerenciar empresas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
            <DialogDescription>
              Cadastre um novo estabelecimento para gerenciar.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCompany}>
            <div className="grid gap-4 py-4">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="company-name">Nome *</Label>
                <Input
                  id="company-name"
                  placeholder="Nome do bar/restaurante"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-document">CNPJ</Label>
                <Input
                  id="company-document"
                  placeholder="00.000.000/0001-00"
                  value={document}
                  onChange={(e) => setDocument(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-email">Email</Label>
                <Input
                  id="company-email"
                  type="email"
                  placeholder="contato@estabelecimento.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Criando...' : 'Criar empresa'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useEffect } from 'react'
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function Companies() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { companies, currentCompany, setCurrentCompany, refetchCompanies, loading: companiesLoading } = useCompany()

  useEffect(() => {
    if (!companiesLoading && companies.length > 0 && currentCompany) {
      navigate('/app', { replace: true })
    }
  }, [companiesLoading, companies, currentCompany, navigate])
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [document, setDocument] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelectCompany = (company: Company) => {
    setCurrentCompany(company)
    navigate('/app', { replace: true })
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
      setCurrentCompany(company as Company)
      setShowCreate(false)
      setName('')
      setDocument('')
      setEmail('')
      navigate('/app', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao criar empresa')
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  if (companiesLoading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">Carregando empresas...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Selecione ou crie uma empresa</h1>
          <p className="text-muted-foreground mt-1">
            Você pode participar de várias empresas
          </p>
        </div>

        {!showCreate ? (
          <>
            <div className="grid gap-4">
              {companies.map((company) => (
                <Card
                  key={company.id}
                  className="cursor-pointer hover:border-primary transition-colors"
                  onClick={() => handleSelectCompany(company)}
                >
                  <CardHeader>
                    <CardTitle>{company.name}</CardTitle>
                    {company.document && (
                      <CardDescription>CNPJ: {company.document}</CardDescription>
                    )}
                  </CardHeader>
                </Card>
              ))}
            </div>
            <div className="flex gap-4">
              <Button onClick={() => setShowCreate(true)} className="flex-1">
                Nova empresa
              </Button>
              <Button variant="outline" onClick={() => supabase.auth.signOut()}>
                Sair
              </Button>
            </div>
          </>
        ) : (
          <Card>
            <form onSubmit={handleCreateCompany}>
              <CardHeader>
                <CardTitle>Cadastrar nova empresa</CardTitle>
                <CardDescription>
                  Preencha os dados do estabelecimento
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    {error}
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="name">Nome *</Label>
                  <Input
                    id="name"
                    placeholder="Nome do bar/restaurante"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="document">CNPJ</Label>
                  <Input
                    id="document"
                    placeholder="00.000.000/0001-00"
                    value={document}
                    onChange={(e) => setDocument(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="contato@estabelecimento.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Criando...' : 'Criar empresa'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowCreate(false)
                    setError(null)
                  }}
                >
                  Cancelar
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}

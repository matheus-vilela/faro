import { useEffect, useState } from 'react'
import { MonthSelector, getMonthRange, type MonthYear } from '@/components/MonthSelector'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCompany } from '@/contexts/CompanyContext'
import { supabase } from '@/lib/supabase'
import { CreateBoletoSheet } from '@/components/CreateBoletoSheet'
import type { Boleto, PaymentType } from '@/types/expense'

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: 'Boleto',
  pix: 'PIX',
  ted: 'TED',
}
import { ExternalLink, Plus } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const STATUS_LABELS = { pending: 'Pendente', paid: 'Pago' }

export function Boletos() {
  const { currentCompany } = useCompany()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const expenseIdFromUrl = searchParams.get('expense')

  const now = new Date()
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })
  const [boletos, setBoletos] = useState<Boleto[]>([])
  const [loading, setLoading] = useState(true)
  const [boletoSheetOpen, setBoletoSheetOpen] = useState(false)

  const fetchBoletos = async () => {
    if (!currentCompany?.id) return
    setLoading(true)
    const { start, end } = getMonthRange(period.month, period.year)
    const { data } = await supabase
      .from('boletos')
      .select('*')
      .eq('company_id', currentCompany.id)
      .gte('due_date', start.slice(0, 10))
      .lte('due_date', end.slice(0, 10))
      .order('due_date', { ascending: true })
    setBoletos((data as Boleto[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchBoletos()
  }, [currentCompany?.id, period.month, period.year])

  useEffect(() => {
    if (expenseIdFromUrl) setBoletoSheetOpen(true)
  }, [expenseIdFromUrl])

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(v)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Boletos</h1>
        <p className="text-muted-foreground">
          Cadastre boletos e vincule às despesas
        </p>
      </div>

      {currentCompany?.id && (
        <CreateBoletoSheet
          open={boletoSheetOpen}
          onOpenChange={(open) => {
            setBoletoSheetOpen(open)
            if (!open && expenseIdFromUrl) navigate('/app/despesas')
          }}
          companyId={currentCompany.id}
          expenseId={expenseIdFromUrl}
          onSuccess={() => {
            fetchBoletos()
            if (expenseIdFromUrl) navigate('/app/despesas')
          }}
        />
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Boletos cadastrados</CardTitle>
            <CardDescription>
              Clique no ícone para ir à despesa vinculada
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <MonthSelector value={period} onChange={setPeriod} />
            <Button onClick={() => setBoletoSheetOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
              Novo boleto
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : boletos.length === 0 ? (
            <p className="text-muted-foreground">Nenhum boleto cadastrado</p>
          ) : (
            <div className="space-y-2">
              {boletos.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{b.description}</span>
                      <span className="text-xs font-medium text-muted-foreground rounded-md bg-muted px-2 py-0.5">
                        {PAYMENT_TYPE_LABELS[b.payment_type ?? 'boleto']}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {STATUS_LABELS[b.status]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Venc. {formatDate(b.due_date)} • {formatCurrency(b.amount)}
                      {b.provider && ` • ${b.provider}`}
                    </p>
                  </div>
                  <div>
                    {b.expense_id ? (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/app/despesas?expense=${b.expense_id}`)
                        }
                        className="p-2 rounded-md hover:bg-muted transition-colors"
                        title="Ir para despesa"
                      >
                        <ExternalLink className="h-5 w-5 text-primary" />
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        Sem despesa
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCompany } from '@/contexts/CompanyContext'
import { supabase } from '@/lib/supabase'
import type { Recebimento } from '@/types/recebimento'
import { PackageCheck, Share2, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export function Recebimento() {
  const { currentCompany } = useCompany()
  const [recebimentos, setRecebimentos] = useState<Recebimento[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchRecebimentos = async () => {
    if (!currentCompany?.id) return
    setLoading(true)
    const { data: expensesData } = await supabase
      .from('expenses')
      .select('id')
      .eq('company_id', currentCompany.id)
    const expenseIds = (expensesData ?? []).map((e) => e.id)
    if (expenseIds.length === 0) {
      setRecebimentos([])
      setLoading(false)
      return
    }
    const { data } = await supabase
      .from('recebimentos')
      .select(`
        *,
        expenses (
          supplier_name,
          invoice_number,
          notes,
          expense_items (
            product_name,
            quantity,
            unit_value
          )
        )
      `)
      .in('expense_id', expenseIds)
      .order('created_at', { ascending: false })
    setRecebimentos((data ?? []) as Recebimento[])
    setLoading(false)
  }

  useEffect(() => {
    queueMicrotask(() => void fetchRecebimentos())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id])

  const shareLink = async (r: Recebimento) => {
    const url = `${window.location.origin}/confirmar-recebimento/${r.token}`
    await navigator.clipboard.writeText(url)
    setCopiedId(r.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(v)

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Recebimento</h1>
        <p className="text-muted-foreground">
          Confirme o recebimento de mercadorias – compartilhe o link com o operador
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Cards de recebimento
          </CardTitle>
          <CardDescription>
            Cada despesa gera um card. Compartilhe o link para o operador validar os itens ao receber.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : recebimentos.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhum card de recebimento. As despesas criadas geram cards automaticamente.
            </p>
          ) : (
            <div className="space-y-4">
              {recebimentos.map((r) => {
                const exp = r.expenses as Recebimento['expenses']
                const items = exp?.expense_items ?? []
                const total = items.reduce(
                  (s, it) => s + Number(it.quantity) * Number(it.unit_value),
                  0
                )
                const isReceived = r.status === 'received'
                return (
                  <div
                    key={r.id}
                    className="rounded-lg border p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {exp?.supplier_name || 'Sem fornecedor'}
                          </span>
                          {exp?.invoice_number && (
                            <span className="text-sm text-muted-foreground">
                              Nota {exp.invoice_number}
                            </span>
                          )}
                          <Badge
                            variant={isReceived ? 'default' : 'secondary'}
                            className={isReceived ? 'bg-green-600' : ''}
                          >
                            {isReceived ? 'Confirmado' : 'Pendente'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDate(r.created_at)} • {items.length} item(ns) •{' '}
                          {formatCurrency(total)}
                        </p>
                      </div>
                      {!isReceived && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => shareLink(r)}
                        >
                          {copiedId === r.id ? (
                            <>
                              <Check className="h-4 w-4 mr-2 text-green-600" />
                              Link copiado!
                            </>
                          ) : (
                            <>
                              <Share2 className="h-4 w-4 mr-2" />
                              Compartilhar link
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                    {items.length > 0 && (
                      <div className="text-sm border-t pt-3 mt-2">
                        <p className="font-medium mb-2">Itens:</p>
                        <ul className="space-y-1 text-muted-foreground">
                          {items.map((it, i) => (
                            <li key={i}>
                              {it.product_name} — {it.quantity} un ×{' '}
                              {formatCurrency(Number(it.unit_value))}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/app/despesas?expense=${r.expense_id}`}>
                          Ver despesa
                        </Link>
                      </Button>
                      {!isReceived && (
                        <Button asChild size="sm">
                          <a
                            href={`/confirmar-recebimento/${r.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Abrir link do operador
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

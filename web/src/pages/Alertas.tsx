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
import type { Product } from '@/types/product'
import { Calendar, TrendingDown, AlertTriangle, Package, FileText, PackageX, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface ExpenseWithoutBoleto {
  id: string
  supplier_name: string | null
  invoice_number: string | null
  created_at: string
}

interface ItemNaoEntregue {
  id: string
  recebimento_id: string
  expense_id: string
  expense_item_id: string
  supplier_name: string | null
  invoice_number: string | null
  product_name: string
  quantity: number
  received_at: string | null
}

export function Alertas() {
  const { currentCompany } = useCompany()
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([])
  const [expensesWithoutBoleto, setExpensesWithoutBoleto] = useState<ExpenseWithoutBoleto[]>([])
  const [itensNaoEntregues, setItensNaoEntregues] = useState<ItemNaoEntregue[]>([])

  useEffect(() => {
    const load = async () => {
      if (!currentCompany?.id) return
      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .eq('company_id', currentCompany.id)
        .gt('min_quantity', 0)
      const list = (productsData ?? []) as Product[]
      setLowStockProducts(
        list.filter((p) => p.current_quantity <= p.min_quantity)
      )

      const { data: expensesData } = await supabase
        .from('expenses')
        .select('id, supplier_name, invoice_number, created_at')
        .eq('company_id', currentCompany.id)
        .order('created_at', { ascending: false })
      const { data: boletosData } = await supabase
        .from('boletos')
        .select('expense_id')
        .eq('company_id', currentCompany.id)
        .not('expense_id', 'is', null)
      const linkedExpenseIds = new Set(
        (boletosData ?? []).map((b) => b.expense_id).filter(Boolean) as string[]
      )
      const withoutBoleto = (expensesData ?? []).filter(
        (e) => !linkedExpenseIds.has(e.id)
      ) as ExpenseWithoutBoleto[]
      setExpensesWithoutBoleto(withoutBoleto)

      const { data: notReceivedData } = await supabase
        .from('recebimento_item_status')
        .select(`
          id,
          recebimento_id,
          expense_item_id,
          recebimentos!inner (
            expense_id,
            received_at,
            expenses!inner (
              supplier_name,
              invoice_number,
              company_id
            )
          ),
          expense_items!inner (
            product_name,
            quantity
          )
        `)
        .eq('status', 'not_received')
      const notDeliveredList: ItemNaoEntregue[] = []
      for (const r of notReceivedData ?? []) {
        const rec = r as {
          id: string
          recebimento_id: string
          expense_item_id: string
          recebimentos: {
            expense_id: string
            received_at: string | null
            expenses: { supplier_name: string | null; invoice_number: string | null; company_id: string }
          }
          expense_items: { product_name: string; quantity: number }
        }
        if (rec.recebimentos.expenses.company_id !== currentCompany.id) continue
        const ei = Array.isArray(rec.expense_items) ? rec.expense_items[0] : rec.expense_items
        notDeliveredList.push({
          id: rec.id,
          recebimento_id: rec.recebimento_id,
          expense_id: rec.recebimentos.expense_id,
          expense_item_id: rec.expense_item_id,
          supplier_name: rec.recebimentos.expenses.supplier_name,
          invoice_number: rec.recebimentos.expenses.invoice_number,
          product_name: ei?.product_name ?? '—',
          quantity: ei?.quantity ?? 0,
          received_at: rec.recebimentos.received_at,
        })
      }
      setItensNaoEntregues(notDeliveredList)
    }
    load()
  }, [currentCompany?.id])

  const totalAlertas =
    itensNaoEntregues.length + expensesWithoutBoleto.length + lowStockProducts.length
  const hasAnyAlerta = totalAlertas > 0

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alertas</h1>
          <p className="text-muted-foreground mt-1">
            Vencimentos, estoque e acompanhamento de recebimentos
          </p>
        </div>
        {hasAnyAlerta && (
          <Badge variant="secondary" className="w-fit text-base px-4 py-1.5">
            {totalAlertas} alerta{totalAlertas !== 1 ? 's' : ''} pendente{totalAlertas !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {!hasAnyAlerta && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-green-500/10 p-4 mb-4">
              <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-500" />
            </div>
            <h3 className="text-lg font-semibold">Tudo em ordem</h3>
            <p className="text-muted-foreground text-center max-w-sm mt-2">
              Não há alertas pendentes no momento. Vencimentos e margem em breve.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {itensNaoEntregues.length > 0 && (
          <Card className="border-l-4 border-l-destructive overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-destructive/10 p-2">
                    <PackageX className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Itens não entregues</CardTitle>
                    <CardDescription className="mt-0.5">
                      Informados como não recebidos pelo operador
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="destructive">{itensNaoEntregues.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {itensNaoEntregues.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {item.product_name} — {item.quantity} un
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {item.supplier_name || 'Sem fornecedor'}
                        {item.invoice_number && ` • Nota ${item.invoice_number}`}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link to={`/app/despesas?expense=${item.expense_id}`}>Ver</Link>
                    </Button>
                  </div>
                ))}
              </div>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/app/recebimento">Ver recebimentos</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {expensesWithoutBoleto.length > 0 && (
          <Card className="border-l-4 border-l-amber-500 overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-amber-500/10 p-2">
                    <FileText className="h-5 w-5 text-amber-600 dark:text-amber-500" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Sem boleto vinculado</CardTitle>
                    <CardDescription className="mt-0.5">
                      Despesas sem boleto ou pagamento
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="secondary" className="bg-amber-500/20 text-amber-700 dark:text-amber-400">
                  {expensesWithoutBoleto.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {expensesWithoutBoleto.slice(0, 8).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {e.supplier_name || 'Sem fornecedor'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {e.invoice_number && `Nota ${e.invoice_number} • `}
                        {new Date(e.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link to={`/app/despesas?expense=${e.id}`}>Vincular</Link>
                    </Button>
                  </div>
                ))}
                {expensesWithoutBoleto.length > 8 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    + {expensesWithoutBoleto.length - 8} despesa(s)
                  </p>
                )}
              </div>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/app/despesas">Ver todas as despesas</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {lowStockProducts.length > 0 && (
          <Card className="border-l-4 border-l-destructive overflow-hidden lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-destructive/10 p-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Estoque baixo</CardTitle>
                    <CardDescription className="mt-0.5">
                      Produtos abaixo da quantidade mínima
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="destructive">{lowStockProducts.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {lowStockProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {Number(p.current_quantity).toLocaleString('pt-BR')} / {Number(p.min_quantity).toLocaleString('pt-BR')} {p.unit}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link to="/app/produtos">Ver</Link>
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="border-t pt-8">
        <h2 className="text-lg font-semibold mb-4">Em breve</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="opacity-75">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Vencimentos
              </CardTitle>
              <CardDescription className="text-sm">
                Boletos e obrigações próximas do vencimento
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled size="sm">Em breve</Button>
            </CardContent>
          </Card>
          <Card className="opacity-75">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="h-4 w-4" />
                Margem
              </CardTitle>
              <CardDescription className="text-sm">
                Alertas quando a margem estiver abaixo do esperado
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled size="sm">Em breve</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

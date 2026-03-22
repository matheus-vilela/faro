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
import type { Product } from '@/types/product'
import { Calendar, TrendingDown, AlertTriangle, Package, FileText, PackageX } from 'lucide-react'
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Alertas</h1>
        <p className="text-muted-foreground">
          Vencimentos, margem e notificações (também via WhatsApp)
        </p>
      </div>

      {itensNaoEntregues.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <PackageX className="h-5 w-5" />
              Itens não entregues
            </CardTitle>
            <CardDescription>
              {itensNaoEntregues.length} item(ns) informado(s) como não recebido(s) pelo operador
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {itensNaoEntregues.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <PackageX className="h-4 w-4 text-destructive" />
                    <div>
                      <p className="font-medium">
                        {item.product_name} — {item.quantity} un
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.supplier_name || 'Sem fornecedor'}
                        {item.invoice_number && ` • Nota ${item.invoice_number}`}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/app/despesas?expense=${item.expense_id}`}>
                      Ver despesa
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link to="/app/recebimento">Ver recebimentos</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {expensesWithoutBoleto.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <FileText className="h-5 w-5" />
              Despesas sem boleto vinculado
            </CardTitle>
            <CardDescription>
              {expensesWithoutBoleto.length} despesa(s) ainda sem boleto ou pagamento vinculado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {expensesWithoutBoleto.slice(0, 10).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {e.supplier_name || 'Sem fornecedor'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {e.invoice_number && `Nota ${e.invoice_number} • `}
                        {new Date(e.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/app/despesas?expense=${e.id}`}>Vincular boleto</Link>
                  </Button>
                </div>
              ))}
              {expensesWithoutBoleto.length > 10 && (
                <p className="text-sm text-muted-foreground text-center pt-2">
                  e mais {expensesWithoutBoleto.length - 10} despesa(s)...
                </p>
              )}
            </div>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link to="/app/despesas">Ver todas as despesas</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {lowStockProducts.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Estoque baixo
            </CardTitle>
            <CardDescription>
              {lowStockProducts.length} produto(s) com estoque abaixo da quantidade mínima
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockProducts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Estoque: {Number(p.current_quantity).toLocaleString('pt-BR')} {p.unit} • Mínimo: {Number(p.min_quantity).toLocaleString('pt-BR')} {p.unit}
                      </p>
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/app/produtos">Ver produtos</Link>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Vencimentos
            </CardTitle>
            <CardDescription>Alertas de boletos e obrigações próximas do vencimento</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled>Em breve</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              Margem
            </CardTitle>
            <CardDescription>Alertas quando a margem estiver abaixo do esperado</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled>Em breve</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

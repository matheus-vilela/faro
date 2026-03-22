import { useCompany } from '@/contexts/CompanyContext'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Receipt } from 'lucide-react'

export function Dashboard() {
  const { currentCompany } = useCompany()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Bem-vindo ao Faro{currentCompany ? ` - ${currentCompany.name}` : ''}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Documentos fiscais
            </CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">Em breve</p>
            <p className="text-xs text-muted-foreground">
              Módulo de controle de NF-e e documentos fiscais
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

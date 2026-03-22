import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BarChart3, FileText } from 'lucide-react'

export function Relatorios() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">
          DRE, análise de período e relatórios on-demand
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              DRE
            </CardTitle>
            <CardDescription>Demonstração do resultado do exercício</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled>Em breve</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Análise de período
            </CardTitle>
            <CardDescription>Relatórios customizados por período</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled>Em breve</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

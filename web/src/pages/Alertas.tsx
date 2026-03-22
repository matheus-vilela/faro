import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar, TrendingDown } from 'lucide-react'

export function Alertas() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Alertas</h1>
        <p className="text-muted-foreground">
          Vencimentos, margem e notificações (também via WhatsApp)
        </p>
      </div>

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

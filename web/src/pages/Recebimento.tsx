import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PackageCheck } from 'lucide-react'

export function Recebimento() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Recebimento</h1>
        <p className="text-muted-foreground">
          Confirmar recebimento de mercadorias – cozinha, depósito
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Confirmação de recebimento
          </CardTitle>
          <CardDescription>
            Registre o recebimento de mercadorias de forma rápida, sem interromper
            o fluxo do dia
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled>Em breve</Button>
        </CardContent>
      </Card>
    </div>
  )
}

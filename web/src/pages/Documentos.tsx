import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText } from 'lucide-react'

export function Documentos() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documentos fiscais</h1>
        <p className="text-muted-foreground">
          Gerencie suas notas fiscais e documentos
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Em desenvolvimento
          </CardTitle>
          <CardDescription>
            Este módulo permitirá o cadastro e controle de documentos fiscais,
            notas de entrada e saída, e relatórios para o seu estabelecimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled>Em breve</Button>
        </CardContent>
      </Card>
    </div>
  )
}

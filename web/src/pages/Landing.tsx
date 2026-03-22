import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Receipt, BarChart3, Shield } from 'lucide-react'

export function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <span className="text-xl font-bold">Faro</span>
          <nav className="flex gap-4">
            <Link to="/login">
              <Button variant="ghost">Entrar</Button>
            </Link>
            <Link to="/register">
              <Button>Cadastrar</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="container mx-auto px-4 py-24 text-center">
          <h1 className="text-5xl font-bold tracking-tight mb-6">
            Gestão fiscal simplificada para{' '}
            <span className="text-primary">bares e restaurantes</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Organize documentos fiscais, acompanhe obrigações e mantenha seu estabelecimento em dia com a legislação.
          </p>
          <Link to="/register">
            <Button size="lg" className="text-lg px-8">
              Começar grátis
            </Button>
          </Link>
        </section>

        <section className="border-t py-24">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-semibold text-center mb-16">
              Por que escolher o Faro?
            </h2>
            <div className="grid md:grid-cols-3 gap-12">
              <div className="text-center space-y-4">
                <div className="inline-flex p-4 rounded-lg bg-primary/10">
                  <Receipt className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-medium">Controle fiscal</h3>
                <p className="text-muted-foreground">
                  Gerencie notas fiscais, cupons e documentos em um só lugar.
                </p>
              </div>
              <div className="text-center space-y-4">
                <div className="inline-flex p-4 rounded-lg bg-primary/10">
                  <BarChart3 className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-medium">Relatórios claros</h3>
                <p className="text-muted-foreground">
                  Visualize o desempenho do seu negócio com dashboards intuitivos.
                </p>
              </div>
              <div className="text-center space-y-4">
                <div className="inline-flex p-4 rounded-lg bg-primary/10">
                  <Shield className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-medium">Seguro e confiável</h3>
                <p className="text-muted-foreground">
                  Seus dados protegidos com as melhores práticas de segurança.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Faro. Todos os direitos reservados.
      </footer>
    </div>
  )
}

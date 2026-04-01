import { PageHeader } from '@/components/PageHeader'
import { PageShell } from '@/components/PageShell'
import { cn } from '@/lib/utils'
import { canOwnerAccess } from '@/lib/roles'
import { useCompany } from '@/contexts/CompanyContext'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FolderTree, Settings2, Users } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const SUB_LINKS = [
  {
    to: '/app/configuracoes/usuarios-membros',
    label: 'Usuários e membros',
    icon: Users,
  },
  {
    to: '/app/configuracoes/categorias',
    label: 'Categorias',
    icon: FolderTree,
  },
] as const

export function ConfiguracoesLayout() {
  const { currentRole } = useCompany()
  const isOwner = currentRole ? canOwnerAccess(currentRole) : false

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Configurações
            </CardTitle>
            <CardDescription>
              Apenas o proprietário da empresa pode acessar as configurações.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <PageShell narrow className="space-y-8">
      <PageHeader
        icon={Settings2}
        title="Configurações"
        description="Centralize ajustes da empresa, integrações e permissões."
      />

      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-px"
        aria-label="Seções de configurações"
      >
        {SUB_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-border bg-background text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </PageShell>
  )
}

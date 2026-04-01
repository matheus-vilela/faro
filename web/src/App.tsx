import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Landing } from '@/pages/Landing'
import { Login } from '@/pages/Login'
import { Register } from '@/pages/Register'
import { Companies } from '@/pages/Companies'
import { AppLayout } from '@/components/AppLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Despesas } from '@/pages/Despesas'
import { Recebimento } from '@/pages/Recebimento'
import { Alertas } from '@/pages/Alertas'
import { FluxoDeCaixa } from '@/pages/FluxoDeCaixa'
import { Fornecedores } from '@/pages/Fornecedores'
import { Produtos } from '@/pages/Produtos'
import { AtualizarPagamento } from '@/pages/AtualizarPagamento'
import { ConfirmarRecebimento } from '@/pages/ConfirmarRecebimento'
import { RedirectRecebimentoSlug } from '@/pages/RedirectRecebimentoSlug'
import { ConfiguracoesLayout } from '@/components/ConfiguracoesLayout'
import { ConfiguracoesUsuariosMembros } from '@/pages/ConfiguracoesUsuariosMembros'
import { ConfiguracoesCategorias } from '@/pages/ConfiguracoesCategorias'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">Carregando...</p>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AuthenticatedLayout() {
  return (
    <CompanyProvider>
      <Routes>
        <Route path="/empresas" element={<Companies />} />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="despesas" element={<Despesas />} />
          <Route path="fluxo-de-caixa" element={<FluxoDeCaixa />} />
          <Route
            path="boletos"
            element={<Navigate to="/app/fluxo-de-caixa" replace />}
          />
          <Route path="fornecedores" element={<Fornecedores />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="recebimento" element={<Recebimento />} />
          <Route path="alertas" element={<Alertas />} />
          <Route path="configuracoes" element={<ConfiguracoesLayout />}>
            <Route index element={<Navigate to="usuarios-membros" replace />} />
            <Route path="usuarios-membros" element={<ConfiguracoesUsuariosMembros />} />
            <Route path="categorias" element={<ConfiguracoesCategorias />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/empresas" replace />} />
      </Routes>
    </CompanyProvider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/atualizar-pagamento/:token" element={<AtualizarPagamento />} />
      <Route path="/confirmar-recebimento/:token" element={<ConfirmarRecebimento />} />
      {/* Link curto (mesmo destino que /confirmar-recebimento/:token) */}
      <Route path="/c/:token" element={<ConfirmarRecebimento />} />
      {/* Slug → redirect para /c/:token */}
      <Route path="/s/:slug" element={<RedirectRecebimentoSlug />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AuthenticatedLayout />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme}
      position="bottom-right"
      closeButton
      richColors
      offset="1.5rem"
      toastOptions={{
        style: {
          borderRadius: '0.75rem',
          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
          border: '1px solid hsl(var(--border))',
        },
      }}
    />
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
            <ThemeAwareToaster />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

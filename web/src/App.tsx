import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Landing } from '@/pages/Landing'
import { Login } from '@/pages/Login'
import { Register } from '@/pages/Register'
import { Companies } from '@/pages/Companies'
import { AppLayout } from '@/components/AppLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Documentos } from '@/pages/Documentos'
import { Despesas } from '@/pages/Despesas'
import { Recebimento } from '@/pages/Recebimento'
import { Alertas } from '@/pages/Alertas'
import { Relatorios } from '@/pages/Relatorios'
import { Boletos } from '@/pages/Boletos'
import { Fornecedores } from '@/pages/Fornecedores'
import { AtualizarPagamento } from '@/pages/AtualizarPagamento'

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
          <Route path="documentos" element={<Documentos />} />
          <Route path="despesas" element={<Despesas />} />
          <Route path="boletos" element={<Boletos />} />
          <Route path="fornecedores" element={<Fornecedores />} />
          <Route path="recebimento" element={<Recebimento />} />
          <Route path="alertas" element={<Alertas />} />
          <Route path="relatorios" element={<Relatorios />} />
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

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

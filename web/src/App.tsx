import { DevEnvironmentBanner } from "@/components/DevEnvironmentBanner";
import { PermissionRouteGuard } from "@/components/PermissionRouteGuard";
import { AppLayout } from "@/components/AppLayout";
import { ConfiguracoesLayout } from "@/components/ConfiguracoesLayout";
import { RouteDocumentTitle } from "@/components/RouteDocumentTitle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { UnitSetupModalProvider } from "@/contexts/UnitSetupModalContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { Alertas } from "@/pages/Alertas";
import { AtualizarPagamento } from "@/pages/AtualizarPagamento";
import { Companies } from "@/pages/Companies";
import { UnitSetupLegacyOpen } from "@/pages/UnitSetupLegacyOpen";
import { ConfiguracoesCategorias } from "@/pages/ConfiguracoesCategorias";
import { ConfiguracoesImpostosReceita } from "@/pages/ConfiguracoesImpostosReceita";
import { ConfiguracoesWhatsapp } from "@/pages/ConfiguracoesWhatsapp";
import { ConfiguracoesContasBancarias } from "@/pages/ConfiguracoesContasBancarias";
import { ConfiguracoesSemanaContabil } from "@/pages/ConfiguracoesSemanaContabil";
import { ConfiguracoesUsuarios } from "@/pages/ConfiguracoesUsuarios";
import { Checklists } from "@/pages/Checklists";
import { ConfirmarRecebimento } from "@/pages/ConfirmarRecebimento";
import { Dashboard } from "@/pages/Dashboard";
import { Despesas } from "@/pages/Despesas";
import { Receitas } from "@/pages/Receitas";
import { Desenvolvimento } from "@/pages/Desenvolvimento";
import { DesenvolvimentoFornecedoresGlobais } from "@/pages/DesenvolvimentoFornecedoresGlobais";
import { Dre } from "@/pages/Dre";
import { ExecutarChecklist } from "@/pages/ExecutarChecklist";
import { MeuDesempenho } from "@/pages/MeuDesempenho";
import { RedirectStaffPerformanceSlug } from "@/pages/RedirectStaffPerformanceSlug";
import { ContasAPagar } from "@/pages/ContasAPagar";
import { FluxoDeCaixa } from "@/pages/FluxoDeCaixa";
import { VendasRealizadasFluxo } from "@/pages/VendasRealizadasFluxo";
import { ConfiguracoesAdquirentes } from "@/pages/ConfiguracoesAdquirentes";
import { FormasPagamento } from "@/pages/FormasPagamento";
import { Fornecedores } from "@/pages/Fornecedores";
import { Integracoes } from "@/pages/Integracoes";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { PoliticaPrivacidade } from "@/pages/PoliticaPrivacidade";
import { Produtos } from "@/pages/Produtos";
import { Servicos } from "@/pages/Servicos";
import { NOTAS_RECEBIMENTO_PERMISSIONS } from "@/lib/permissions";
import { CertificadoOnboardingPublic } from "@/pages/CertificadoOnboardingPublic";
import { ContagemEstoquePublic } from "@/pages/ContagemEstoquePublic";
import { RedirectChecklistSlug } from "@/pages/RedirectChecklistSlug";
import { RedirectInventorySlug } from "@/pages/RedirectInventorySlug";
import { RedirectRecebimentoSlug } from "@/pages/RedirectRecebimentoSlug";
import { RedefinirSenha } from "@/pages/RedefinirSenha";
import { Register } from "@/pages/Register";
import { TermosDeUso } from "@/pages/TermosDeUso";
import { RedirectWhatsappExpenseDraftSlug } from "@/pages/RedirectWhatsappExpenseDraftSlug";
import { ValidarDespesaWhatsapp } from "@/pages/ValidarDespesaWhatsapp";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

function RedirectPreserveSearch({ to }: { to: string }) {
  const location = useLocation();
  return (
    <Navigate to={`${to}${location.search}${location.hash}`} replace />
  );
}
import { Toaster } from "sonner";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">
          Carregando...
        </p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">
          Carregando...
        </p>
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function AuthenticatedLayout() {
  return (
    <CompanyProvider>
      <UnitSetupModalProvider>
        <Routes>
          <Route path="/empresas" element={<Companies />} />
          <Route
            path="/empresas/unidade/setup"
            element={<UnitSetupLegacyOpen />}
          />
          <Route
            path="/empresas/unidade/setup/:companyId"
            element={<UnitSetupLegacyOpen />}
          />
          <Route path="/app" element={<AppLayout />}>
          <Route index element={<PermissionRouteGuard permission="dashboard"><Dashboard /></PermissionRouteGuard>} />
          <Route
            path="notas-recebimento"
            element={
              <PermissionRouteGuard permissions={NOTAS_RECEBIMENTO_PERMISSIONS}>
                <Despesas />
              </PermissionRouteGuard>
            }
          />
          <Route
            path="despesas"
            element={<RedirectPreserveSearch to="/app/notas-recebimento" />}
          />
          <Route path="vendas" element={<PermissionRouteGuard permission="vendas_realizadas"><Receitas /></PermissionRouteGuard>} />
          <Route
            path="receitas"
            element={<Navigate to="/app/vendas" replace />}
          />
          <Route
            path="lancamento-receitas"
            element={<Navigate to="/app/vendas" replace />}
          />
          <Route path="contas-a-pagar" element={<PermissionRouteGuard permission="contas_a_pagar"><ContasAPagar /></PermissionRouteGuard>} />
          <Route path="vendas-realizadas" element={<PermissionRouteGuard permission="vendas_realizadas"><VendasRealizadasFluxo /></PermissionRouteGuard>} />
          <Route
            path="faturamento"
            element={<Navigate to="/app/vendas-realizadas?tab=faturamento" replace />}
          />
          <Route
            path="formas-de-pagamento"
            element={
              <Navigate to="/app/configuracoes/formas-de-pagamento" replace />
            }
          />
          <Route
            path="cmv-margens"
            element={<Navigate to="/app/vendas-realizadas?tab=margens" replace />}
          />
          <Route
            path="fluxo-de-caixa"
            element={
              <PermissionRouteGuard
                permissions={["contas_a_pagar", "vendas_realizadas"]}
              >
                <FluxoDeCaixa />
              </PermissionRouteGuard>
            }
          />
          <Route
            path="boletos"
            element={<Navigate to="/app/contas-a-pagar" replace />}
          />
          <Route path="fornecedores" element={<PermissionRouteGuard permission="fornecedores"><Fornecedores /></PermissionRouteGuard>} />
          <Route path="produtos" element={<PermissionRouteGuard permission="produtos"><Produtos /></PermissionRouteGuard>} />
          <Route path="servicos" element={<PermissionRouteGuard permission="produtos"><Servicos /></PermissionRouteGuard>} />
          <Route
            path="recebimento"
            element={<RedirectPreserveSearch to="/app/notas-recebimento" />}
          />
          <Route
            path="importacoes"
            element={<Navigate to="/app" replace />}
          />
          <Route path="checklists" element={<PermissionRouteGuard permission="checklists"><Checklists /></PermissionRouteGuard>} />
          <Route path="alertas" element={<PermissionRouteGuard permission="alertas"><Alertas /></PermissionRouteGuard>} />
          <Route
            path="integracoes"
            element={<Navigate to="/app/configuracoes/integracoes" replace />}
          />
          <Route
            path="desenvolvimento"
            element={
              <AdminRoute>
                <Desenvolvimento />
              </AdminRoute>
            }
          />
          <Route
            path="desenvolvimento/fornecedores"
            element={
              <AdminRoute>
                <DesenvolvimentoFornecedoresGlobais />
              </AdminRoute>
            }
          />
          <Route
            path="orcamento"
            element={<Navigate to="/app/dre?tab=orcamento" replace />}
          />
          <Route path="dre" element={<PermissionRouteGuard permission="dre"><Dre /></PermissionRouteGuard>} />
          <Route path="configuracoes" element={<PermissionRouteGuard permissions={["configuracoes", "integracoes"]}><ConfiguracoesLayout /></PermissionRouteGuard>}>
            <Route index element={<Navigate to="usuarios" replace />} />
            <Route
              path="unidade"
              element={<Navigate to="/app/configuracoes/usuarios" replace />}
            />
            <Route
              path="financeiro"
              element={
                <Navigate to="/app/configuracoes/contas-bancarias" replace />
              }
            />
            <Route path="usuarios" element={<ConfiguracoesUsuarios />} />
            <Route
              path="acessos"
              element={<Navigate to="/app/configuracoes/usuarios" replace />}
            />
            <Route
              path="usuarios-membros"
              element={<Navigate to="/app/configuracoes/usuarios" replace />}
            />
            <Route path="categorias" element={<ConfiguracoesCategorias />} />
            <Route
              path="contas-bancarias"
              element={<ConfiguracoesContasBancarias />}
            />
            <Route
              path="impostos-receita"
              element={<ConfiguracoesImpostosReceita />}
            />
            <Route path="whatsapp" element={<ConfiguracoesWhatsapp />} />
            <Route path="integracoes" element={<Integracoes />} />
            <Route path="adquirentes" element={<ConfiguracoesAdquirentes />} />
            <Route path="formas-de-pagamento" element={<FormasPagamento />} />
            <Route
              path="semana-contabil"
              element={<ConfiguracoesSemanaContabil />}
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/empresas" replace />} />
        </Routes>
      </UnitSetupModalProvider>
    </CompanyProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacidade" element={<PoliticaPrivacidade />} />
      <Route path="/termos" element={<TermosDeUso />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      <Route
        path="/atualizar-pagamento/:token"
        element={<AtualizarPagamento />}
      />
      <Route
        path="/confirmar-recebimento/:token"
        element={<ConfirmarRecebimento />}
      />
      {/* Link curto (mesmo destino que /confirmar-recebimento/:token) */}
      <Route path="/c/:token" element={<ConfirmarRecebimento />} />
      {/* Slug → redirect para /c/:token */}
      <Route path="/s/:slug" element={<RedirectRecebimentoSlug />} />
      {/* Slug curto → redirect para /w/:token (rascunho despesa WhatsApp) */}
      <Route path="/e/:slug" element={<RedirectWhatsappExpenseDraftSlug />} />
      {/* Rascunho de despesa (WhatsApp): público, token no URL; não usar ProtectedRoute */}
      <Route path="/w/:token" element={<ValidarDespesaWhatsapp />} />
      <Route path="/k/:slug" element={<RedirectChecklistSlug />} />
      <Route path="/i/:slug" element={<RedirectInventorySlug />} />
      <Route path="/d/:slug" element={<RedirectStaffPerformanceSlug />} />
      <Route path="/contagem-estoque/:token" element={<ContagemEstoquePublic />} />
      <Route
        path="/certificado-onboarding/:token"
        element={<CertificadoOnboardingPublic />}
      />
      <Route path="/checklist/:token" element={<ExecutarChecklist />} />
      <Route path="/desempenho/:token" element={<MeuDesempenho />} />
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
  );
}

function ThemeAwareToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="top-right"
      closeButton
      richColors
      offset="calc(1.5rem + var(--faro-dev-banner-height, 0px))"
      toastOptions={{
        style: {
          borderRadius: "0.75rem",
          boxShadow:
            "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
          border: "1px solid hsl(var(--border))",
        },
      }}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <DevEnvironmentBanner />
        <RouteDocumentTitle />
        <AuthProvider>
          <TooltipProvider>
            <AppRoutes />
            <ThemeAwareToaster />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

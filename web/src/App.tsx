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
import { ConfiguracoesUsuariosMembros } from "@/pages/ConfiguracoesUsuariosMembros";
import { Checklists } from "@/pages/Checklists";
import { ConfirmarRecebimento } from "@/pages/ConfirmarRecebimento";
import { Dashboard } from "@/pages/Dashboard";
import { Despesas } from "@/pages/Despesas";
import { Receitas } from "@/pages/Receitas";
import { Dre } from "@/pages/Dre";
import { ExecutarChecklist } from "@/pages/ExecutarChecklist";
import { FluxoDeCaixa } from "@/pages/FluxoDeCaixa";
import { Fornecedores } from "@/pages/Fornecedores";
import { Integracoes } from "@/pages/Integracoes";
import { Importacoes } from "@/pages/Importacoes";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { Produtos } from "@/pages/Produtos";
import { Recebimento } from "@/pages/Recebimento";
import { ContagemEstoquePublic } from "@/pages/ContagemEstoquePublic";
import { RedirectChecklistSlug } from "@/pages/RedirectChecklistSlug";
import { RedirectInventorySlug } from "@/pages/RedirectInventorySlug";
import { RedirectRecebimentoSlug } from "@/pages/RedirectRecebimentoSlug";
import { RedefinirSenha } from "@/pages/RedefinirSenha";
import { Register } from "@/pages/Register";
import { RedirectWhatsappExpenseDraftSlug } from "@/pages/RedirectWhatsappExpenseDraftSlug";
import { ValidarDespesaWhatsapp } from "@/pages/ValidarDespesaWhatsapp";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
          <Route index element={<Dashboard />} />
          <Route path="despesas" element={<Despesas />} />
          <Route path="receitas" element={<Receitas />} />
          <Route
            path="lancamento-receitas"
            element={<Navigate to="/app/receitas" replace />}
          />
          <Route path="fluxo-de-caixa" element={<FluxoDeCaixa />} />
          <Route
            path="boletos"
            element={<Navigate to="/app/fluxo-de-caixa" replace />}
          />
          <Route path="fornecedores" element={<Fornecedores />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="recebimento" element={<Recebimento />} />
          <Route path="importacoes" element={<Importacoes />} />
          <Route path="checklists" element={<Checklists />} />
          <Route path="alertas" element={<Alertas />} />
          <Route path="integracoes" element={<Integracoes />} />
          <Route path="dre" element={<Dre />} />
          <Route path="configuracoes" element={<ConfiguracoesLayout />}>
            <Route index element={<Navigate to="usuarios-membros" replace />} />
            <Route
              path="usuarios-membros"
              element={<ConfiguracoesUsuariosMembros />}
            />
            <Route path="categorias" element={<ConfiguracoesCategorias />} />
            <Route
              path="impostos-receita"
              element={<ConfiguracoesImpostosReceita />}
            />
            <Route path="whatsapp" element={<ConfiguracoesWhatsapp />} />
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
      <Route path="/contagem-estoque/:token" element={<ContagemEstoquePublic />} />
      <Route path="/checklist/:token" element={<ExecutarChecklist />} />
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
      offset="1.5rem"
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

/** Texto curto na aba após o nome da página. */
const TAB_BRAND = "Faro";

/** Título da landing e fallback quando a rota não está mapeada. */
export const MARKETING_DEFAULT_TITLE =
  "Faro — Gestão fiscal para bares e restaurantes";

function tab(page: string): string {
  return `${page} · ${TAB_BRAND}`;
}

/**
 * Título exibido na aba do navegador para o caminho atual.
 * Rotas mais específicas devem ser testadas antes das genéricas.
 */
export function getDocumentTitle(pathname: string): string {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (path === "" || path === "/") {
    return MARKETING_DEFAULT_TITLE;
  }

  if (path.startsWith("/app/configuracoes/categorias")) {
    return tab("Categorias");
  }
  if (path.startsWith("/app/configuracoes/importacao-produtos")) {
    return tab("Importação de notas");
  }
  if (path.startsWith("/app/configuracoes/impostos-receita")) {
    return tab("Impostos na receita");
  }
  if (path.startsWith("/app/configuracoes/whatsapp")) {
    return tab("WhatsApp");
  }
  if (path.startsWith("/app/configuracoes/formas-de-pagamento")) {
    return tab("Formas de pagamento");
  }
  if (path.startsWith("/app/configuracoes/semana-contabil")) {
    return tab("Semana contábil");
  }
  if (path.startsWith("/app/configuracoes/usuarios")) {
    return tab("Usuários e acessos");
  }
  if (
    path.startsWith("/app/configuracoes/acessos") ||
    path.startsWith("/app/configuracoes/usuarios-membros")
  ) {
    return tab("Usuários e acessos");
  }
  if (path.startsWith("/app/configuracoes")) {
    return tab("Configurações");
  }

  if (path === "/app") {
    return tab("Dashboard");
  }

  const underApp: { prefix: string; label: string }[] = [
    { prefix: "/app/despesas", label: "Notas Fiscais" },
    { prefix: "/app/vendas", label: "Vendas" },
    { prefix: "/app/contas-a-pagar", label: "Contas a pagar" },
    { prefix: "/app/vendas-realizadas", label: "Vendas realizadas" },
    { prefix: "/app/faturamento", label: "Faturamento" },
    { prefix: "/app/cmv-margens", label: "CMV & Margens" },
    { prefix: "/app/fluxo-de-caixa", label: "Fluxo de caixa" },
    { prefix: "/app/fornecedores", label: "Fornecedores" },
    { prefix: "/app/produtos", label: "Produtos e estoque" },
    { prefix: "/app/servicos", label: "Serviços" },
    { prefix: "/app/recebimento", label: "Recebimento" },
    { prefix: "/app/checklists", label: "Checklists" },
    { prefix: "/app/alertas", label: "Alertas" },
    { prefix: "/app/integracoes", label: "Integrações" },
    { prefix: "/app/desenvolvimento/fornecedores", label: "Fornecedores globais" },
    { prefix: "/app/desenvolvimento", label: "Desenvolvimento" },
    { prefix: "/app/orcamento", label: "Orçamento" },
    { prefix: "/app/dre", label: "DRE / Resultado" },
  ];

  for (const { prefix, label } of underApp) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return tab(label);
    }
  }

  if (path === "/empresas" || path.startsWith("/empresas/")) {
    return tab("Empresas");
  }

  if (path === "/login") {
    return tab("Entrar");
  }
  if (path === "/register") {
    return tab("Criar conta");
  }
  if (path === "/privacidade") {
    return tab("Política de privacidade");
  }
  if (path === "/termos") {
    return tab("Termos de uso");
  }
  if (path === "/redefinir-senha") {
    return tab("Redefinir senha");
  }

  if (path.startsWith("/atualizar-pagamento/")) {
    return tab("Atualizar pagamento");
  }
  if (path.startsWith("/confirmar-recebimento/")) {
    return tab("Confirmar recebimento");
  }
  if (path.startsWith("/c/")) {
    return tab("Confirmar recebimento");
  }
  if (path.startsWith("/contagem-estoque/")) {
    return tab("Contagem de estoque");
  }
  if (path.startsWith("/checklist/")) {
    return tab("Checklist");
  }
  if (path.startsWith("/w/")) {
    return tab("Validar despesa");
  }
  if (
    path.startsWith("/s/") ||
    path.startsWith("/e/") ||
    path.startsWith("/k/") ||
    path.startsWith("/i/")
  ) {
    return tab("Carregando");
  }

  return MARKETING_DEFAULT_TITLE;
}

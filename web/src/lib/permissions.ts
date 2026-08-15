/** Chaves alinhadas à sidebar (`AppLayout`) e sub-rotas de configurações. */
export const PERMISSION_KEYS = [
  "dashboard",
  "despesas",
  "recebimento",
  "checklists",
  "fornecedores",
  "produtos",
  "contas_a_pagar",
  "vendas_realizadas",
  "dre",
  "alertas",
  "integracoes",
  "configuracoes",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  dashboard: "Dashboard",
  despesas: "Notas e recebimento",
  recebimento: "Notas e recebimento",
  checklists: "Checklists",
  fornecedores: "Fornecedores",
  produtos: "Produtos e estoque",
  contas_a_pagar: "Contas a pagar",
  vendas_realizadas: "Vendas realizadas",
  dre: "DRE / Resultado",
  alertas: "Alertas",
  integracoes: "Integrações",
  configuracoes: "Configurações",
};

/** Permissões que liberam a tela unificada de notas + recebimento. */
export const NOTAS_RECEBIMENTO_PERMISSIONS: PermissionKey[] = [
  "despesas",
  "recebimento",
];

export const DEFAULT_MEMBER_PERMISSIONS: PermissionKey[] = [...PERMISSION_KEYS];

export function parsePermissionKeys(raw: unknown): PermissionKey[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(PERMISSION_KEYS);
  return raw.filter(
    (k): k is PermissionKey => typeof k === "string" && allowed.has(k),
  );
}

export function hasPermission(
  permissions: readonly string[] | null | undefined,
  key: PermissionKey,
): boolean {
  if (!permissions?.length) return false;
  if (permissions.includes("*")) return true;
  return permissions.includes(key);
}

export function hasAnyPermission(
  permissions: readonly string[] | null | undefined,
  keys: readonly PermissionKey[],
): boolean {
  return keys.some((k) => hasPermission(permissions, k));
}

/** Mapeia pathname `/app/...` para chave de permissão. */
export function permissionKeyForPath(pathname: string): PermissionKey | null {
  const path = pathname.replace(/\/+$/, "") || "/app";
  if (path === "/app") return "dashboard";
  if (path.startsWith("/app/notas-recebimento")) return "despesas";
  if (path.startsWith("/app/despesas")) return "despesas";
  if (path.startsWith("/app/recebimento")) return "recebimento";
  if (path.startsWith("/app/checklists")) return "checklists";
  if (path.startsWith("/app/fornecedores")) return "fornecedores";
  if (path.startsWith("/app/produtos") || path.startsWith("/app/servicos")) {
    return "produtos";
  }
  if (path.startsWith("/app/contas-a-pagar") || path.startsWith("/app/boletos")) {
    return "contas_a_pagar";
  }
  if (
    path.startsWith("/app/vendas-realizadas") ||
    path.startsWith("/app/vendas") ||
    path.startsWith("/app/receitas") ||
    path.startsWith("/app/cmv-margens") ||
    path.startsWith("/app/faturamento")
  ) {
    return "vendas_realizadas";
  }
  if (path.startsWith("/app/orcamento")) return "dre";
  if (path.startsWith("/app/dre")) return "dre";
  if (path.startsWith("/app/alertas")) return "alertas";
  if (path.startsWith("/app/integracoes")) return "integracoes";
  if (path.startsWith("/app/configuracoes/integracoes")) return "integracoes";
  if (path.startsWith("/app/configuracoes/acessos")) return null;
  if (path.startsWith("/app/configuracoes")) return "configuracoes";
  if (path.startsWith("/app/desenvolvimento")) return null;
  if (path.startsWith("/app/fluxo-de-caixa")) return "contas_a_pagar";
  return null;
}

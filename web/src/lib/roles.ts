export type UserCompanyRole = "owner" | "member";

export const ROLE_LABELS: Record<UserCompanyRole, string> = {
  owner: "Proprietário",
  member: "Colaborador",
};

export function isOwnerRole(role: UserCompanyRole | null | undefined): boolean {
  return role === "owner";
}

/** Proprietário: configurações, gestão de acessos e tudo mais. */
export function canOwnerAccess(role: UserCompanyRole | null | undefined): boolean {
  return isOwnerRole(role);
}

/** @deprecated Use `hasPermission` com chaves de `permissions.ts`. */
export function canGestorAccess(role: UserCompanyRole | null | undefined): boolean {
  return role === "owner" || role === "member";
}

/** @deprecated Operador não acessa a plataforma (WhatsApp via company_members). */
export function canOperadorAccess(role: UserCompanyRole | null | undefined): boolean {
  return role === "member" || role === "owner";
}

export type UserCompanyRole = 'operador' | 'gestor' | 'owner'

export const ROLE_LABELS: Record<UserCompanyRole, string> = {
  operador: 'Operador',
  gestor: 'Gestor',
  owner: 'Proprietário',
}

/** Operador: captura NFs, despesas, recebimento - fluxo operacional */
export function canOperadorAccess(role: UserCompanyRole): boolean {
  return ['operador', 'gestor', 'owner'].includes(role)
}

/** Gestor: aprova despesas, alertas, DRE, relatórios */
export function canGestorAccess(role: UserCompanyRole): boolean {
  return ['gestor', 'owner'].includes(role)
}

/** Owner: configurações da empresa, adicionar usuários */
export function canOwnerAccess(role: UserCompanyRole): boolean {
  return role === 'owner'
}

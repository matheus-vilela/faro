export const CONTAS_A_PAGAR_HOME_PATH = "/app/contas-a-pagar";
export const CONTAS_A_PAGAR_LIST_PATH = "/app/contas-a-pagar/listagem";

export type ContasAPagarSection = "calendar" | "list";

export function contasAPagarSectionFromPath(
  pathname: string,
): ContasAPagarSection | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (path === CONTAS_A_PAGAR_HOME_PATH) return "calendar";
  if (path === CONTAS_A_PAGAR_LIST_PATH) return "list";
  if (path.startsWith(`${CONTAS_A_PAGAR_HOME_PATH}/`)) return null;
  return "calendar";
}

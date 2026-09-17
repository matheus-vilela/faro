export const CONTAS_A_RECEBER_HOME_PATH = "/app/contas-a-receber";
export const CONTAS_A_RECEBER_LIST_PATH = "/app/contas-a-receber/listagem";

export type ContasAReceberSection = "calendar" | "list";

export function contasAReceberSectionFromPath(
  pathname: string,
): ContasAReceberSection | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (path === CONTAS_A_RECEBER_HOME_PATH) return "calendar";
  if (path === CONTAS_A_RECEBER_LIST_PATH) return "list";
  if (path.startsWith(`${CONTAS_A_RECEBER_HOME_PATH}/`)) return null;
  return "calendar";
}

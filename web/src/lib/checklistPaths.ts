export const CHECKLISTS_HOME_PATH = "/app/checklists";
export const CHECKLISTS_HISTORY_PATH = "/app/checklists/historico";
export const CHECKLISTS_CONFERENCE_PATH = "/app/checklists/conferencia";
export const CHECKLISTS_RANKING_PATH = "/app/checklists/ranking";

export type ChecklistSection =
  | "overview"
  | "historico"
  | "conferencia"
  | "ranking";

export function checklistSectionFromPath(
  pathname: string,
): ChecklistSection | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (path === CHECKLISTS_HOME_PATH) return "overview";
  if (path === CHECKLISTS_HISTORY_PATH) return "historico";
  if (path === CHECKLISTS_CONFERENCE_PATH) return "conferencia";
  if (path === CHECKLISTS_RANKING_PATH) return "ranking";
  if (path.startsWith(`${CHECKLISTS_HOME_PATH}/`)) return null;
  return "overview";
}

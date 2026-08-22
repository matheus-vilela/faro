const MAXIMIZED_KEY = "faro-sheet-maximized";
const INFO_VIEW_KEY = "faro-sheet-info-view";

const MOBILE_MAX_WIDTH = 768;

export type SheetInfoView = "table" | "cards";

export function isSheetMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_MAX_WIDTH;
}

export function readSheetMaximized(): boolean {
  try {
    return localStorage.getItem(MAXIMIZED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSheetMaximized(value: boolean): void {
  try {
    localStorage.setItem(MAXIMIZED_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readSheetInfoView(isMobile = isSheetMobileViewport()): SheetInfoView {
  return isMobile ? "cards" : "table";
}

export function writeSheetInfoView(value: SheetInfoView): void {
  try {
    localStorage.setItem(INFO_VIEW_KEY, value);
  } catch {
    /* ignore */
  }
}

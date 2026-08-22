import { useIsMobile } from "@/hooks/use-mobile";
import type { SheetInfoView } from "@/lib/sheetUiPrefs";

/** Em sheets: cards só no celular; tabela nos demais tamanhos. */
export function useSheetListView(): SheetInfoView {
  return useIsMobile() ? "cards" : "table";
}

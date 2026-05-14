import { DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT } from "@/lib/dashboardImportReviewUi";
import { DashboardImportReviewEntryNoExitCard } from "./DashboardImportReviewEntryNoExitCard";
import { DashboardImportReviewExitNoEntryCard } from "./DashboardImportReviewExitNoEntryCard";
import { DashboardImportReviewPendingRevenueLinkCard } from "./DashboardImportReviewPendingRevenueLinkCard";

/**
 * Agrupa revisão pós-importação (entradas/saídas cruzadas + ligação receita) e o atalho
 * para a mesma folha de vínculos NF ↔ catálogo da Central de pendências.
 */
export function DashboardImportReviewHub({
  companyId,
  importPendingOpenCount,
  refreshSignal,
  onPipelineChange,
}: {
  companyId: string;
  /** Contagem de `import_review_pending` OPEN (mesma métrica do cartão de alertas). */
  importPendingOpenCount: number;
  refreshSignal?: number;
  onPipelineChange?: () => void;
}) {
  const openVinculosSheet = () => {
    window.dispatchEvent(
      new CustomEvent(DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT),
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DashboardImportReviewExitNoEntryCard
          companyId={companyId}
          refreshSignal={refreshSignal}
          onPipelineChange={onPipelineChange}
        />
        <DashboardImportReviewEntryNoExitCard
          companyId={companyId}
          refreshSignal={refreshSignal}
        />
        <DashboardImportReviewPendingRevenueLinkCard
          companyId={companyId}
          refreshSignal={refreshSignal}
          onPipelineChange={onPipelineChange}
        />
      </div>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT } from "@/lib/dashboardImportReviewUi";
import { Link2 } from "lucide-react";
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
    window.dispatchEvent(new CustomEvent(DASHBOARD_OPEN_IMPORT_PENDING_SHEET_EVENT));
  };

  return (
    <div className="space-y-4">
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

      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" aria-hidden />
          <p className="min-w-0 leading-snug">
            <span className="font-medium text-foreground">Vínculos NF ↔ produto.</span>{" "}
            Linhas de compra ainda por confirmar no catálogo — mesmo painel da Central de pendências.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          onClick={openVinculosSheet}
        >
          Abrir vínculos
          {importPendingOpenCount > 0 ? (
            <span className="ml-2 rounded-md bg-background px-2 py-0.5 text-xs font-bold tabular-nums">
              {importPendingOpenCount}
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}

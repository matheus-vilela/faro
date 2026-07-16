import { DashboardImportReviewEpocRecipesNoIngredientsCard } from "./DashboardImportReviewEpocRecipesNoIngredientsCard";
import { DashboardImportReviewPendingRevenueLinkCard } from "./DashboardImportReviewPendingRevenueLinkCard";

/** Revisão pós-importação: fichas pendentes (só saída) e ligação de vendas à ficha. */
export function DashboardImportReviewHub({
  companyId,
  refreshSignal,
  onPipelineChange,
}: {
  companyId: string;
  refreshSignal?: number;
  onPipelineChange?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 ">
        <DashboardImportReviewPendingRevenueLinkCard
          companyId={companyId}
          refreshSignal={refreshSignal}
          onPipelineChange={onPipelineChange}
        />
        <DashboardImportReviewEpocRecipesNoIngredientsCard
          companyId={companyId}
          refreshSignal={refreshSignal}
          onPipelineChange={onPipelineChange}
        />
      </div>
    </div>
  );
}

import { DashboardImportReviewEpocRecipesNoIngredientsCard } from "./DashboardImportReviewEpocRecipesNoIngredientsCard";
import { DashboardImportReviewPendingRevenueLinkCard } from "./DashboardImportReviewPendingRevenueLinkCard";
import { DashboardProductRecipeMatchPanel } from "./DashboardProductRecipeMatchPanel";

/** Revisão pós-importação: fichas pendentes, utilizações de compras e ligação de vendas. */
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
      <DashboardProductRecipeMatchPanel
        companyId={companyId}
        refreshSignal={refreshSignal}
        onLinked={onPipelineChange}
      />
    </div>
  );
}

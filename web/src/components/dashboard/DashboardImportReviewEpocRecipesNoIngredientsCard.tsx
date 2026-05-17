import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  dashboardImportReviewEpocRecipeRevertToProduct,
  fetchDashboardImportReviewEpocRecipesNoIngredients,
  type DashboardEpocRecipeNoIngredientsRow,
} from "@/lib/dashboardImportReview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChefHat, Inbox, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function DashboardImportReviewEpocRecipesNoIngredientsCard({
  companyId,
  refreshSignal = 0,
  onPipelineChange,
}: {
  companyId: string;
  refreshSignal?: number;
  onPipelineChange?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardEpocRecipeNoIngredientsRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { rows: next, error: err } =
      await fetchDashboardImportReviewEpocRecipesNoIngredients(
        supabase,
        companyId,
      );
    setLoading(false);
    if (err) {
      setError(err);
      setRows([]);
      return;
    }
    setRows(next);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const revertToProduct = async (productId: string) => {
    setBusyId(productId);
    const res = await dashboardImportReviewEpocRecipeRevertToProduct(
      supabase,
      companyId,
      productId,
    );
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível converter em produto.");
      return;
    }
    toast.success("Item reclassificado como produto de venda.");
    onPipelineChange?.();
    void load();
  };

  return (
    <>
      {editRecipeId ? (
        <EstoqueReceitasPanel
          key={editRecipeId}
          companyId={companyId}
          sheetOnly
          ingredientsOnly
          initialOpenRecipeId={editRecipeId}
          onSheetOpenChange={(open) => {
            if (!open) setEditRecipeId(null);
          }}
          onStockChanged={() => {
            onPipelineChange?.();
            void load();
          }}
        />
      ) : null}

      <Card className="border-violet-500/20 bg-gradient-to-br from-card to-violet-500/5 md:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-800 dark:text-violet-300">
                <ChefHat className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg leading-snug">
                  Fichas técnicas sem insumos
                </CardTitle>
                <CardDescription className="text-pretty">
                  Itens classificados como <strong>ficha técnica</strong> na
                  importação do EPOC (ex.: caipirinha, balde de cerveja). Cadastre
                  os insumos ou use <strong>Não é uma ficha técnica</strong> para
                  tratar o item como produto de venda.
                </CardDescription>
              </div>
            </div>
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
                rows.length > 0
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100"
                  : "border-muted text-muted-foreground",
              )}
              aria-live="polite"
            >
              {loading ? "…" : rows.length}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando fichas pendentes…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-50" />
              <p>Nenhuma ficha pendente de insumos.</p>
            </div>
          ) : (
            <ul className="max-h-[min(70vh,560px)] space-y-2 overflow-y-auto overscroll-contain">
              {rows.map((r) => (
                <li
                  key={r.recipe_id}
                  className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {r.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Unidade de venda: {r.unit}
                      {r.priority_epoc ? (
                        <span className="ml-2 rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-900 dark:text-violet-200">
                          Importação EPOC
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={busyId === r.product_id}
                      onClick={() => setEditRecipeId(r.recipe_id)}
                    >
                      Cadastrar insumos
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId === r.product_id}
                      onClick={() => void revertToProduct(r.product_id)}
                    >
                      <Package className="mr-1 h-3.5 w-3.5" />
                      Não é uma ficha técnica
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

import {
  EstoqueReceitasPanel,
  type EstoqueReceitasPanelHandle,
} from "@/components/estoque/EstoqueReceitasPanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  dashboardImportReviewEpocRecipeRevertToProduct,
  fetchDashboardImportReviewEpocRecipesNoIngredients,
  type DashboardEpocRecipeNoIngredientsRow,
} from "@/lib/dashboardImportReview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChefHat, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Altura máxima do card; lista e editor crescem juntos até esse teto. */
const CARD_MAX_HEIGHT = "max-h-[min(80vh,900px)]";
const PENDING_LIST_VIEWPORT_MIN_HEIGHT = "max-h-[min(70vh,720px)]";
const DESKTOP_GRID_MIN_HEIGHT = "max-h-[min(70vh,720px)]";
const MOBILE_LIST_MAX_HEIGHT = "max-h-[min(50vh,400px)]";

function RecipeListItem({
  row,
  isSelected,
  busyId,
  onSelect,
  onRevert,
}: {
  row: DashboardEpocRecipeNoIngredientsRow;
  isSelected: boolean;
  busyId: string | null;
  onSelect: (recipeId: string) => void;
  onRevert: (productId: string) => void;
}) {
  return (
    <li className="min-h-[6.25rem]">
      <button
        className={cn(
          "flex h-full min-h-[6.25rem] flex-col rounded-xl border p-3 transition-colors w-full",
          isSelected
            ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
            : "border-border/80 bg-background/60 hover:border-amber-500/25 hover:bg-muted/30",
        )}
        type="button"
        onClick={() => onSelect(row.recipe_id)}
      >
        <div className="w-full text-left">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Unidade de venda: {row.unit}
            {row.priority_epoc ? (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-900 dark:text-amber-200">
                Importação EPOC
              </span>
            ) : null}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap w-fit gap-2 ">
          <Button
            type="button"
            variant={isSelected ? "default" : "outline"}
            size="sm"
            disabled={busyId === row.product_id}
            onClick={() => onSelect(row.recipe_id)}
          >
            Cadastrar ficha
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground border-1"
            disabled={busyId === row.product_id}
            onClick={(e) => {
              e.stopPropagation();
              onRevert(row.product_id);
            }}
          >
            <Package className="mr-1 h-3.5 w-3.5" />
            Não é ficha
          </Button>
        </div>
      </button>
    </li>
  );
}

export function DashboardImportReviewEpocRecipesNoIngredientsCard({
  companyId,
  refreshSignal = 0,
  onPipelineChange,
}: {
  companyId: string;
  refreshSignal?: number;
  onPipelineChange?: () => void;
}) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardEpocRecipeNoIngredientsRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const recipePanelRef = useRef<EstoqueReceitasPanelHandle>(null);
  /** Evita spinner no card quando o próprio save/revert disparou refreshSignal. */
  const skipFullLoadRef = useRef(false);

  const reloadQuiet = useCallback(async () => {
    setError(null);
    const { rows: next, error: err } =
      await fetchDashboardImportReviewEpocRecipesNoIngredients(
        supabase,
        companyId,
      );
    if (err) {
      setError(err);
      setRows([]);
      return;
    }
    setRows(next);
  }, [companyId]);

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

  const refreshAfterLocalChange = useCallback(() => {
    skipFullLoadRef.current = true;
    void reloadQuiet();
    onPipelineChange?.();
  }, [reloadQuiet, onPipelineChange]);

  const mountedRef = useRef(false);

  useEffect(() => {
    if (skipFullLoadRef.current) {
      skipFullLoadRef.current = false;
      return;
    }
    if (!mountedRef.current) {
      mountedRef.current = true;
      void load();
      return;
    }
    void reloadQuiet();
  }, [load, reloadQuiet, refreshSignal]);

  useEffect(() => {
    if (
      selectedRecipeId &&
      !rows.some((r) => r.recipe_id === selectedRecipeId)
    ) {
      setSelectedRecipeId(null);
    }
  }, [rows, selectedRecipeId]);

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
    refreshAfterLocalChange();
  };

  if (rows.length === 0) {
    return null;
  }

  const selectRecipe = async (recipeId: string) => {
    if (recipeId === selectedRecipeId) return;
    if (selectedRecipeId) {
      const leave =
        (await recipePanelRef.current?.confirmLeaveIfDirty()) ?? "proceed";
      if (leave === "cancel") return;
    }
    setSelectedRecipeId(recipeId);
  };

  const recipeEditor = selectedRecipeId ? (
    <EstoqueReceitasPanel
      ref={recipePanelRef}
      companyId={companyId}
      sheetOnly
      embedInline={!isMobile}
      ingredientsOnly
      initialOpenRecipeId={selectedRecipeId}
      onSheetOpenChange={(open) => {
        if (!open) setSelectedRecipeId(null);
      }}
      onStockChanged={refreshAfterLocalChange}
    />
  ) : null;

  const listSection = (
    <section
      className={cn("flex min-h-0 flex-col gap-2", !isMobile && "h-full")}
    >
      <p className="shrink-0 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Fichas pendentes <strong>({rows.length})</strong>
      </p>
      <ul
        className={cn(
          "min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 pb-20",
          PENDING_LIST_VIEWPORT_MIN_HEIGHT,
          isMobile && MOBILE_LIST_MAX_HEIGHT,
        )}
      >
        {rows.map((r) => (
          <RecipeListItem
            key={r.recipe_id}
            row={r}
            isSelected={selectedRecipeId === r.recipe_id}
            busyId={busyId}
            onSelect={selectRecipe}
            onRevert={(pid) => void revertToProduct(pid)}
          />
        ))}
      </ul>
    </section>
  );

  return (
    <>
      {isMobile ? recipeEditor : null}

      <Card
        className={cn(
          "flex flex-col overflow-hidden border-amber-500/50 bg-gradient-to-br from-card to-amber-500/15 md:col-span-2 w-full",
          CARD_MAX_HEIGHT,
        )}
      >
        <CardHeader className="shrink-0 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300">
                <ChefHat className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg leading-snug">
                  Fichas técnicas sem produto vinculado
                </CardTitle>
                <CardDescription className="text-pretty">
                  Itens classificados como <strong>ficha técnica</strong> na
                  importação do EPOC (ex.: caipirinha, balde de cerveja).{" "}
                  {isMobile ? (
                    <>
                      Toque em <strong>Cadastrar produto</strong> para abrir o
                      editor ou use <strong>Não é ficha</strong> para tratar
                      como produto de venda.
                    </>
                  ) : (
                    <>
                      Selecione uma ficha à esquerda e cadastre os produtos à
                      direita, ou use <strong>Não é uma ficha técnica</strong>{" "}
                      para tratar como produto de venda.
                    </>
                  )}
                </CardDescription>
              </div>
            </div>
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
                rows.length > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                  : "border-muted text-muted-foreground",
              )}
              aria-live="polite"
            >
              {loading ? "…" : rows.length}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando fichas pendentes…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : isMobile ? (
            listSection
          ) : (
            <div
              className={cn(
                "grid flex-1 pb-20 items-stretch gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]",
                DESKTOP_GRID_MIN_HEIGHT,
              )}
            >
              {listSection}
              <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
                <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Produtos da ficha
                </p>
                {selectedRecipeId ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {recipeEditor}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
                    <ChefHat className="h-10 w-10 opacity-40" />
                    <p>
                      Selecione uma ficha na lista ou clique em{" "}
                      <span className="font-medium text-foreground">
                        Cadastrar produtos
                      </span>{" "}
                      para montar os produtos aqui.
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

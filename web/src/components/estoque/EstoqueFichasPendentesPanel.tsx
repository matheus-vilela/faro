import {
  EstoqueReceitasPanel,
  type EstoqueReceitasPanelHandle,
} from "@/components/estoque/EstoqueReceitasPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  dashboardImportReviewFinalizeRecipeProductSales,
  dashboardImportReviewSetResolution,
  fetchDashboardImportReviewEpocRecipesNoIngredients,
  fetchDashboardImportReviewPendingRevenueLink,
  type DashboardEpocRecipeNoIngredientsRow,
  type DashboardPendingRevenueLinkRow,
} from "@/lib/dashboardImportReview";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChefHat, Inbox, Link2, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/** Altura máxima do card; lista e editor crescem juntos até esse teto. */
const CARD_MAX_HEIGHT = "max-h-[min(80vh,900px)]";
const PENDING_LIST_VIEWPORT_MIN_HEIGHT = "max-h-[min(70vh,720px)]";
const DESKTOP_GRID_MIN_HEIGHT = "max-h-[min(70vh,720px)]";
const MOBILE_LIST_MAX_HEIGHT = "max-h-[min(50vh,400px)]";

function recipeRowKey(row: DashboardEpocRecipeNoIngredientsRow): string {
  return row.product_id;
}

function RecipeListItem({
  row,
  isSelected,
  busyId,
  onSelect,
  onDismiss,
}: {
  row: DashboardEpocRecipeNoIngredientsRow;
  isSelected: boolean;
  busyId: string | null;
  onSelect: (row: DashboardEpocRecipeNoIngredientsRow) => void;
  onDismiss: (row: DashboardEpocRecipeNoIngredientsRow) => void;
}) {
  return (
    <li>
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border p-3 transition-colors",
          isSelected
            ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
            : "border-border/80 bg-background/60 hover:border-amber-500/25 hover:bg-muted/30",
        )}
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelect(row)}
        >
          <p className="truncate font-medium text-foreground">{row.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Unidade de venda: {row.unit}
            {row.priority_epoc ? (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-900 dark:text-amber-200">
                Importação EPOC
              </span>
            ) : null}
          </p>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          disabled={busyId === row.product_id}
          onClick={() => onDismiss(row)}
        >
          <Package className="mr-1 h-3.5 w-3.5" />
          Não é ficha
        </Button>
      </div>
    </li>
  );
}

function FichasPendentesStep1({
  companyId,
  refreshSignal,
  onPipelineChange,
}: {
  companyId: string;
  refreshSignal: number;
  onPipelineChange: () => void;
}) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardEpocRecipeNoIngredientsRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const recipePanelRef = useRef<EstoqueReceitasPanelHandle>(null);
  const skipFullLoadRef = useRef(false);
  const mountedRef = useRef(false);

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
    onPipelineChange();
  }, [reloadQuiet, onPipelineChange]);

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
      selectedRowKey &&
      !rows.some((r) => recipeRowKey(r) === selectedRowKey)
    ) {
      setSelectedRowKey(null);
    }
  }, [rows, selectedRowKey]);

  const dismissAsProduct = async (row: DashboardEpocRecipeNoIngredientsRow) => {
    setBusyId(row.product_id);
    if (row.recipe_id) {
      const res = await dashboardImportReviewEpocRecipeRevertToProduct(
        supabase,
        companyId,
        row.product_id,
      );
      if (!res.ok) {
        setBusyId(null);
        toast.error(res.error ?? "Não foi possível converter em produto.");
        return;
      }
    } else {
      const res = await dashboardImportReviewSetResolution(supabase, {
        companyId,
        productId: row.product_id,
        bucket: "EXIT_NO_ENTRY",
        resolution: "DISMISSED",
      });
      if (!res.ok) {
        setBusyId(null);
        toast.error(res.error ?? "Não foi possível dispensar o item.");
        return;
      }
    }
    setBusyId(null);
    toast.success("Item mantido como produto de venda.");
    if (selectedRowKey === recipeRowKey(row)) {
      setSelectedRowKey(null);
    }
    refreshAfterLocalChange();
  };

  const selectRow = async (row: DashboardEpocRecipeNoIngredientsRow) => {
    const key = recipeRowKey(row);
    if (key === selectedRowKey) return;
    if (selectedRowKey) {
      const leave =
        (await recipePanelRef.current?.confirmLeaveIfDirty()) ?? "proceed";
      if (leave === "cancel") return;
    }
    setSelectedRowKey(key);
  };

  if (!loading && !error && rows.length === 0) {
    return null;
  }

  const selectedRow = rows.find((r) => recipeRowKey(r) === selectedRowKey) ?? null;

  const recipeEditor = selectedRow ? (
    <EstoqueReceitasPanel
      key={`${selectedRow.product_id}:${selectedRow.recipe_id ?? "draft"}`}
      ref={recipePanelRef}
      companyId={companyId}
      sheetOnly
      embedInline={!isMobile}
      ingredientsOnly
      initialOpenRecipeId={selectedRow.recipe_id}
      technicalSheetOutputProductId={
        selectedRow.recipe_id ? null : selectedRow.product_id
      }
      contextOutputProductId={selectedRow.product_id}
      onTechnicalSheetSaved={() => {
        refreshAfterLocalChange();
      }}
      onSheetOpenChange={(open) => {
        if (!open) setSelectedRowKey(null);
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
            key={recipeRowKey(r)}
            row={r}
            isSelected={selectedRowKey === recipeRowKey(r)}
            busyId={busyId}
            onSelect={(item) => void selectRow(item)}
            onDismiss={(item) => void dismissAsProduct(item)}
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
          "flex flex-col overflow-hidden border-amber-500/50 bg-gradient-to-br from-card to-amber-500/15 w-full",
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
                  Etapa 1: fichas técnicas pendentes
                </CardTitle>
                <CardDescription className="text-pretty">
                  Produtos com <strong>movimentação só de saída</strong> (vendas
                  sem entrada de estoque) — candidatos a ficha técnica.{" "}
                  {isMobile ? (
                    <>
                      Toque em um item para montar os insumos ou use{" "}
                      <strong>Não é ficha</strong> para manter como produto de
                      venda.
                    </>
                  ) : (
                    <>
                      Selecione um item à esquerda para montar os produtos à
                      direita, ou use <strong>Não é ficha</strong> para manter
                      como produto de venda.
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
                "grid flex-1 items-stretch gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]",
                DESKTOP_GRID_MIN_HEIGHT,
              )}
            >
              {listSection}
              <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
                <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Produtos da ficha
                </p>
                {selectedRow ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {recipeEditor}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
                    <ChefHat className="h-10 w-10 opacity-40" />
                    <p>
                      Selecione uma ficha na lista para montar os produtos aqui.
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

function FichasPendentesStep2({
  companyId,
  refreshSignal,
  onPipelineChange,
}: {
  companyId: string;
  refreshSignal: number;
  onPipelineChange: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardPendingRevenueLinkRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] =
    useState<DashboardPendingRevenueLinkRow | null>(null);
  const skipFullLoadRef = useRef(false);
  const mountedRef = useRef(false);

  const reloadQuiet = useCallback(async () => {
    setError(null);
    const { rows: next, error: err } =
      await fetchDashboardImportReviewPendingRevenueLink(supabase, companyId);
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
      await fetchDashboardImportReviewPendingRevenueLink(supabase, companyId);
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
    onPipelineChange();
  }, [reloadQuiet, onPipelineChange]);

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

  const runFinalize = async () => {
    if (!confirmRow) return;
    const pid = confirmRow.product_id;
    setBusyId(pid);
    const res = await dashboardImportReviewFinalizeRecipeProductSales(
      supabase,
      companyId,
      pid,
    );
    setBusyId(null);
    setConfirmRow(null);
    if (!res.ok) {
      toast.error(
        res.error ??
          "Nenhum lançamento foi alterado. Verifique a ficha e tente novamente.",
      );
      return;
    }
    toast.success(
      res.migrated_entries != null && res.migrated_entries > 0
        ? `${res.migrated_entries} lançamento(s) de venda associados à ficha técnica.`
        : "Nenhuma venda pendente em modo produto; estado atualizado.",
    );
    refreshAfterLocalChange();
  };

  if (!loading && !error && rows.length === 0) {
    return null;
  }

  return (
    <>
      <AlertDialog
        open={!!confirmRow}
        onOpenChange={(o) => !o && setConfirmRow(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ligar vendas à ficha técnica?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-pretty">
              <span>
                Os lançamentos de receita ainda em modo{" "}
                <strong className="text-foreground">venda de produto</strong>{" "}
                para{" "}
                <strong className="text-foreground">{confirmRow?.name}</strong>{" "}
                passarão a{" "}
                <strong className="text-foreground">venda por receita</strong>,
                usando a ficha já cadastrada. As movimentações de estoque já
                registadas{" "}
                <strong className="text-foreground">
                  não são apagadas nem recalculadas
                </strong>
                .
              </span>
              <span className="block text-muted-foreground">
                Confirme apenas depois de validar os insumos da receita.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void runFinalize();
              }}
              disabled={!!busyId}
            >
              {busyId ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A migrar…
                </>
              ) : (
                "Ligar vendas à ficha"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-emerald-500/20 bg-gradient-to-br from-card to-emerald-500/5">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                <Link2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg leading-snug">
                  Etapa 2: vendas ainda como produto (pós-ficha)
                </CardTitle>
                <CardDescription className="text-pretty">
                  Após confirmar o item como ficha técnica e incluir{" "}
                  <strong>pelo menos um insumo</strong> na receita, pode
                  associar aqui os lançamentos de venda importados que ainda
                  estavam no modo produto. Ação explícita — nada corre em
                  segundo plano.
                </CardDescription>
              </div>
            </div>
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
                rows.length > 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
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
              <Loader2 className="h-4 w-4 animate-spin" />A verificar filas…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.product_id}
                  className="flex flex-col gap-2 rounded-xl border border-border/80 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {r.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.pending_sales_count} venda(s) ainda em modo produto
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === r.product_id}
                      onClick={() => setConfirmRow(r)}
                    >
                      Ligar vendas à ficha
                    </Button>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link to="/app/produtos/fichas">
                        Abrir receitas
                      </Link>
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

/** Pipeline pós-importação: montar fichas e ligar vendas históricas. */
export function EstoqueFichasPendentesPanel({
  companyId,
}: {
  companyId: string;
}) {
  const [pipelineSeq, setPipelineSeq] = useState(0);
  const [step1Count, setStep1Count] = useState<number | null>(null);
  const [step2Count, setStep2Count] = useState<number | null>(null);

  const bumpPipeline = useCallback(() => {
    setPipelineSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [a, b] = await Promise.all([
        fetchDashboardImportReviewEpocRecipesNoIngredients(supabase, companyId),
        fetchDashboardImportReviewPendingRevenueLink(supabase, companyId),
      ]);
      if (cancelled) return;
      setStep1Count(a.error ? 0 : a.rows.length);
      setStep2Count(b.error ? 0 : b.rows.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, pipelineSeq]);

  const countsReady = step1Count !== null && step2Count !== null;
  const bothEmpty =
    countsReady && step1Count === 0 && step2Count === 0;

  if (!countsReady) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando fichas pendentes…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {bothEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 px-6 py-16 text-center text-sm text-muted-foreground">
          <Inbox className="h-10 w-10 opacity-40" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">Nada pendente</p>
            <p>
              Não há fichas técnicas nem vendas históricas aguardando revisão.
            </p>
          </div>
        </div>
      ) : (
        <>
          <FichasPendentesStep1
            companyId={companyId}
            refreshSignal={pipelineSeq}
            onPipelineChange={bumpPipeline}
          />
          <FichasPendentesStep2
            companyId={companyId}
            refreshSignal={pipelineSeq}
            onPipelineChange={bumpPipeline}
          />
        </>
      )}
    </div>
  );
}

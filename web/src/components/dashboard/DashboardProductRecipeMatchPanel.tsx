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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DashboardRecipeMatchIngredientConfig,
  type IngredientLinkConfig,
} from "@/components/dashboard/DashboardRecipeMatchIngredientConfig";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
import { dashboardImportReviewSetResolution } from "@/lib/dashboardImportReview";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import {
  createProductRecipeMatch,
  fetchProductRecipeMatchLists,
  linkProductRecipeMatch,
  RECIPE_MATCH_SUGGESTION_THRESHOLD,
  recipeMatchCreateErrorMessage,
  recipeMatchSuggestionScore,
  undoProductRecipeMatch,
  type ProductRecipeMatchRow,
} from "@/lib/onboardingProductRecipeMatch";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  Check,
  ChefHat,
  ChevronsUpDown,
  EyeOff,
  Loader2,
  Merge,
  Search,
  Sparkles,
  Undo2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

function formatQty(n: number, unit: string): string {
  const q = Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return unit && unit !== "—" ? `${q} ${unit}` : q;
}

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function productSub(row: ProductRecipeMatchRow): string {
  const parts = [`Saldo: ${formatQty(row.current_quantity, row.unit)}`];
  if (row.sku) parts.push(`SKU ${row.sku}`);
  if (row.ean) parts.push(`EAN ${row.ean}`);
  else if (row.barcode) parts.push(`Cód. ${row.barcode}`);
  if (row.recipe_id) parts.push("já tem ficha");
  return parts.join(" · ");
}

function SideCard({
  title,
  sub,
  borderClass,
}: {
  title: string;
  sub: string;
  borderClass?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5",
        borderClass,
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-semibold leading-tight" title={title}>
          {title}
        </p>
        {sub ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EntryPickField({
  selected,
  options,
  scores,
  onSelect,
  onClear,
  disabled,
}: {
  selected: ProductRecipeMatchRow | null;
  options: ProductRecipeMatchRow[];
  scores: Map<string, number>;
  onSelect: (id: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? options
      : options.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.sku ?? "").toLowerCase().includes(q) ||
            (r.ean ?? "").toLowerCase().includes(q) ||
            (r.barcode ?? "").toLowerCase().includes(q),
        );
    return [...base].sort((a, b) => {
      const sa = scores.get(a.product_id) ?? 0;
      const sb = scores.get(b.product_id) ?? 0;
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [options, search, scores]);

  const selectedScore = selected
    ? (scores.get(selected.product_id) ?? 0)
    : 0;
  const selectedSuggested =
    selectedScore >= RECIPE_MATCH_SUGGESTION_THRESHOLD;

  return (
    <div className="flex h-full min-w-0 items-stretch gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-full min-h-[3.25rem] w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
              selected
                ? "border-sky-500/40 bg-sky-500/5 hover:bg-sky-500/10"
                : "border-dashed border-muted-foreground/35 bg-background hover:border-sky-500/40 hover:bg-muted/30",
              disabled && "opacity-60",
            )}
          >
            <div className="min-w-0 flex-1 overflow-hidden">
              {selected ? (
                <>
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight">
                    <span className="truncate">{selected.name}</span>
                    {selectedSuggested ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-900 dark:text-amber-100">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        Sugestão
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {productSub(selected)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Selecionar item comprado…
                </p>
              )}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0"
          align="start"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, SKU ou EAN…"
                className="h-9 pl-8"
                autoFocus
              />
            </div>
          </div>
          <div
            ref={listRef}
            className="max-h-64 overflow-y-auto overscroll-contain p-1"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum item só com entrada disponível.
              </p>
            ) : (
              filtered.map((r) => {
                const score = scores.get(r.product_id) ?? 0;
                const suggested = score >= RECIPE_MATCH_SUGGESTION_THRESHOLD;
                const isSel = selected?.product_id === r.product_id;
                return (
                  <button
                    key={r.product_id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                      isSel && "bg-sky-500/10 ring-1 ring-sky-500/30",
                    )}
                    onClick={() => {
                      onSelect(r.product_id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        isSel
                          ? "border-sky-600 bg-sky-600 text-white"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {isSel ? <Check className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        {suggested ? (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-900 dark:text-amber-100">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            Sugestão
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {productSub(r)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selected ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-auto w-9 shrink-0 self-center text-muted-foreground"
          aria-label="Limpar seleção"
          disabled={disabled}
          onClick={onClear}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

async function fetchProductById(productId: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Product;
}

function buildAutoPairings(
  exitOnly: ProductRecipeMatchRow[],
  entryOnly: ProductRecipeMatchRow[],
): Record<string, string> {
  const used = new Set<string>();
  const next: Record<string, string> = {};
  const ranked = exitOnly
    .map((exit) => {
      let bestId: string | null = null;
      let bestScore = 0;
      for (const entry of entryOnly) {
        const score = recipeMatchSuggestionScore(exit, entry);
        if (score > bestScore) {
          bestScore = score;
          bestId = entry.product_id;
        }
      }
      return { exitId: exit.product_id, bestId, bestScore };
    })
    .filter(
      (r) =>
        r.bestId &&
        r.bestScore >= RECIPE_MATCH_SUGGESTION_THRESHOLD,
    )
    .sort((a, b) => b.bestScore - a.bestScore);

  for (const r of ranked) {
    if (!r.bestId || used.has(r.bestId)) continue;
    used.add(r.bestId);
    next[r.exitId] = r.bestId;
  }
  return next;
}

export function DashboardProductRecipeMatchPanel({
  companyId,
  refreshSignal = 0,
  onLinked,
}: {
  companyId: string;
  refreshSignal?: number;
  onLinked?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exitOnly, setExitOnly] = useState<ProductRecipeMatchRow[]>([]);
  const [entryOnly, setEntryOnly] = useState<ProductRecipeMatchRow[]>([]);
  const [pairings, setPairings] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);
  const [ingredientConfig, setIngredientConfig] =
    useState<IngredientLinkConfig | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<Product | null>(null);
  const [mergePartnerId, setMergePartnerId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [undoConfirmExit, setUndoConfirmExit] =
    useState<ProductRecipeMatchRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchProductRecipeMatchLists(supabase, companyId);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      setExitOnly([]);
      setEntryOnly([]);
      setPairings({});
      return;
    }
    setExitOnly(res.exitOnly);
    setEntryOnly(res.entryOnly);
    setPairings((prev) => {
      const auto = buildAutoPairings(res.exitOnly, res.entryOnly);
      const next: Record<string, string> = {};
      for (const exit of res.exitOnly) {
        const kept = prev[exit.product_id];
        if (
          kept &&
          res.entryOnly.some((e) => e.product_id === kept)
        ) {
          next[exit.product_id] = kept;
        } else if (auto[exit.product_id]) {
          next[exit.product_id] = auto[exit.product_id];
        }
      }
      // Evita dois exits apontando para o mesmo entry
      const used = new Set<string>();
      for (const [exitId, entryId] of Object.entries(next)) {
        if (used.has(entryId)) {
          delete next[exitId];
        } else {
          used.add(entryId);
        }
      }
      return next;
    });
    setExpandedRecipeId((prev) =>
      prev && res.exitOnly.some((r) => r.product_id === prev) ? prev : null,
    );
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const usedEntryIds = useMemo(
    () => new Set(Object.values(pairings)),
    [pairings],
  );

  const filteredExit = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return exitOnly;
    return exitOnly.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q) ||
        (r.ean ?? "").toLowerCase().includes(q),
    );
  }, [exitOnly, filter]);

  const setPair = (exitId: string, entryId: string | null) => {
    setPairings((prev) => {
      const next = { ...prev };
      if (!entryId) {
        delete next[exitId];
        return next;
      }
      for (const [eId, enId] of Object.entries(next)) {
        if (eId !== exitId && enId === entryId) delete next[eId];
      }
      next[exitId] = entryId;
      return next;
    });
  };

  const runDismiss = async (exit: ProductRecipeMatchRow) => {
    setBusyKey(`dismiss:${exit.product_id}`);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId: exit.product_id,
      bucket: "EXIT_NO_ENTRY",
      resolution: "DISMISSED",
    });
    setBusyKey(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível dispensar.");
      return;
    }
    toast.success(`«${exit.name}» dispensado desta revisão.`);
    if (expandedRecipeId === exit.product_id) setExpandedRecipeId(null);
    void load();
    onLinked?.();
  };

  const runDismissEntry = async (entry: ProductRecipeMatchRow) => {
    setBusyKey(`dismiss-entry:${entry.product_id}`);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId: entry.product_id,
      bucket: "ENTRY_NO_EXIT",
      resolution: "DISMISSED",
    });
    setBusyKey(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível dispensar.");
      return;
    }
    toast.success(`«${entry.name}» dispensado desta revisão.`);
    setPairings((prev) => {
      const next = { ...prev };
      for (const [exitId, entryId] of Object.entries(next)) {
        if (entryId === entry.product_id) delete next[exitId];
      }
      return next;
    });
    void load();
    onLinked?.();
  };

  const openMerge = async (exit: ProductRecipeMatchRow) => {
    const entryId = pairings[exit.product_id];
    if (!entryId) return;
    setBusyKey(`merge:${exit.product_id}`);
    const source = await fetchProductById(exit.product_id);
    setBusyKey(null);
    if (!source) {
      toast.error("Não foi possível carregar o produto para unificar.");
      return;
    }
    setMergeSource(source);
    setMergePartnerId(entryId);
    setMergeOpen(true);
  };

  const runRecipeAction = async (exit: ProductRecipeMatchRow) => {
    const entryId = pairings[exit.product_id];
    const entry = entryOnly.find((r) => r.product_id === entryId);
    if (!entry || !ingredientConfig?.isValid) return;

    setBusyKey(`recipe:${exit.product_id}`);
    if (exit.recipe_id) {
      const res = await linkProductRecipeMatch(supabase, {
        companyId,
        outputProductId: exit.product_id,
        ingredientProductId: entry.product_id,
        inputQuantity: ingredientConfig.inputQuantity,
        inputUnitCode: ingredientConfig.inputUnitCode,
      });
      setBusyKey(null);
      if (!res.ok) {
        toast.error(recipeMatchCreateErrorMessage(res.error));
        return;
      }
      toast.success(
        res.already_linked
          ? `«${entry.name}» já estava na ficha de «${exit.name}».`
          : `Insumo «${entry.name}» ligado à ficha de «${exit.name}».`,
      );
    } else {
      const res = await createProductRecipeMatch(supabase, {
        companyId,
        outputProductId: exit.product_id,
        ingredients: [
          {
            product_id: entry.product_id,
            name: entry.name,
            input_quantity: ingredientConfig.inputQuantity,
            input_unit_code: ingredientConfig.inputUnitCode,
            stock_quantity: ingredientConfig.stockQuantityPreview ?? 0,
          },
        ],
      });
      setBusyKey(null);
      if (!res.ok) {
        toast.error(recipeMatchCreateErrorMessage(res.error));
        return;
      }
      toast.success(
        `Ficha técnica criada para «${exit.name}» com o insumo «${entry.name}».`,
      );
    }
    setExpandedRecipeId(null);
    setIngredientConfig(null);
    void load();
    onLinked?.();
  };

  const runUndoRecipe = async (exit: ProductRecipeMatchRow) => {
    if (!exit.recipe_id) return;
    setBusyKey(`undo:${exit.product_id}`);
    const res = await undoProductRecipeMatch(
      supabase,
      companyId,
      exit.recipe_id,
    );
    setBusyKey(null);
    setUndoConfirmExit(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível desfazer a ficha.");
      return;
    }
    toast.success(
      `Ficha de «${exit.name}» desfeita. O produto voltou ao estoque normal.`,
    );
    if (expandedRecipeId === exit.product_id) {
      setExpandedRecipeId(null);
      setIngredientConfig(null);
    }
    void load();
    onLinked?.();
  };

  if (!loading && !error && exitOnly.length === 0 && entryOnly.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-amber-500/25 bg-gradient-to-br from-card via-card to-amber-500/[0.06]">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-900 dark:text-amber-200">
                <UtensilsCrossed className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg leading-snug">
                  Correlacionar vendidos e comprados
                </CardTitle>
                <CardDescription className="text-pretty">
                  Cada venda (só saída) pode ser pareada com um item comprado (só
                  entrada): unifique o mesmo produto, monte ficha técnica ou
                  dispense.
                </CardDescription>
              </div>
            </div>
            {!loading ? (
              <div
                className="flex shrink-0 gap-2 text-sm tabular-nums"
                aria-live="polite"
              >
                <span className="rounded-full border border-violet-500/35 bg-violet-500/10 px-2.5 py-0.5 font-medium text-violet-950 dark:text-violet-100">
                  {exitOnly.length} só saída
                </span>
                <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-0.5 font-medium text-sky-950 dark:text-sky-100">
                  {entryOnly.length} só entrada
                </span>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analisando movimentações de estoque…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : exitOnly.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto só com saída. Itens só com entrada podem ser
              dispensados abaixo, se não fizerem sentido para estoque/CMV.
            </p>
          ) : (
            <>
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar vendas…"
                  className="h-9 pl-8"
                />
              </div>

              <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                <div>Vendido (só saída)</div>
                <div className="w-9" />
                <div>Comprado (só entrada)</div>
                <div className="min-w-[11rem] text-right">Ação</div>
              </div>

              <ul className="space-y-2">
                {filteredExit.map((exit) => {
                  const entryId = pairings[exit.product_id] ?? null;
                  const entry =
                    entryOnly.find((r) => r.product_id === entryId) ?? null;
                  const scores = new Map(
                    entryOnly.map((e) => [
                      e.product_id,
                      recipeMatchSuggestionScore(exit, e),
                    ]),
                  );
                  const options = entryOnly.filter(
                    (e) =>
                      e.product_id === entryId ||
                      !usedEntryIds.has(e.product_id),
                  );
                  const hasPair = !!entry;
                  const score = entry
                    ? (scores.get(entry.product_id) ?? 0)
                    : 0;
                  const isStrong =
                    hasPair && score >= RECIPE_MATCH_SUGGESTION_THRESHOLD;
                  const recipeOpen = expandedRecipeId === exit.product_id;
                  const rowBusy = busyKey?.endsWith(`:${exit.product_id}`);

                  return (
                    <li key={exit.product_id} className="space-y-2">
                      <div
                        className={cn(
                          "grid items-stretch gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]",
                          isStrong && "border-emerald-500/40 bg-emerald-500/5",
                          hasPair &&
                            !isStrong &&
                            "border-amber-500/35 bg-amber-500/5",
                        )}
                      >
                        <SideCard
                          title={exit.name}
                          sub={productSub(exit)}
                          borderClass="border-violet-500/25"
                        />
                        <div
                          className={cn(
                            "mx-auto flex h-9 w-9 shrink-0 self-center items-center justify-center rounded-full text-sm font-bold",
                            isStrong
                              ? "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30"
                              : hasPair
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-muted text-muted-foreground",
                          )}
                          aria-hidden
                        >
                          {hasPair ? (isStrong ? "=" : "≈") : "?"}
                        </div>
                        <EntryPickField
                          selected={entry}
                          options={options}
                          scores={scores}
                          disabled={!!rowBusy}
                          onSelect={(id) => setPair(exit.product_id, id)}
                          onClear={() => {
                            setPair(exit.product_id, null);
                            if (expandedRecipeId === exit.product_id) {
                              setExpandedRecipeId(null);
                              setIngredientConfig(null);
                            }
                          }}
                        />
                        <div className="flex flex-wrap items-center justify-end gap-1.5 self-center sm:min-w-[11rem]">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!hasPair || !!rowBusy}
                            onClick={() => void openMerge(exit)}
                            title="Mesmo produto — unificar cadastros"
                          >
                            {busyKey === `merge:${exit.product_id}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Merge className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1.5">Unificar</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={recipeOpen ? "default" : "outline"}
                            disabled={!hasPair || !!rowBusy}
                            onClick={() => {
                              setExpandedRecipeId((prev) =>
                                prev === exit.product_id
                                  ? null
                                  : exit.product_id,
                              );
                              setIngredientConfig(null);
                            }}
                            title="É ficha técnica — ligar/criar com este insumo"
                          >
                            <ChefHat className="h-3.5 w-3.5" />
                            <span className="ml-1.5">Ficha</span>
                          </Button>
                          {exit.recipe_id ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-destructive border-destructive/30 hover:bg-destructive/10"
                              disabled={!!rowBusy}
                              onClick={() => setUndoConfirmExit(exit)}
                              title="Desfazer ficha técnica"
                            >
                              {busyKey === `undo:${exit.product_id}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Undo2 className="h-3.5 w-3.5" />
                              )}
                              <span className="ml-1.5">Desfazer</span>
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground"
                            disabled={!!rowBusy}
                            onClick={() => void runDismiss(exit)}
                            title="Dispensar (serviço / sem par)"
                          >
                            {busyKey === `dismiss:${exit.product_id}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {recipeOpen && entry ? (
                        <div className="rounded-xl border border-border/80 bg-background/80 p-4 sm:ml-0">
                          <DashboardRecipeMatchIngredientConfig
                            key={`${exit.product_id}:${entry.product_id}`}
                            companyId={companyId}
                            ingredient={entry}
                            onChange={setIngredientConfig}
                          />
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              disabled={
                                !ingredientConfig?.isValid ||
                                busyKey === `recipe:${exit.product_id}`
                              }
                              onClick={() => void runRecipeAction(exit)}
                            >
                              {busyKey === `recipe:${exit.product_id}` ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Salvando…
                                </>
                              ) : exit.recipe_id ? (
                                <>
                                  <ChefHat className="mr-2 h-4 w-4" />
                                  Adicionar à ficha
                                </>
                              ) : (
                                <>
                                  <ChefHat className="mr-2 h-4 w-4" />
                                  Criar ficha técnica
                                </>
                              )}
                            </Button>
                            <p className="self-center text-xs text-muted-foreground">
                              {exit.recipe_id
                                ? "O insumo entra na ficha já ligada a esta venda."
                                : "A ficha nova fica ligada ao output de venda EPOC."}
                              {ingredientConfig?.stockQuantityPreview != null
                                ? ` · ${ingredientConfig.stockQuantityPreview.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${systemUnitLabel(entry.unit)} / porção`
                                : null}
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {entryOnly.some((e) => !usedEntryIds.has(e.product_id)) ? (
                <div className="rounded-xl border border-dashed border-border/80 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Compras sem par na lista
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {entryOnly
                      .filter((e) => !usedEntryIds.has(e.product_id))
                      .slice(0, 40)
                      .map((e) => (
                        <li key={e.product_id}>
                          <div className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 py-1 pl-2.5 pr-1 text-xs">
                            <span className="max-w-[14rem] truncate font-medium">
                              {e.name}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground"
                              title="Dispensar compra"
                              disabled={
                                busyKey === `dismiss-entry:${e.product_id}`
                              }
                              onClick={() => void runDismissEntry(e)}
                            >
                              {busyKey === `dismiss-entry:${e.product_id}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <EyeOff className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {mergeSource ? (
        <ProductMergeDialog
          open={mergeOpen}
          onOpenChange={(next) => {
            setMergeOpen(next);
            if (!next) {
              setMergeSource(null);
              setMergePartnerId(null);
            }
          }}
          companyId={companyId}
          sourceProduct={mergeSource}
          formatCurrency={formatCurrency}
          initialPartnerId={mergePartnerId}
          onMerged={() => {
            void load();
            onLinked?.();
          }}
        />
      ) : null}

      <AlertDialog
        open={!!undoConfirmExit}
        onOpenChange={(open) => {
          if (!open) setUndoConfirmExit(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer ficha técnica?</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              Isso remove a ficha
              {undoConfirmExit ? ` de «${undoConfirmExit.name}»` : ""} e os
              insumos ligados. O produto volta ao estoque normal e ambos
              reaparecem na lista para unificar ou refazer o pareamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              disabled={
                !!undoConfirmExit &&
                busyKey === `undo:${undoConfirmExit.product_id}`
              }
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                !undoConfirmExit ||
                busyKey === `undo:${undoConfirmExit.product_id}`
              }
              onClick={(e) => {
                e.preventDefault();
                if (undoConfirmExit) void runUndoRecipe(undoConfirmExit);
              }}
            >
              {undoConfirmExit &&
              busyKey === `undo:${undoConfirmExit.product_id}` ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Desfazendo…
                </>
              ) : (
                "Desfazer ficha"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
import { ProductSetupInbox } from "@/components/products/ProductSetupInbox";
import {
  RecipeRow,
  SameItemRow,
  ValidationMatchListHeader,
} from "@/components/products/ProductValidationCards";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  dashboardImportReviewFinalizeRecipeProductSales,
  dashboardImportReviewMarkTechSheetSaved,
} from "@/lib/dashboardImportReview";
import {
  addPurchaseAsRecipeIngredient,
  createProductRecipeMatch,
} from "@/lib/onboardingProductRecipeMatch";
import {
  fetchProductSetupQueue,
  maxTurnoverQty,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import {
  filterValidationToQueue,
  invokeCorrelateSoldPurchased,
} from "@/lib/productValidation/invokeCorrelateSoldPurchased";
import type {
  ProductValidationResult,
  RecipeSuggestion,
  SameItemSuggestion,
} from "@/lib/productValidation/types";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

async function fetchProductById(productId: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Product;
}

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fallbackUnit(unit: string): string {
  return unit && unit !== "—" ? unit : "un";
}

export function ProductValidationFlow({ companyId }: { companyId: string }) {
  const [queue, setQueue] = useState<ProductSetupQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProductValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [samePick, setSamePick] = useState<Record<string, string>>({});
  const [soldPick, setSoldPick] = useState<Record<string, string>>({});
  const [recipePicks, setRecipePicks] = useState<Record<string, string[]>>({});
  const [mergeProduct, setMergeProduct] = useState<Product | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePartnerId, setMergePartnerId] = useState<string | null>(null);
  const [recipeSheetId, setRecipeSheetId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const next = await fetchProductSetupQueue(supabase, companyId);
    setQueue(next);
    setLoading(false);
    return next;
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    setResult(null);
    void loadQueue();
  }, [loadQueue]);

  const startValidation = async () => {
    setRunning(true);
    const next = await loadQueue();
    const correlated = await invokeCorrelateSoldPurchased({
      companyId,
      items: next.items,
    });
    setRunning(false);
    if (!correlated.ok) {
      toast.error(correlated.error);
      return;
    }
    const interpreted = correlated.result;
    const picks: Record<string, string> = {};
    const soldPicks: Record<string, string> = {};
    const recipePicksInit: Record<string, string[]> = {};
    for (const row of interpreted.sameItem) {
      if (row.band !== "high") continue;
      const first = row.candidates[0]?.purchase.productId;
      if (first) picks[row.id] = first;
      soldPicks[row.id] = row.sold.productId;
    }
    for (const row of interpreted.recipes) {
      if (row.band !== "high") continue;
      recipePicksInit[row.id] = row.ingredients.map(
        (ingredient) => ingredient.purchase.productId,
      );
    }
    setSamePick(picks);
    setSoldPick(soldPicks);
    setRecipePicks(recipePicksInit);
    setResult(interpreted);
  };

  const reloadAfterConfirm = async () => {
    const next = await loadQueue();
    setResult((current) => {
      if (!current) return current;
      return filterValidationToQueue(current, next.items);
    });
  };

  const confirmSameItem = async (suggestionId: string) => {
    const suggestion = result?.sameItem.find((row) => row.id === suggestionId);
    const partnerId = samePick[suggestionId];
    const soldId = soldPick[suggestionId] ?? suggestion?.sold.productId;
    if (!suggestion || !partnerId || !soldId) return;
    setBusy(true);
    const product = await fetchProductById(soldId);
    setBusy(false);
    if (!product) {
      toast.error("Não foi possível carregar o produto do PDV.");
      return;
    }
    setMergeProduct(product);
    setMergePartnerId(partnerId);
    setMergeOpen(true);
  };

  const toggleIngredient = (recipeId: string, purchaseId: string) => {
    setRecipePicks((current) => {
      const prev = new Set(current[recipeId] ?? []);
      if (prev.has(purchaseId)) prev.delete(purchaseId);
      else prev.add(purchaseId);
      return { ...current, [recipeId]: [...prev] };
    });
  };

  const confirmRecipe = async (suggestionId: string) => {
    const suggestion = result?.recipes.find((row) => row.id === suggestionId);
    if (!suggestion) return;
    const selected = new Set(recipePicks[suggestionId] ?? []);
    const ingredients = suggestion.ingredients.filter((row) =>
      selected.has(row.purchase.productId),
    );
    if (ingredients.length === 0) {
      setRecipeSheetId(suggestion.sold.productId);
      return;
    }
    setBusy(true);
    const payload = ingredients.map((row) => ({
      product_id: row.purchase.productId,
      name: row.purchase.name,
      input_quantity: 1,
      input_unit_code: fallbackUnit(row.purchase.unit),
      stock_quantity: row.purchase.quantity,
    }));
    let ok = true;
    let error: string | undefined;
    if (suggestion.sold.recipeId) {
      for (const row of payload) {
        const res = await addPurchaseAsRecipeIngredient(supabase, {
          companyId,
          recipeId: suggestion.sold.recipeId,
          ingredientProductId: row.product_id,
          inputQuantity: row.input_quantity,
          inputUnitCode: row.input_unit_code,
        });
        if (!res.ok) {
          ok = false;
          error = res.error;
          break;
        }
      }
    } else {
      const res = await createProductRecipeMatch(supabase, {
        companyId,
        outputProductId: suggestion.sold.productId,
        ingredients: payload,
      });
      ok = res.ok;
      error = res.error;
    }
    if (ok) {
      await dashboardImportReviewMarkTechSheetSaved(
        supabase,
        companyId,
        suggestion.sold.productId,
      );
      await dashboardImportReviewFinalizeRecipeProductSales(
        supabase,
        companyId,
        suggestion.sold.productId,
      );
    }
    setBusy(false);
    if (!ok) {
      toast.error(error ?? "Não foi possível criar a ficha.");
      return;
    }
    toast.success(
      "Ficha confirmada. Quantidades dos insumos ficam 1 unidade — ajuste na ficha se precisar.",
    );
    await reloadAfterConfirm();
  };

  const recipeSheetItem = useMemo(
    () => result?.recipes.find((row) => row.sold.productId === recipeSheetId),
    [result, recipeSheetId],
  );

  const confirmRows = useMemo(() => {
    if (!result) return [];
    const rows: Array<
      | {
          kind: "same";
          id: string;
          turnover: number;
          suggestion: SameItemSuggestion;
        }
      | {
          kind: "recipe";
          id: string;
          turnover: number;
          suggestion: RecipeSuggestion;
        }
    > = [];
    for (const row of result.sameItem) {
      if (row.band !== "high") continue;
      rows.push({
        kind: "same",
        id: row.id,
        turnover: maxTurnoverQty(
          row.sold,
          ...row.candidates.map((c) => c.purchase),
        ),
        suggestion: row,
      });
    }
    for (const row of result.recipes) {
      if (row.band !== "high") continue;
      rows.push({
        kind: "recipe",
        id: row.id,
        turnover: maxTurnoverQty(
          row.sold,
          ...row.ingredients.map((i) => i.purchase),
        ),
        suggestion: row,
      });
    }
    rows.sort(
      (a, b) => b.turnover - a.turnover || a.id.localeCompare(b.id, "pt-BR"),
    );
    return rows;
  }, [result]);

  const soldItems = useMemo(
    () =>
      (queue?.items ?? []).filter(
        (item) =>
          item.kind === "sold_unlinked" ||
          item.kind === "recipe_without_ingredients",
      ),
    [queue],
  );
  const purchaseItems = useMemo(
    () =>
      (queue?.items ?? []).filter((item) => item.kind === "purchase_unlinked"),
    [queue],
  );

  const residualKeys = useMemo(() => {
    if (!queue || !result) return [];
    const covered = new Set<string>();
    for (const row of confirmRows) {
      if (row.kind === "same") {
        const soldId = soldPick[row.id] ?? row.suggestion.sold.productId;
        const purchaseId = samePick[row.id];
        if (soldId) covered.add(soldId);
        if (purchaseId) covered.add(purchaseId);
      } else {
        covered.add(row.suggestion.sold.productId);
        for (const id of recipePicks[row.id] ?? []) covered.add(id);
      }
    }
    return queue.items
      .filter((item) => !covered.has(item.productId))
      .map((item) => item.key);
  }, [queue, result, confirmRows, soldPick, samePick, recipePicks]);

  if (loading && !queue) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando itens para validar…
      </div>
    );
  }

  if (queue?.error) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os produtos. {queue.error}
      </p>
    );
  }

  const pending = queue?.counts.total ?? 0;

  if (!result && !running) {
    if (pending === 0) {
      return (
        <div className="rounded-xl border border-border/80 bg-card p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold">Cadastro alinhado</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Novos itens da nota ou do PDV aparecem aqui para validar
                vínculos pelo nome.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-800 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {pending.toLocaleString("pt-BR")}{" "}
                {pending === 1 ? "item pendente" : "itens pendentes"} de
                correlação
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                A IA cruza o nome de cada item vendido no PDV com todas as
                compras da nota: o que é o mesmo produto e o que é ficha com
                insumos. Nada é gravado até você confirmar.
              </p>
            </div>
          </div>
          <Button type="button" onClick={() => void startValidation()}>
            Iniciar validação
          </Button>
        </div>
      </div>
    );
  }

  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/80 bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Interpretando todos os vendidos e comprados com IA…
      </div>
    );
  }

  if (!result) return null;

  const hasConfirm = confirmRows.length > 0;
  const hasResidual = residualKeys.length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/80 bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Sugestões para confirmar</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.stats.sameItem} vínculo
              {result.stats.sameItem === 1 ? "" : "s"} compra ↔ venda e{" "}
              {result.stats.recipes} ficha
              {result.stats.recipes === 1 ? "" : "s"} com 90% ou mais. Os demais
              ({result.stats.residual.toLocaleString("pt-BR")}) vão para
              correção, pelos que mais giram. Nada é gravado até você confirmar.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void startValidation()}
          >
            Rodar de novo
          </Button>
        </div>
      </div>

      {!hasConfirm && !hasResidual ? (
        <p className="text-sm text-muted-foreground">
          Nada pendente depois desta leitura.
        </p>
      ) : null}

      {hasConfirm ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Confirmar vínculo (≥ 90%)</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Lista no mesmo formato de Vincular compras. Se a IA errou o
              vendido, troque na lista antes de unificar.
            </p>
          </div>
          <ValidationMatchListHeader />
          <ul className="space-y-2">
            {confirmRows.map((row) => {
              if (row.kind === "recipe") {
                return (
                  <RecipeRow
                    key={row.id}
                    suggestion={row.suggestion}
                    selectedIngredientIds={new Set(recipePicks[row.id] ?? [])}
                    onToggleIngredient={(id) => toggleIngredient(row.id, id)}
                    onConfirmRecipe={() => void confirmRecipe(row.id)}
                    onOpenSheet={() =>
                      setRecipeSheetId(row.suggestion.sold.productId)
                    }
                    busy={busy}
                  />
                );
              }
              const currentSoldId =
                soldPick[row.id] ?? row.suggestion.sold.productId;
              const currentPurchaseId = samePick[row.id] ?? "";
              const takenSolds = new Set<string>();
              const takenPurchases = new Set<string>();
              for (const other of confirmRows) {
                if (other.kind === "same" && other.id !== row.id) {
                  takenSolds.add(
                    soldPick[other.id] ?? other.suggestion.sold.productId,
                  );
                  const purchaseId = samePick[other.id];
                  if (purchaseId) takenPurchases.add(purchaseId);
                }
                if (other.kind === "recipe") {
                  takenSolds.add(other.suggestion.sold.productId);
                  for (const id of recipePicks[other.id] ?? []) {
                    takenPurchases.add(id);
                  }
                }
              }
              return (
                <SameItemRow
                  key={row.id}
                  suggestion={row.suggestion}
                  selectedPurchaseId={currentPurchaseId}
                  onSelectPurchase={(id) =>
                    setSamePick((current) => ({ ...current, [row.id]: id }))
                  }
                  selectedSoldId={currentSoldId}
                  onSelectSold={(id) =>
                    setSoldPick((current) => ({ ...current, [row.id]: id }))
                  }
                  purchaseChoices={purchaseItems.filter(
                    (item) =>
                      item.productId === currentPurchaseId ||
                      !takenPurchases.has(item.productId),
                  )}
                  soldChoices={soldItems.filter(
                    (item) =>
                      item.productId === currentSoldId ||
                      !takenSolds.has(item.productId),
                  )}
                  onConfirm={() => void confirmSameItem(row.id)}
                  busy={busy}
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      {hasResidual && queue ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Para corrigir</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Abaixo de 90% ou sem par. Ordenado pelo maior volume de venda ou
              compra.
            </p>
          </div>
          <ProductSetupInbox
            companyId={companyId}
            queue={queue}
            onlyKeys={residualKeys}
            compact
            onResolved={() => void reloadAfterConfirm()}
          />
        </section>
      ) : null}

      {mergeProduct ? (
        <ProductMergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          companyId={companyId}
          sourceProduct={mergeProduct}
          formatCurrency={formatCurrency}
          initialPartnerId={mergePartnerId}
          initialSurvivorIsSource
          onMerged={() => {
            setMergeOpen(false);
            void reloadAfterConfirm();
          }}
        />
      ) : null}

      <Sheet
        open={Boolean(recipeSheetItem)}
        onOpenChange={(open) => {
          if (!open) setRecipeSheetId(null);
        }}
      >
        <SheetContent className="flex flex-col gap-0 p-0">
          <SheetHeader>
            <SheetTitle>
              {recipeSheetItem
                ? `Ficha: ${recipeSheetItem.sold.name}`
                : "Ficha técnica"}
            </SheetTitle>
          </SheetHeader>
          {recipeSheetItem ? (
            <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
              <EstoqueReceitasPanel
                key={recipeSheetItem.sold.productId}
                companyId={companyId}
                sheetOnly
                embedInline
                ingredientsOnly
                initialOpenRecipeId={recipeSheetItem.sold.recipeId}
                prefillNewRecipeOutputProductId={
                  recipeSheetItem.sold.recipeId
                    ? null
                    : recipeSheetItem.sold.productId
                }
                prefillNewRecipeAutoOpen={false}
                technicalSheetOutputProductId={recipeSheetItem.sold.productId}
                contextOutputProductId={recipeSheetItem.sold.productId}
                onTechnicalSheetSaved={() => {
                  void (async () => {
                    await dashboardImportReviewMarkTechSheetSaved(
                      supabase,
                      companyId,
                      recipeSheetItem.sold.productId,
                    );
                    await dashboardImportReviewFinalizeRecipeProductSales(
                      supabase,
                      companyId,
                      recipeSheetItem.sold.productId,
                    );
                    setRecipeSheetId(null);
                    await reloadAfterConfirm();
                  })();
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

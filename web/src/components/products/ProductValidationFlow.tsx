import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { ProductCorrelationKpis } from "@/components/products/ProductCorrelationKpis";
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
import { useCompany } from "@/contexts/CompanyContext";
import {
  correlationFiscalStepStatus,
  correlationOnboardingCanStart,
  correlationPdvStepStatus,
  type CorrelationOnboardingStepStatus,
} from "@/lib/correlationOnboardingPrereqs";
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
import { filterValidationToQueue } from "@/lib/productValidation/invokeCorrelateSoldPurchased";
import {
  patchProductValidationSession,
  samePickIds,
  startProductValidationSession,
  useProductValidationSession,
} from "@/lib/productValidation/session";
import type {
  RecipeSuggestion,
  SameItemSuggestion,
} from "@/lib/productValidation/types";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
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

function PrerequisiteStatusIcon({
  status,
}: {
  status: CorrelationOnboardingStepStatus;
}) {
  if (status === "success") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
  }
  if (status === "processing") {
    return (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
    );
  }
  if (status === "alert") {
    return (
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
    );
  }
  if (status === "error") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function PrerequisiteRow({
  status,
  label,
}: {
  status: CorrelationOnboardingStepStatus;
  label: string;
}) {
  const done = status === "success";
  return (
    <li className="flex items-center gap-2">
      <PrerequisiteStatusIcon status={status} />
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </li>
  );
}

function correlationGateHeaderIcon(
  fiscal: CorrelationOnboardingStepStatus,
  pdv: CorrelationOnboardingStepStatus,
) {
  const worst: CorrelationOnboardingStepStatus[] = [fiscal, pdv];
  if (worst.includes("error")) {
    return <AlertCircle className="h-8 w-8 text-destructive" />;
  }
  if (worst.includes("alert")) {
    return (
      <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
    );
  }
  if (worst.includes("processing")) {
    return <Loader2 className="h-8 w-8 animate-spin text-violet-600" />;
  }
  return <Sparkles className="h-8 w-8 text-muted-foreground" />;
}

function CorrelationIdleCard({
  tone,
  icon,
  title,
  description,
  children,
}: {
  tone: "amber" | "muted" | "ok";
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-xl rounded-xl border px-6 py-10",
        tone === "amber" && "border-amber-500/35 bg-amber-500/[0.07]",
        tone === "muted" && "border-border/80 bg-card",
        tone === "ok" && "border-border/80 bg-card",
      )}
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="mb-3">{icon}</div>
        <p className="text-base font-semibold">{title}</p>
        <p
          className="mt-2 text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: description }}
        />
        {children}
      </div>
    </div>
  );
}

export function ProductValidationFlow({ companyId }: { companyId: string }) {
  const { currentCompany, refetchCompanies } = useCompany();
  const { running, result, samePick, soldPick, recipePicks } =
    useProductValidationSession(companyId);
  const [queue, setQueue] = useState<ProductSetupQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mergeProduct, setMergeProduct] = useState<Product | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePartnerId, setMergePartnerId] = useState<string | null>(null);
  const mergePartnerQueueRef = useRef<string[]>([]);
  const continuingMergeRef = useRef(false);
  const [recipeSheetId, setRecipeSheetId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    const next = await fetchProductSetupQueue(supabase, companyId);
    setQueue(next);
    setLoading(false);
    return next;
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    void loadQueue();
  }, [loadQueue]);

  const startValidation = async () => {
    if (
      !correlationOnboardingCanStart(
        currentCompany?.onboarding_fiscal,
        currentCompany?.onboarding_pdv,
      )
    ) {
      toast.error(
        "Finalize o onboarding fiscal e o do PDV para iniciar a correlação.",
      );
      return;
    }
    const outcome = await startProductValidationSession({
      companyId,
      loadQueue,
    });
    if (!outcome.ok) {
      toast.error(outcome.error);
    }
  };

  const reloadAfterConfirm = async () => {
    const next = await loadQueue();
    patchProductValidationSession(companyId, (current) => ({
      result: current.result
        ? filterValidationToQueue(current.result, next.items)
        : current.result,
    }));
  };

  const confirmSameItem = async (suggestionId: string) => {
    const suggestion = result?.sameItem.find((row) => row.id === suggestionId);
    if (!suggestion) return;
    const partnerIds = samePickIds(samePick, suggestionId);
    const soldId = soldPick[suggestionId] ?? suggestion.sold.productId;
    if (partnerIds.length === 0 || !soldId) return;
    setBusy(true);
    const product = await fetchProductById(soldId);
    setBusy(false);
    if (!product) {
      toast.error("Não foi possível carregar o produto do PDV.");
      return;
    }
    setMergeProduct(product);
    mergePartnerQueueRef.current = partnerIds;
    setMergePartnerId(partnerIds[0] ?? null);
    setMergeOpen(true);
  };

  const addSamePurchase = (suggestionId: string, purchaseId: string) => {
    if (!purchaseId) return;
    patchProductValidationSession(companyId, (current) => {
      const prev = samePickIds(current.samePick, suggestionId);
      if (prev.includes(purchaseId)) return {};
      return {
        samePick: { ...current.samePick, [suggestionId]: [...prev, purchaseId] },
      };
    });
  };

  const removeSamePurchase = (suggestionId: string, purchaseId: string) => {
    patchProductValidationSession(companyId, (current) => ({
      samePick: {
        ...current.samePick,
        [suggestionId]: samePickIds(current.samePick, suggestionId).filter(
          (id) => id !== purchaseId,
        ),
      },
    }));
  };

  const toggleIngredient = (recipeId: string, purchaseId: string) => {
    patchProductValidationSession(companyId, (current) => {
      const prev = new Set(current.recipePicks[recipeId] ?? []);
      if (prev.has(purchaseId)) prev.delete(purchaseId);
      else prev.add(purchaseId);
      return { recipePicks: { ...current.recipePicks, [recipeId]: [...prev] } };
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
        if (soldId) covered.add(soldId);
        for (const purchaseId of samePickIds(samePick, row.id)) {
          covered.add(purchaseId);
        }
      } else {
        covered.add(row.suggestion.sold.productId);
        for (const id of recipePicks[row.id] ?? []) covered.add(id);
      }
    }
    return queue.items
      .filter((item) => !covered.has(item.productId))
      .map((item) => item.key);
  }, [queue, result, confirmRows, soldPick, samePick, recipePicks]);

  const fiscalStatus = correlationFiscalStepStatus(
    currentCompany?.onboarding_fiscal,
  );
  const pdvStatus = correlationPdvStepStatus(currentCompany?.onboarding_pdv);
  const canStart = correlationOnboardingCanStart(
    currentCompany?.onboarding_fiscal,
    currentCompany?.onboarding_pdv,
  );

  useEffect(() => {
    if (canStart) return;
    const poll = window.setInterval(() => {
      void refetchCompanies();
    }, 8_000);
    return () => window.clearInterval(poll);
  }, [canStart, refetchCompanies]);

  const pending = queue?.counts.total ?? 0;
  const showKpis = Boolean(canStart && queue && !queue.error);
  const wrap = (node: ReactNode) => (
    <div className="space-y-6">
      {showKpis && queue ? (
        <ProductCorrelationKpis counts={queue.counts} />
      ) : null}
      {node}
    </div>
  );

  if (loading && !queue && !result && !running) {
    return (
      <CorrelationIdleCard
        tone="muted"
        icon={
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        }
        title="Carregando itens"
        description="Buscando produtos da nota e do PDV para a correlação."
      />
    );
  }

  if (queue?.error && !result && !running) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os produtos. {queue.error}
      </p>
    );
  }

  if (!result && !running) {
    if (!canStart) {
      return (
        <CorrelationIdleCard
          tone={
            fiscalStatus === "error" || pdvStatus === "error"
              ? "amber"
              : "muted"
          }
          icon={correlationGateHeaderIcon(fiscalStatus, pdvStatus)}
          title="Correlação ainda não disponível"
          description="Essa etapa cruza produtos da nota fiscal com os vendidos no PDV. Libera quando o onboarding fiscal e o do PDV estiverem concluídos."
        >
          <ul className="mt-5 w-full space-y-2 text-left text-sm">
            <PrerequisiteRow
              status={fiscalStatus}
              label="Onboarding fiscal concluído"
            />
            <PrerequisiteRow
              status={pdvStatus}
              label="Onboarding do PDV concluído"
            />
          </ul>
          <Button variant="outline" className="mt-6" asChild>
            <Link to="/app">Ir ao dashboard</Link>
          </Button>
        </CorrelationIdleCard>
      );
    }

    if (pending === 0) {
      return wrap(
        <CorrelationIdleCard
          tone="ok"
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-600" />}
          title="Cadastro alinhado"
          description="Novos itens da nota ou do PDV aparecem aqui para correlacionar comprados e vendidos."
        />,
      );
    }

    return wrap(
      <CorrelationIdleCard
        tone="amber"
        icon={
          <Sparkles className="h-8 w-8 text-amber-800 dark:text-amber-400" />
        }
        title={`${pending.toLocaleString("pt-BR")} ${
          pending === 1 ? "item pendente" : "itens pendentes"
        } de correlação`}
        description="Nosso agente cruza os dados do PDV com os produtos das notas fiscais para correlacionar itens comprados e vendidos e atualizar corretamente o estoque e as movimentações. Nada é gravado até você confirmar."
      >
        <Button
          type="button"
          className="mt-6"
          onClick={() => void startValidation()}
        >
          Iniciar validação
        </Button>
      </CorrelationIdleCard>,
    );
  }

  if (running) {
    return wrap(
      <CorrelationIdleCard
        tone="muted"
        icon={
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        }
        title="Interpretando vendidos e comprados"
        description="Nosso agente está cruzando os dados do PDV com os produtos das notas fiscais para correlacionar itens comprados e vendidos. Isso pode levar um instante."
      />,
    );
  }

  if (!result) return null;

  const hasConfirm = confirmRows.length > 0;
  const hasResidual = residualKeys.length > 0;

  return wrap(
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
              À esquerda o item do PDV; à direita as compras da nota. O mesmo
              vendido pode ter mais de um cadastro (fornecedores ou EAN
              diferentes). Adicione outros se faltar — nada é gravado até
              unificar.
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
              const currentPurchaseIds = samePickIds(samePick, row.id);
              const takenSolds = new Set<string>();
              const takenPurchases = new Set<string>();
              for (const other of confirmRows) {
                if (other.kind === "same" && other.id !== row.id) {
                  takenSolds.add(
                    soldPick[other.id] ?? other.suggestion.sold.productId,
                  );
                  for (const purchaseId of samePickIds(samePick, other.id)) {
                    takenPurchases.add(purchaseId);
                  }
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
                  selectedPurchaseIds={currentPurchaseIds}
                  onAddPurchase={(id) => addSamePurchase(row.id, id)}
                  onRemovePurchase={(id) => removeSamePurchase(row.id, id)}
                  selectedSoldId={currentSoldId}
                  onSelectSold={(id) =>
                    patchProductValidationSession(companyId, (current) => ({
                      soldPick: { ...current.soldPick, [row.id]: id },
                    }))
                  }
                  purchaseChoices={[
                    ...row.suggestion.candidates.map(
                      (candidate) => candidate.purchase,
                    ),
                    ...purchaseItems,
                  ].filter(
                    (item, index, list) =>
                      list.findIndex((other) => other.productId === item.productId) ===
                        index &&
                      (currentPurchaseIds.includes(item.productId) ||
                        !takenPurchases.has(item.productId)),
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
              Abaixo de 90% ou sem par. Filtre e diga o que é: produto, ficha,
              intermediário, agrupamento ou unificar.
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
          onOpenChange={(open) => {
            setMergeOpen(open);
            if (!open && !continuingMergeRef.current) {
              mergePartnerQueueRef.current = [];
            }
          }}
          companyId={companyId}
          sourceProduct={mergeProduct}
          formatCurrency={formatCurrency}
          initialPartnerId={mergePartnerId}
          initialSurvivorIsSource
          onMerged={() => {
            const remaining = mergePartnerQueueRef.current.slice(1);
            mergePartnerQueueRef.current = remaining;
            if (remaining[0]) {
              continuingMergeRef.current = true;
              setMergePartnerId(remaining[0]);
              setMergeOpen(false);
              window.setTimeout(() => {
                continuingMergeRef.current = false;
                setMergeOpen(true);
              }, 0);
              return;
            }
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
    </div>,
  );
}

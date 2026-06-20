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
  DashboardRecipeMatchIngredientConfig,
  type IngredientLinkConfig,
} from "@/components/dashboard/DashboardRecipeMatchIngredientConfig";
import {
  createProductRecipeMatch,
  fetchProductRecipeMatchLists,
  recipeMatchCreateErrorMessage,
  type ProductRecipeMatchRow,
  type RecipeMatchDraftIngredient,
} from "@/lib/onboardingProductRecipeMatch";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChefHat,
  Loader2,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function formatQty(n: number, unit: string): string {
  const q = Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return unit && unit !== "—" ? `${q} ${unit}` : q;
}

type ProductPickProps = {
  rows: ProductRecipeMatchRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  emptyLabel: string;
  variant: "exit" | "entry";
};

function ProductPickList({
  rows,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  emptyLabel,
  variant,
}: ProductPickProps) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const accent =
    variant === "exit"
      ? "border-violet-500/50 bg-violet-500/10 ring-violet-500/30"
      : "border-sky-500/50 bg-sky-500/10 ring-sky-500/30";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por nome…"
          className="h-9 pl-8"
          aria-label="Buscar produto"
        />
      </div>
      <ul className="max-h-[min(22rem,50vh)] min-h-[8rem] flex-1 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-1.5">
        {filtered.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </li>
        ) : (
          filtered.map((r) => {
            const selected = selectedId === r.product_id;
            return (
              <li key={r.product_id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.product_id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-sm transition-colors hover:bg-background/80",
                    selected && cn("ring-1", accent),
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? variant === "exit"
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-sky-600 bg-sky-600 text-white"
                        : "border-muted-foreground/40 bg-background",
                    )}
                    aria-hidden
                  >
                    {selected ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Saldo: {formatQty(r.current_quantity, r.unit)}
                      {r.recipe_id ? " · já tem ficha" : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
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
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const [selectedIngredientId, setSelectedIngredientId] = useState<
    string | null
  >(null);
  const [exitSearch, setExitSearch] = useState("");
  const [entrySearch, setEntrySearch] = useState("");
  const [ingredientConfig, setIngredientConfig] =
    useState<IngredientLinkConfig | null>(null);
  const [pendingIngredients, setPendingIngredients] = useState<
    RecipeMatchDraftIngredient[]
  >([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchProductRecipeMatchLists(supabase, companyId);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      setExitOnly([]);
      setEntryOnly([]);
      return;
    }
    setExitOnly(res.exitOnly);
    setEntryOnly(res.entryOnly);
    setSelectedOutputId((prev) =>
      prev && res.exitOnly.some((r) => r.product_id === prev) ? prev : null,
    );
    setSelectedIngredientId((prev) =>
      prev && res.entryOnly.some((r) => r.product_id === prev) ? prev : null,
    );
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const selectedOutput = exitOnly.find((r) => r.product_id === selectedOutputId);
  const selectedIngredient = entryOnly.find(
    (r) => r.product_id === selectedIngredientId,
  );

  const outputHasRecipe = !!selectedOutput?.recipe_id;

  useEffect(() => {
    setPendingIngredients([]);
    setSelectedIngredientId(null);
    setIngredientConfig(null);
  }, [selectedOutputId]);

  useEffect(() => {
    setIngredientConfig(null);
  }, [selectedIngredientId]);

  const entryRowsForPick = useMemo(
    () =>
      entryOnly.filter(
        (r) =>
          r.product_id !== selectedOutputId &&
          !pendingIngredients.some((p) => p.product_id === r.product_id),
      ),
    [entryOnly, pendingIngredients, selectedOutputId],
  );

  const canAddToList =
    !!selectedOutputId &&
    !outputHasRecipe &&
    !!selectedIngredientId &&
    selectedIngredientId !== selectedOutputId &&
    ingredientConfig?.isValid === true &&
    ingredientConfig.stockQuantityPreview != null;

  const canCreateRecipe =
    !!selectedOutputId &&
    !outputHasRecipe &&
    pendingIngredients.length > 0 &&
    !creating;

  const addToPendingList = () => {
    if (!canAddToList || !selectedIngredient || !ingredientConfig) return;
    const stockQty = ingredientConfig.stockQuantityPreview;
    if (stockQty == null || stockQty <= 0) return;

    setPendingIngredients((prev) => [
      ...prev,
      {
        product_id: selectedIngredient.product_id,
        name: selectedIngredient.name,
        input_quantity: ingredientConfig.inputQuantity,
        input_unit_code: ingredientConfig.inputUnitCode,
        stock_quantity: stockQty,
      },
    ]);
    toast.success(`«${selectedIngredient.name}» adicionado à lista da ficha.`);
    setSelectedIngredientId(null);
    setIngredientConfig(null);
  };

  const removeFromPending = (productId: string) => {
    setPendingIngredients((prev) => prev.filter((p) => p.product_id !== productId));
  };

  const runCreateRecipe = async () => {
    if (!canCreateRecipe || !selectedOutputId) return;
    setCreating(true);
    const res = await createProductRecipeMatch(supabase, {
      companyId,
      outputProductId: selectedOutputId,
      ingredients: pendingIngredients,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error(recipeMatchCreateErrorMessage(res.error));
      return;
    }
    toast.success(
      `Ficha técnica criada para «${selectedOutput?.name ?? "prato"}» com ${res.ingredients_count ?? pendingIngredients.length} insumo(s).`,
    );
    setPendingIngredients([]);
    setSelectedOutputId(null);
    setSelectedIngredientId(null);
    void load();
    onLinked?.();
  };

  if (!loading && !error && exitOnly.length === 0 && entryOnly.length === 0) {
    return null;
  }

  return (
    <Card className="border-amber-500/25 bg-gradient-to-br from-card via-card to-amber-500/[0.06]">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-900 dark:text-amber-200">
              <UtensilsCrossed className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg leading-snug">
                Relacionar fichas técnicas e insumos
              </CardTitle>
              <CardDescription className="text-pretty">
                Escolha o prato (só saída), monte a lista de insumos (só entrada)
                com conversões e quantidades — a ficha técnica só é criada ao
                final, quando você confirmar.
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
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analisando movimentações de estoque…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="flex min-h-0 flex-col gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-violet-900 dark:text-violet-200">
                  <ArrowUpFromLine className="h-4 w-4 shrink-0" aria-hidden />
                  Prato / ficha (só saída)
                </div>
                <ProductPickList
                  rows={exitOnly}
                  selectedId={selectedOutputId}
                  onSelect={setSelectedOutputId}
                  search={exitSearch}
                  onSearchChange={setExitSearch}
                  emptyLabel="Nenhum produto só com saída."
                  variant="exit"
                />
              </section>
              <section className="flex min-h-0 flex-col gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-sky-900 dark:text-sky-200">
                  <ArrowDownToLine className="h-4 w-4 shrink-0" aria-hidden />
                  Insumos (só entrada)
                </div>
                <ProductPickList
                  rows={entryRowsForPick}
                  selectedId={selectedIngredientId}
                  onSelect={setSelectedIngredientId}
                  search={entrySearch}
                  onSearchChange={setEntrySearch}
                  emptyLabel={
                    selectedOutputId
                      ? "Nenhum insumo disponível ou todos já na lista."
                      : "Selecione o prato à esquerda primeiro."
                  }
                  variant="entry"
                />
              </section>
            </div>

            <div className="rounded-xl border border-border/80 bg-background/70 p-4">
              <p className="mb-3 text-sm font-medium">Montar ficha técnica</p>

              {selectedOutput ? (
                <p className="mb-3 text-sm text-muted-foreground">
                  <span className="text-foreground">Prato:</span>{" "}
                  {selectedOutput.name}
                  {outputHasRecipe ? (
                    <span className="ml-2 text-amber-800 dark:text-amber-200">
                      (já possui ficha — escolha outro prato)
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="mb-3 text-sm text-muted-foreground">
                  Selecione o prato na coluna da esquerda para começar.
                </p>
              )}

              {pendingIngredients.length > 0 ? (
                <div className="mb-4 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Insumos na ficha ({pendingIngredients.length})
                  </p>
                  <ul className="space-y-1.5">
                    {pendingIngredients.map((item) => (
                      <li
                        key={item.product_id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{item.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {item.input_quantity.toLocaleString("pt-BR", {
                              maximumFractionDigits: 4,
                            })}{" "}
                            {systemUnitLabel(item.input_unit_code)} / porção
                            {" · "}
                            {item.stock_quantity.toLocaleString("pt-BR", {
                              maximumFractionDigits: 6,
                            })}{" "}
                            estoque
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          aria-label={`Remover ${item.name}`}
                          onClick={() => removeFromPending(item.product_id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : selectedOutputId && !outputHasRecipe ? (
                <p className="mb-4 text-sm text-muted-foreground">
                  Nenhum insumo na lista ainda. Adicione um ou mais insumos
                  antes de criar a ficha.
                </p>
              ) : null}

              {selectedIngredient && selectedOutputId && !outputHasRecipe ? (
                <DashboardRecipeMatchIngredientConfig
                  key={selectedIngredient.product_id}
                  companyId={companyId}
                  ingredient={selectedIngredient}
                  onChange={setIngredientConfig}
                />
              ) : null}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  className="sm:min-w-[11rem]"
                  disabled={!canAddToList}
                  onClick={addToPendingList}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar à lista
                </Button>
                <Button
                  type="button"
                  className="sm:min-w-[11rem]"
                  disabled={!canCreateRecipe}
                  onClick={() => void runCreateRecipe()}
                >
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Criando ficha…
                    </>
                  ) : (
                    <>
                      <ChefHat className="mr-2 h-4 w-4" />
                      Criar ficha técnica
                    </>
                  )}
                </Button>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                A receita no banco só é gravada ao clicar em{" "}
                <strong className="font-medium text-foreground">
                  Criar ficha técnica
                </strong>
                . Antes disso você pode cadastrar conversões, incluir vários
                insumos e revisar a lista.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

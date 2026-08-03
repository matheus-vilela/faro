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
import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { dashboardImportReviewSetResolution } from "@/lib/dashboardImportReview";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import {
  addPurchaseAsRecipeIngredient,
  bestSoldSuggestionForPurchase,
  fetchCompanyRecipesForPick,
  fetchProductRecipeMatchLists,
  RECIPE_MATCH_PURCHASE_PAGE_SIZE,
  RECIPE_MATCH_SOLD_MORE_SIZE,
  RECIPE_MATCH_SOLD_PAGE_SIZE,
  RECIPE_MATCH_SUGGESTION_THRESHOLD,
  recipeMatchSuggestionScore,
  removePurchaseRecipeIngredient,
  type ProductRecipeMatchRow,
  type PurchaseMatchRow,
  type PurchaseUtilization,
  type RecipePickRow,
} from "@/lib/onboardingProductRecipeMatch";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  Check,
  ChefHat,
  ChevronDown,
  ChevronsUpDown,
  EyeOff,
  Loader2,
  Merge,
  Package,
  Plus,
  Search,
  Sparkles,
  Trash2,
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

function productMeta(row: ProductRecipeMatchRow): string {
  const parts = [`Saldo: ${formatQty(row.current_quantity, row.unit)}`];
  if (row.sku) parts.push(`SKU ${row.sku}`);
  if (row.ean) parts.push(`EAN ${row.ean}`);
  else if (row.barcode) parts.push(`Cód. ${row.barcode}`);
  return parts.join(" · ");
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
        "flex min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5",
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

type PendingLinks = {
  soldId: string | null;
  recipeIds: string[];
};

const EMPTY_PENDING: PendingLinks = { soldId: null, recipeIds: [] };

function pendingCount(p: PendingLinks): number {
  return (p.soldId ? 1 : 0) + p.recipeIds.length;
}

function configKey(purchaseId: string, recipeId: string): string {
  return `${purchaseId}:${recipeId}`;
}

type LinkPickTab = "produtos" | "ficha";

function LinkPickPopover({
  soldOptions,
  recipeOptions,
  soldId,
  recipeIds,
  disabled,
  onToggleSold,
  onToggleRecipe,
  onNewRecipe,
  onOpen,
}: {
  soldOptions: ProductRecipeMatchRow[];
  recipeOptions: RecipePickRow[];
  soldId: string | null;
  recipeIds: string[];
  disabled?: boolean;
  onToggleSold: (id: string) => void;
  onToggleRecipe: (id: string) => void;
  onNewRecipe: () => void;
  /** Called when the picker opens (e.g. to collapse ficha panels). */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<LinkPickTab>("produtos");
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const count = (soldId ? 1 : 0) + recipeIds.length;

  const closeAfterSelect = () => {
    setOpen(false);
    setSearch("");
  };

  const filteredSold = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? soldOptions
      : soldOptions.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.sku ?? "").toLowerCase().includes(q) ||
            (r.ean ?? "").toLowerCase().includes(q) ||
            (r.barcode ?? "").toLowerCase().includes(q),
        );
    return base.slice(0, 80);
  }, [soldOptions, search]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? recipeOptions
      : recipeOptions.filter((r) => r.name.toLowerCase().includes(q));
    return base.slice(0, 80);
  }, [recipeOptions, search]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"
        >
          <span className="min-w-0 flex-1 truncate">
            {count > 0 ? (
              <span className="text-muted-foreground">
                Adicionar outro vínculo…
              </span>
            ) : (
              <span className="text-muted-foreground">
                Selecionar vínculos…
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <div className="flex gap-1 border-b p-1.5">
          <Button
            type="button"
            size="sm"
            variant={tab === "produtos" ? "secondary" : "ghost"}
            className="h-8 flex-1"
            onClick={() => {
              setTab("produtos");
              setSearch("");
            }}
          >
            <Package className="mr-1.5 h-3.5 w-3.5" />
            Produtos
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "ficha" ? "secondary" : "ghost"}
            className="h-8 flex-1"
            onClick={() => {
              setTab("ficha");
              setSearch("");
            }}
          >
            <ChefHat className="mr-1.5 h-3.5 w-3.5" />
            Ficha
          </Button>
        </div>

        {tab === "ficha" ? (
          <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Fichas existentes
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={disabled}
              onClick={() => {
                closeAfterSelect();
                onNewRecipe();
              }}
            >
              <Plus className="mr-1 h-3 w-3" />
              Nova ficha
            </Button>
          </div>
        ) : null}

        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "produtos"
                  ? "Buscar por nome, SKU ou EAN…"
                  : "Buscar ficha…"
              }
              className="h-8 pl-8"
            />
          </div>
        </div>

        <div ref={listRef} className="max-h-56 overflow-y-auto p-1">
          {tab === "produtos" ? (
            filteredSold.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nenhum produto encontrado.
              </p>
            ) : (
              filteredSold.map((r) => {
                const isSel = soldId === r.product_id;
                return (
                  <button
                    key={r.product_id}
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                      isSel && "bg-accent",
                    )}
                    onClick={() => {
                      onToggleSold(r.product_id);
                      closeAfterSelect();
                    }}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        isSel ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {r.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {productMeta(r)}
                      </span>
                    </span>
                  </button>
                );
              })
            )
          ) : filteredRecipes.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nenhuma ficha encontrada.
            </p>
          ) : (
            filteredRecipes.map((r) => {
              const isSel = recipeIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                    isSel && "bg-accent",
                  )}
                  onClick={() => {
                    onToggleRecipe(r.id);
                    closeAfterSelect();
                  }}
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      isSel ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.name}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {tab === "produtos" ? (
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            No máximo um produto vendido. Depois use «Adicionar outro vínculo»
            para fichas.
          </p>
        ) : (
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            Cada ficha é adicionada e o seletor fecha. Use «Adicionar outro
            vínculo» para escolher mais.
          </p>
        )}
      </PopoverContent>
    </Popover>
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
  const [loadingMorePurchases, setLoadingMorePurchases] = useState(false);
  const [loadingMoreSold, setLoadingMoreSold] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<PurchaseMatchRow[]>([]);
  const [soldOnly, setSoldOnly] = useState<ProductRecipeMatchRow[]>([]);
  const [purchasesTotal, setPurchasesTotal] = useState(0);
  const [soldTotal, setSoldTotal] = useState(0);
  const [recipes, setRecipes] = useState<RecipePickRow[]>([]);
  const [filter, setFilter] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [pendingByPurchase, setPendingByPurchase] = useState<
    Record<string, PendingLinks>
  >({});
  const [ingredientConfigs, setIngredientConfigs] = useState<
    Record<string, IngredientLinkConfig | null>
  >({});
  /** Painéis de qty da ficha: true/undefined = expandido; false = recolhido */
  const [expandedFichaKeys, setExpandedFichaKeys] = useState<
    Record<string, boolean>
  >({});

  const [mergeSource, setMergeSource] = useState<Product | null>(null);
  const [mergePartnerId, setMergePartnerId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [newRecipePurchaseId, setNewRecipePurchaseId] = useState<string | null>(
    null,
  );

  const [removeUtil, setRemoveUtil] = useState<{
    purchase: PurchaseMatchRow;
    util: PurchaseUtilization;
  } | null>(null);

  const clearPendingFor = useCallback((purchaseId: string) => {
    setPendingByPurchase((prev) => {
      const next = { ...prev };
      delete next[purchaseId];
      return next;
    });
    setIngredientConfigs((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${purchaseId}:`)) delete next[key];
      }
      return next;
    });
    setExpandedFichaKeys((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${purchaseId}:`)) delete next[key];
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [lists, recipeRes] = await Promise.all([
      fetchProductRecipeMatchLists(supabase, companyId, {
        purchaseLimit: RECIPE_MATCH_PURCHASE_PAGE_SIZE,
        purchaseOffset: 0,
        soldLimit: RECIPE_MATCH_SOLD_PAGE_SIZE,
        soldOffset: 0,
      }),
      fetchCompanyRecipesForPick(supabase, companyId),
    ]);
    setLoading(false);
    if (lists.error) {
      setError(lists.error);
      setPurchases([]);
      setSoldOnly([]);
      setPurchasesTotal(0);
      setSoldTotal(0);
      return;
    }
    setPurchases(lists.purchases);
    setSoldOnly(lists.soldOnly);
    setPurchasesTotal(lists.purchasesTotal);
    setSoldTotal(lists.soldTotal);
    if (!recipeRes.error) setRecipes(recipeRes.rows);
    setPendingByPurchase({});
    setIngredientConfigs({});
    setExpandedFichaKeys({});
  }, [companyId]);

  const loadMorePurchases = useCallback(async () => {
    if (loadingMorePurchases || purchases.length >= purchasesTotal) return;
    setLoadingMorePurchases(true);
    const lists = await fetchProductRecipeMatchLists(supabase, companyId, {
      purchaseLimit: RECIPE_MATCH_PURCHASE_PAGE_SIZE,
      purchaseOffset: purchases.length,
      soldLimit: 0,
      soldOffset: 0,
    });
    setLoadingMorePurchases(false);
    if (lists.error) {
      toast.error(lists.error);
      return;
    }
    setPurchases((prev) => {
      const seen = new Set(prev.map((p) => p.product_id));
      const extra = lists.purchases.filter((p) => !seen.has(p.product_id));
      return [...prev, ...extra];
    });
    setPurchasesTotal(lists.purchasesTotal);
  }, [
    companyId,
    loadingMorePurchases,
    purchases.length,
    purchasesTotal,
  ]);

  const loadMoreSold = useCallback(async () => {
    if (loadingMoreSold || soldOnly.length >= soldTotal) return;
    setLoadingMoreSold(true);
    const lists = await fetchProductRecipeMatchLists(supabase, companyId, {
      purchaseLimit: 0,
      purchaseOffset: 0,
      soldLimit: RECIPE_MATCH_SOLD_MORE_SIZE,
      soldOffset: soldOnly.length,
    });
    setLoadingMoreSold(false);
    if (lists.error) {
      toast.error(lists.error);
      return;
    }
    setSoldOnly((prev) => {
      const seen = new Set(prev.map((p) => p.product_id));
      const extra = lists.soldOnly.filter((p) => !seen.has(p.product_id));
      return [...prev, ...extra];
    });
    setSoldTotal(lists.soldTotal);
  }, [companyId, loadingMoreSold, soldOnly.length, soldTotal]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const filteredPurchases = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q) ||
        (r.ean ?? "").toLowerCase().includes(q),
    );
  }, [purchases, filter]);

  const withoutUtilCount = useMemo(
    () => purchases.filter((p) => p.utilizations.length === 0).length,
    [purchases],
  );

  const getPending = (purchaseId: string): PendingLinks =>
    pendingByPurchase[purchaseId] ?? EMPTY_PENDING;

  const setPending = (
    purchaseId: string,
    updater: (prev: PendingLinks) => PendingLinks,
  ) => {
    setPendingByPurchase((prev) => {
      const current = prev[purchaseId] ?? EMPTY_PENDING;
      const nextVal = updater(current);
      if (!nextVal.soldId && nextVal.recipeIds.length === 0) {
        const next = { ...prev };
        delete next[purchaseId];
        return next;
      }
      return { ...prev, [purchaseId]: nextVal };
    });
  };

  const toggleSold = (purchaseId: string, soldProductId: string) => {
    setPending(purchaseId, (prev) => ({
      ...prev,
      soldId: prev.soldId === soldProductId ? null : soldProductId,
    }));
  };

  const toggleRecipe = (purchaseId: string, recipeId: string) => {
    const current = pendingByPurchase[purchaseId] ?? EMPTY_PENDING;
    const removing = current.recipeIds.includes(recipeId);
    setPending(purchaseId, (prev) => {
      const has = prev.recipeIds.includes(recipeId);
      const recipeIds = has
        ? prev.recipeIds.filter((id) => id !== recipeId)
        : [...prev.recipeIds, recipeId];
      return { ...prev, recipeIds };
    });
    const key = configKey(purchaseId, recipeId);
    if (removing) {
      setIngredientConfigs((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setExpandedFichaKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setExpandedFichaKeys((prev) => ({ ...prev, [key]: true }));
    }
  };

  const collapseFichasForPurchase = (purchaseId: string) => {
    const pending = pendingByPurchase[purchaseId] ?? EMPTY_PENDING;
    if (pending.recipeIds.length === 0) return;
    setExpandedFichaKeys((prev) => {
      const next = { ...prev };
      for (const recipeId of pending.recipeIds) {
        next[configKey(purchaseId, recipeId)] = false;
      }
      return next;
    });
  };

  const toggleFichaExpanded = (purchaseId: string, recipeId: string) => {
    const key = configKey(purchaseId, recipeId);
    setExpandedFichaKeys((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  };

  const clearSold = (purchaseId: string) => {
    setPending(purchaseId, (prev) => ({ ...prev, soldId: null }));
  };

  const clearRecipe = (purchaseId: string, recipeId: string) => {
    setPending(purchaseId, (prev) => ({
      ...prev,
      recipeIds: prev.recipeIds.filter((id) => id !== recipeId),
    }));
    const key = configKey(purchaseId, recipeId);
    setIngredientConfigs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setExpandedFichaKeys((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setRecipeIngredientConfig = useCallback(
    (
      purchaseId: string,
      recipeId: string,
      cfg: IngredientLinkConfig | null,
    ) => {
      const key = configKey(purchaseId, recipeId);
      setIngredientConfigs((prev) => {
        const prevCfg = prev[key];
        if (
          prevCfg?.inputQuantity === cfg?.inputQuantity &&
          prevCfg?.inputUnitCode === cfg?.inputUnitCode &&
          prevCfg?.isValid === cfg?.isValid &&
          prevCfg?.stockQuantityPreview === cfg?.stockQuantityPreview
        ) {
          return prev;
        }
        return { ...prev, [key]: cfg };
      });
    },
    [],
  );

  const runDismissPurchase = async (purchase: PurchaseMatchRow) => {
    setBusyKey(`dismiss:${purchase.product_id}`);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId: purchase.product_id,
      bucket: "ENTRY_NO_EXIT",
      resolution: "DISMISSED",
    });
    setBusyKey(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível dispensar.");
      return;
    }
    toast.success(`«${purchase.name}» dispensado desta revisão.`);
    clearPendingFor(purchase.product_id);
    void load();
    onLinked?.();
  };

  const runDismissSold = async (sold: ProductRecipeMatchRow) => {
    setBusyKey(`dismiss-sold:${sold.product_id}`);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId: sold.product_id,
      bucket: "EXIT_NO_ENTRY",
      resolution: "DISMISSED",
    });
    setBusyKey(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível dispensar.");
      return;
    }
    toast.success(`«${sold.name}» dispensado desta revisão.`);
    void load();
    onLinked?.();
  };

  const openMergeWithSold = async (
    purchase: PurchaseMatchRow,
    sold: ProductRecipeMatchRow,
  ) => {
    setBusyKey(`merge:${purchase.product_id}`);
    const source = await fetchProductById(sold.product_id);
    setBusyKey(null);
    if (!source) {
      toast.error("Não foi possível carregar o produto vendido.");
      return;
    }
    setMergeSource(source);
    setMergePartnerId(purchase.product_id);
    setMergeOpen(true);
  };

  const applyLinks = async (purchase: PurchaseMatchRow) => {
    const pending = getPending(purchase.product_id);
    const recipeTargets = pending.recipeIds
      .map((id) => {
        const recipe = recipes.find((r) => r.id === id);
        const cfg = ingredientConfigs[configKey(purchase.product_id, id)];
        return recipe && cfg?.isValid
          ? { recipe, cfg }
          : null;
      })
      .filter(
        (
          x,
        ): x is {
          recipe: RecipePickRow;
          cfg: IngredientLinkConfig;
        } => x != null,
      );

    const sold = pending.soldId
      ? soldOnly.find((s) => s.product_id === pending.soldId) ?? null
      : null;

    if (!sold && recipeTargets.length === 0) {
      toast.error("Selecione um produto vendido ou configure ao menos uma ficha.");
      return;
    }

    if (pending.recipeIds.length > 0 && recipeTargets.length === 0) {
      toast.error("Configure a quantidade de cada ficha antes de aplicar.");
      return;
    }

    setBusyKey(`apply:${purchase.product_id}`);

    const linkedRecipes: { recipeId: string; recipeName: string }[] = [];
    for (const { recipe, cfg } of recipeTargets) {
      const res = await addPurchaseAsRecipeIngredient(supabase, {
        companyId,
        recipeId: recipe.id,
        ingredientProductId: purchase.product_id,
        inputQuantity: cfg.inputQuantity,
        inputUnitCode: cfg.inputUnitCode,
      });
      if (!res.ok) {
        setBusyKey(null);
        toast.error(
          res.error ??
            `Não foi possível ligar à ficha «${recipe.name}».`,
        );
        return;
      }
      if (!res.already_linked) {
        linkedRecipes.push({ recipeId: recipe.id, recipeName: recipe.name });
      }
    }

    clearPendingFor(purchase.product_id);
    setBusyKey(null);

    const showFichaToastWithUndo = (message: string) => {
      if (linkedRecipes.length === 0) {
        toast.success(message);
        return;
      }
      const ingredientProductId = purchase.product_id;
      toast.success(message, {
        duration: 8000,
        action: {
          label: "Desfazer",
          onClick: () => {
            void (async () => {
              let failed = false;
              for (const item of linkedRecipes) {
                const res = await removePurchaseRecipeIngredient(supabase, {
                  companyId,
                  recipeId: item.recipeId,
                  ingredientProductId,
                });
                if (!res.ok) {
                  failed = true;
                  toast.error(
                    res.error ??
                      `Não foi possível desfazer «${item.recipeName}».`,
                  );
                  break;
                }
              }
              if (!failed) {
                toast.success(
                  linkedRecipes.length === 1
                    ? `Vínculo com «${linkedRecipes[0].recipeName}» desfeito.`
                    : `${linkedRecipes.length} vínculos com fichas desfeitos.`,
                );
              }
              void load();
              onLinked?.();
            })();
          },
        },
      });
    };

    if (recipeTargets.length > 0 && !sold) {
      showFichaToastWithUndo(
        recipeTargets.length === 1
          ? `«${purchase.name}» ligado à ficha «${recipeTargets[0].recipe.name}».`
          : `«${purchase.name}» ligado a ${recipeTargets.length} fichas.`,
      );
      void load();
      onLinked?.();
      return;
    }

    if (recipeTargets.length > 0 && sold) {
      showFichaToastWithUndo(
        recipeTargets.length === 1
          ? `Ficha «${recipeTargets[0].recipe.name}» salva. Continue com a unificação.`
          : `${recipeTargets.length} fichas salvas. Continue com a unificação.`,
      );
    }

    if (sold) {
      await openMergeWithSold(purchase, sold);
      return;
    }
  };

  const closeNewRecipeSheet = () => {
    setNewRecipePurchaseId(null);
    void load();
    onLinked?.();
  };

  const confirmRemoveUtil = async () => {
    if (!removeUtil) return;
    const { purchase, util } = removeUtil;
    if (util.tipo !== "FICHA_TECNICA") {
      setRemoveUtil(null);
      return;
    }
    setBusyKey(`remove:${purchase.product_id}`);
    const res = await removePurchaseRecipeIngredient(supabase, {
      companyId,
      recipeId: util.idDestino,
      ingredientProductId: purchase.product_id,
    });
    setBusyKey(null);
    setRemoveUtil(null);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível remover.");
      return;
    }
    toast.success(`Removido da ficha «${util.nomeDestino}».`);
    void load();
    onLinked?.();
  };

  if (!loading && !error && purchasesTotal === 0 && soldTotal === 0) {
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
                  Vincular compras
                </CardTitle>
                <CardDescription className="text-pretty">
                  Ligue o que entrou na nota ao produto vendido no PDV, ou use
                  como insumo em uma ficha técnica. Pode criar mais de um
                  vínculo por compra.
                </CardDescription>
              </div>
            </div>
            {!loading ? (
              <div
                className="flex shrink-0 flex-wrap gap-2 text-sm tabular-nums"
                aria-live="polite"
              >
                <span className="rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-0.5 font-medium text-sky-950 dark:text-sky-100">
                  {purchasesTotal} comprados
                </span>
                <span className="rounded-full border border-violet-500/35 bg-violet-500/10 px-2.5 py-0.5 font-medium text-violet-950 dark:text-violet-100">
                  {soldTotal} vendidos
                </span>
                {withoutUtilCount > 0 ? (
                  <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-950 dark:text-amber-100">
                    {withoutUtilCount} sem utilização (carregados)
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analisando compras e vendas…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto só com entrada pendente. Os vendidos sem par
              aparecem abaixo, se houver.
            </p>
          ) : (
            <>
              <div className="relative max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar compras…"
                  className="h-9 pl-8"
                />
              </div>

              <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)_auto]">
                <div>Comprado (só entrada)</div>
                <div className="w-9" />
                <div>Vínculo / utilizações</div>
                <div className="w-9 text-right" aria-hidden />
              </div>

              <ul className="space-y-2">
                {filteredPurchases.map((purchase) => {
                  const fichas = purchase.utilizations.filter(
                    (u) => u.tipo === "FICHA_TECNICA",
                  );
                  const pending = getPending(purchase.product_id);
                  const suggestion = bestSoldSuggestionForPurchase(
                    purchase,
                    soldOnly,
                  );
                  const rowBusy = busyKey?.endsWith(`:${purchase.product_id}`);
                  const noUtil = purchase.utilizations.length === 0;

                  const linkedSold = pending.soldId
                    ? soldOnly.find((s) => s.product_id === pending.soldId) ??
                      null
                    : null;
                  const pendingRecipes = pending.recipeIds
                    .map((id) => recipes.find((r) => r.id === id) ?? null)
                    .filter((r): r is RecipePickRow => r != null);

                  const score = linkedSold
                    ? recipeMatchSuggestionScore(purchase, linkedSold)
                    : suggestion?.score ?? 0;
                  const hasStrongPair =
                    !!linkedSold && score >= RECIPE_MATCH_SUGGESTION_THRESHOLD;
                  const hasAnyPair =
                    !!linkedSold ||
                    pending.recipeIds.length > 0 ||
                    fichas.length > 0 ||
                    !!suggestion;

                  const availableRecipes = recipes.filter(
                    (r) =>
                      !fichas.some((u) => u.idDestino === r.id) &&
                      r.output_product_id !== purchase.product_id,
                  );

                  const validRecipeCount = pending.recipeIds.filter((id) => {
                    const cfg =
                      ingredientConfigs[configKey(purchase.product_id, id)];
                    return !!cfg?.isValid;
                  }).length;

                  const canApply =
                    !!linkedSold ||
                    (pending.recipeIds.length > 0 &&
                      validRecipeCount === pending.recipeIds.length);

                  return (
                    <li key={purchase.product_id} className="space-y-2">
                      <div
                        className={cn(
                          "grid items-start gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)_auto]",
                          hasStrongPair &&
                            "border-emerald-500/40 bg-emerald-500/5",
                          hasAnyPair &&
                            !hasStrongPair &&
                            "border-amber-500/35 bg-amber-500/5",
                          noUtil && !hasAnyPair && "border-amber-500/25",
                        )}
                      >
                        <SideCard
                          title={purchase.name}
                          sub={productMeta(purchase)}
                          borderClass="border-sky-500/25"
                        />

                        <div
                          className={cn(
                            "mx-auto mt-1 flex h-9 w-9 shrink-0 self-start items-center justify-center rounded-full text-sm font-bold",
                            hasStrongPair
                              ? "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30"
                              : hasAnyPair
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-muted text-muted-foreground",
                          )}
                          aria-hidden
                        >
                          {linkedSold || suggestion
                            ? hasStrongPair
                              ? "="
                              : "≈"
                            : fichas.length > 0 || pending.recipeIds.length > 0
                              ? "✓"
                              : "?"}
                        </div>

                        <div className="min-w-0 space-y-2 self-start">
                          {fichas.map((util) => (
                            <div
                              key={`${util.tipo}:${util.idDestino}`}
                              className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2"
                            >
                              <ChefHat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Ficha técnica
                                </p>
                                <p className="truncate text-sm font-medium">
                                  {util.nomeDestino}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 text-muted-foreground"
                                disabled={!!rowBusy}
                                title="Remover utilização"
                                onClick={() =>
                                  setRemoveUtil({ purchase, util })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}

                          {suggestion &&
                          pending.soldId !== suggestion.sold.product_id ? (
                            <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-2 sm:flex-row sm:items-center">
                              <div className="min-w-0 flex flex-1 items-start gap-2">
                                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                                    Sugestão · Produto vendido
                                  </p>
                                  <p className="truncate text-sm font-semibold">
                                    {suggestion.sold.name}
                                  </p>
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                className="shrink-0"
                                disabled={!!rowBusy}
                                onClick={() =>
                                  void openMergeWithSold(
                                    purchase,
                                    suggestion.sold,
                                  )
                                }
                              >
                                {busyKey === `merge:${purchase.product_id}` ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Merge className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Unificar
                              </Button>
                            </div>
                          ) : null}

                          {linkedSold ? (
                            <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
                              <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Produto vendido
                                </p>
                                <p className="truncate text-sm font-medium">
                                  {linkedSold.name}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 text-muted-foreground"
                                disabled={!!rowBusy}
                                title="Remover seleção"
                                onClick={() =>
                                  clearSold(purchase.product_id)
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : null}

                          {pendingRecipes.map((recipe) => {
                            const key = configKey(
                              purchase.product_id,
                              recipe.id,
                            );
                            const expanded = expandedFichaKeys[key] ?? true;
                            return (
                              <div
                                key={recipe.id}
                                className="rounded-lg border bg-background px-2.5 py-2"
                              >
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left hover:bg-muted/50"
                                    disabled={!!rowBusy}
                                    aria-expanded={expanded}
                                    onClick={() =>
                                      toggleFichaExpanded(
                                        purchase.product_id,
                                        recipe.id,
                                      )
                                    }
                                  >
                                    <ChevronDown
                                      className={cn(
                                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                        !expanded && "-rotate-90",
                                      )}
                                    />
                                    <ChefHat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Ficha técnica
                                      </p>
                                      <p className="truncate text-sm font-medium">
                                        {recipe.name}
                                      </p>
                                    </div>
                                  </button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 shrink-0 text-muted-foreground"
                                    disabled={!!rowBusy}
                                    title="Remover seleção"
                                    onClick={() =>
                                      clearRecipe(
                                        purchase.product_id,
                                        recipe.id,
                                      )
                                    }
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                <div
                                  className={cn(
                                    "mt-3 rounded-lg border border-border/70 bg-muted/20 p-3",
                                    !expanded && "hidden",
                                  )}
                                >
                                  <DashboardRecipeMatchIngredientConfig
                                    key={key}
                                    companyId={companyId}
                                    ingredient={purchase}
                                    onChange={(cfg) =>
                                      setRecipeIngredientConfig(
                                        purchase.product_id,
                                        recipe.id,
                                        cfg,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })}

                          <LinkPickPopover
                            soldOptions={soldOnly}
                            recipeOptions={availableRecipes}
                            soldId={pending.soldId}
                            recipeIds={pending.recipeIds}
                            disabled={!!rowBusy}
                            onToggleSold={(id) =>
                              toggleSold(purchase.product_id, id)
                            }
                            onToggleRecipe={(id) =>
                              toggleRecipe(purchase.product_id, id)
                            }
                            onNewRecipe={() =>
                              setNewRecipePurchaseId(purchase.product_id)
                            }
                            onOpen={() =>
                              collapseFichasForPurchase(purchase.product_id)
                            }
                          />

                          {pendingCount(pending) > 0 ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={!canApply || !!rowBusy}
                              onClick={() => void applyLinks(purchase)}
                            >
                              {busyKey === `apply:${purchase.product_id}` ||
                              busyKey === `merge:${purchase.product_id}` ? (
                                <>
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  Aplicando…
                                </>
                              ) : (
                                <>
                                  {linkedSold &&
                                  pending.recipeIds.length === 0 ? (
                                    <Merge className="mr-1.5 h-3.5 w-3.5" />
                                  ) : (
                                    <Check className="mr-1.5 h-3.5 w-3.5" />
                                  )}
                                  Aplicar vínculos
                                </>
                              )}
                            </Button>
                          ) : null}
                        </div>

                        <div className="flex items-center justify-end self-start pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground"
                            disabled={!!rowBusy}
                            onClick={() => void runDismissPurchase(purchase)}
                            title="Dispensar compra"
                          >
                            {busyKey === `dismiss:${purchase.product_id}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {purchases.length < purchasesTotal ? (
                <div className="flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingMorePurchases}
                    onClick={() => void loadMorePurchases()}
                  >
                    {loadingMorePurchases ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Carregando…
                      </>
                    ) : (
                      `Carregar mais compras (${purchases.length} de ${purchasesTotal})`
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          )}

          {!loading && !error && (soldOnly.length > 0 || soldTotal > 0) ? (
            <div className="rounded-xl border border-dashed border-border/80 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Vendidos sem par na lista
                {soldTotal > 0
                  ? ` · ${soldOnly.length} de ${soldTotal}`
                  : ""}
              </p>
              <ul className="flex flex-wrap gap-2">
                {soldOnly.map((s) => (
                  <li key={s.product_id}>
                    <div className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/5 py-1 pl-2.5 pr-1 text-xs">
                      <span className="max-w-[14rem] truncate font-medium">
                        {s.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground"
                        title="Dispensar venda"
                        disabled={busyKey === `dismiss-sold:${s.product_id}`}
                        onClick={() => void runDismissSold(s)}
                      >
                        {busyKey === `dismiss-sold:${s.product_id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <EyeOff className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {soldOnly.length < soldTotal ? (
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loadingMoreSold}
                    onClick={() => void loadMoreSold()}
                  >
                    {loadingMoreSold ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Carregando…
                      </>
                    ) : (
                      "Carregar mais vendidos"
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
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
          initialSurvivorIsSource
          onMerged={() => {
            void load();
            onLinked?.();
          }}
        />
      ) : null}

      {newRecipePurchaseId ? (
        <EstoqueReceitasPanel
          key={`new-recipe:${newRecipePurchaseId}`}
          companyId={companyId}
          sheetOnly
          prefillIngredientProductId={newRecipePurchaseId}
          onSheetOpenChange={(open) => {
            if (!open) closeNewRecipeSheet();
          }}
          onStockChanged={() => {
            void load();
            onLinked?.();
          }}
        />
      ) : null}

      <AlertDialog
        open={!!removeUtil}
        onOpenChange={(open) => {
          if (!open) setRemoveUtil(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover utilização?</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              Isso remove «{removeUtil?.purchase.name}» como insumo da ficha
              «{removeUtil?.util.nomeDestino}». A ficha em si permanece.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              disabled={
                !!removeUtil &&
                busyKey === `remove:${removeUtil.purchase.product_id}`
              }
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                !removeUtil ||
                busyKey === `remove:${removeUtil.purchase.product_id}`
              }
              onClick={(e) => {
                e.preventDefault();
                void confirmRemoveUtil();
              }}
            >
              {removeUtil &&
              busyKey === `remove:${removeUtil.purchase.product_id}` ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removendo…
                </>
              ) : (
                "Remover"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { CorrelationRecipeComposer } from "@/components/products/CorrelationRecipeComposer";
import {
  CorrelationRecipeIngredientRow,
  recipeLineUnitIsAllowed,
} from "@/components/products/CorrelationRecipeIngredientRow";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
import { SaleFamilyDestinationFields } from "@/components/products/SaleFamilyDestinationFields";
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
  SearchSelect,
  type SearchSelectOption,
} from "@/components/ui/search-select";
import { useDebounce } from "@/hooks/useDebounce";
import { createCatalogProduct } from "@/lib/createCatalogProduct";
import {
  dashboardImportReviewEpocRecipeRevertToProduct,
  dashboardImportReviewFinalizeRecipeProductSales,
  dashboardImportReviewMarkTechSheetSaved,
  dashboardImportReviewSetResolution,
} from "@/lib/dashboardImportReview";
import { hasMergedCatalogItems } from "@/lib/mergeSurvivorLock";
import {
  addPurchaseAsRecipeIngredient,
  bestSoldSuggestionForPurchase,
  searchDirectProductsForFicha,
  type DirectProductPickRow,
  type ProductRecipeMatchRow,
  type PurchaseMatchRow,
  type RecipePickRow,
} from "@/lib/onboardingProductRecipeMatch";
import type { TechnicalSheetKind } from "@/lib/productIntermediate";
import {
  fetchSaleFamilyCandidates,
  linkSaleFamilyVariant,
  promoteProductToSaleFamily,
} from "@/lib/productSaleFamily";
import type { ProductSetupPrimaryAction } from "@/lib/productSetupPrimaryAction";
import {
  PRODUCT_SETUP_CHOICE_LABEL,
  setupItemAsMatchRow,
  type ProductSetupChoice,
  type ProductSetupItem,
} from "@/lib/productSetupQueue";
import { saveProductTechnicalSheet } from "@/lib/productTechnicalSheet";
import { loadProductUnitConversions } from "@/lib/productUnitConversionsService";
import { ensureSaleFamilyProductId } from "@/lib/resolveSaleFamilyTarget";
import { searchProductsForUnify } from "@/lib/searchProductsForUnify";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const FICHA_RECIPE_PREFIX = "recipe:";
const FICHA_PRODUCT_PREFIX = "product:";

function parseFichaPick(
  value: string,
): { type: "recipe" | "product"; id: string } | null {
  if (value.startsWith(FICHA_RECIPE_PREFIX)) {
    return { type: "recipe", id: value.slice(FICHA_RECIPE_PREFIX.length) };
  }
  if (value.startsWith(FICHA_PRODUCT_PREFIX)) {
    return { type: "product", id: value.slice(FICHA_PRODUCT_PREFIX.length) };
  }
  return null;
}

function parseQty(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatQty(n: number, unit: string): string {
  const q = Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return unit && unit !== "—" ? `${q} ${unit}` : q;
}

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

function uniquePartners(
  rows: { id: string; label: string }[],
): { id: string; label: string }[] {
  const seen = new Set<string>();
  const next: { id: string; label: string }[] = [];
  for (const row of rows) {
    const id = row.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push({ id, label: row.label.trim() || id });
  }
  return next;
}

export type { ProductSetupPrimaryAction } from "@/lib/productSetupPrimaryAction";

export function ProductSetupActionPanel({
  companyId,
  item,
  choice,
  soldOnly,
  recipes,
  purchases,
  onResolved,
  hideTitle = false,
  hidePrimaryAction = false,
  onPrimaryActionChange,
  suggestedUnifyPartners = [],
  suggestedRecipeIngredients = [],
}: {
  companyId: string;
  item: ProductSetupItem;
  choice: ProductSetupChoice;
  soldOnly: ProductRecipeMatchRow[];
  recipes: RecipePickRow[];
  purchases: PurchaseMatchRow[];
  onResolved: () => void;
  hideTitle?: boolean;
  hidePrimaryAction?: boolean;
  onPrimaryActionChange?: (action: ProductSetupPrimaryAction | null) => void;
  /** Pares que o agente já apontou (unificar). */
  suggestedUnifyPartners?: { id: string; label: string }[];
  /** Compras da nota / pares para pré-preencher insumos da ficha. */
  suggestedRecipeIngredients?: { id: string; name: string; unit: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [mergeProduct, setMergeProduct] = useState<Product | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePartnerId, setMergePartnerId] = useState<string | null>(null);
  const [mergeSurvivorIsSource, setMergeSurvivorIsSource] = useState(false);
  const [pickedPartners, setPickedPartners] = useState<
    { id: string; label: string }[]
  >(() =>
    choice === "link_item"
      ? uniquePartners(suggestedUnifyPartners).filter(
          (row) => row.id !== item.productId,
        )
      : [],
  );
  const [mergeQueue, setMergeQueue] = useState<string[]>([]);
  const [unifySearch, setUnifySearch] = useState("");
  const debouncedUnifySearch = useDebounce(unifySearch, 300);
  const [unifyFetching, setUnifyFetching] = useState(false);
  const [catalogOptions, setCatalogOptions] = useState<SearchSelectOption[]>(
    [],
  );
  const [recipeId, setRecipeId] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [ingredientQty, setIngredientQty] = useState("");
  const [ingredientUnitCode, setIngredientUnitCode] = useState("");
  const [ingredientConversions, setIngredientConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [createFichaName, setCreateFichaName] = useState("");
  const [fichaTab, setFichaTab] = useState<TechnicalSheetKind>("sale");
  const [fichaSearch, setFichaSearch] = useState("");
  const debouncedFichaSearch = useDebounce(fichaSearch, 300);
  const [fichaProducts, setFichaProducts] = useState<DirectProductPickRow[]>(
    [],
  );
  const [fichaProductsLoading, setFichaProductsLoading] = useState(false);

  useEffect(() => {
    setBusy(false);
    setMergeProduct(null);
    setMergeOpen(false);
    setMergePartnerId(null);
    setPickedPartners(
      choice === "link_item"
        ? uniquePartners(suggestedUnifyPartners).filter(
            (row) => row.id !== item.productId,
          )
        : [],
    );
    setMergeQueue([]);
    setUnifySearch("");
    setCatalogOptions([]);
    setRecipeId("");
    setFamilyId("");
    setNewFamilyName("");
    setConfirmPromote(false);
    setIngredientQty("");
    setIngredientUnitCode((item.unit || "un").trim().toLowerCase() || "un");
    setIngredientConversions([]);
    setCreateFichaName("");
    setFichaTab("sale");
    setFichaSearch("");
    setFichaProducts([]);
  }, [item.key, choice]);

  const suggestion = useMemo(() => {
    if (item.kind !== "purchase_unlinked") return null;
    return bestSoldSuggestionForPurchase(setupItemAsMatchRow(item), soldOnly);
  }, [item, soldOnly]);

  const recipeOutputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of recipes) {
      if (row.output_product_id) ids.add(row.output_product_id);
    }
    return ids;
  }, [recipes]);

  useEffect(() => {
    if (choice !== "ingredient") return;
    let cancelled = false;
    setFichaProductsLoading(true);
    void searchDirectProductsForFicha(supabase, {
      companyId,
      excludeIds: [item.productId, ...recipeOutputIds],
      term: debouncedFichaSearch,
      limit: 80,
    }).then((res) => {
      if (cancelled) return;
      setFichaProducts(res.rows);
      setFichaProductsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    choice,
    companyId,
    debouncedFichaSearch,
    item.productId,
    recipeOutputIds,
  ]);

  const recipeOptions = useMemo(() => {
    const convertHint =
      fichaTab === "intermediate"
        ? "Converter em ficha de produção"
        : "Converter em ficha técnica";
    const fichas: SearchSelectOption[] = recipes
      .filter((row) => row.output_product_id !== item.productId)
      .map((row) => ({
        value: `${FICHA_RECIPE_PREFIX}${row.id}`,
        label: row.name,
        group: "Fichas cadastradas",
        tab: row.recipe_type === "PRODUCTION" ? "intermediate" : "sale",
      }));

    const seen = new Set(fichaProducts.map((row) => row.id));
    const extras: DirectProductPickRow[] = [];
    for (const row of [...soldOnly, ...purchases]) {
      if (
        !row.product_id ||
        row.product_id === item.productId ||
        recipeOutputIds.has(row.product_id) ||
        seen.has(row.product_id)
      ) {
        continue;
      }
      seen.add(row.product_id);
      extras.push({
        id: row.product_id,
        name: row.name,
        sku: row.sku ?? null,
      });
    }

    const products: SearchSelectOption[] = [...fichaProducts, ...extras]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((row) => ({
        value: `${FICHA_PRODUCT_PREFIX}${row.id}`,
        label: row.sku ? `${row.name} (${row.sku})` : row.name,
        description: convertHint,
        group: "Produtos",
        keywords: [row.name, row.sku].filter(Boolean).join(" "),
      }));

    return [...fichas, ...products];
  }, [
    fichaProducts,
    fichaTab,
    item.productId,
    purchases,
    recipeOutputIds,
    recipes,
    soldOnly,
  ]);

  const recipeById = useMemo(
    () => new Map(recipes.map((row) => [row.id, row])),
    [recipes],
  );

  const soldOptions = useMemo(
    () =>
      soldOnly.map((row) => ({
        value: row.product_id,
        label: row.name,
        description: formatQty(row.current_quantity, row.unit),
        keywords: [row.sku, row.ean, row.barcode].filter(Boolean).join(" "),
      })),
    [soldOnly],
  );

  useEffect(() => {
    if (choice !== "link_item") return;
    let cancelled = false;
    setUnifyFetching(true);
    void searchProductsForUnify({
      companyId,
      excludeId: item.productId,
      term: debouncedUnifySearch,
      limit: 80,
    })
      .then((rows) => {
        if (cancelled) return;
        setCatalogOptions(
          rows.map((row) => ({
            value: row.id,
            label: row.name,
            description:
              (row.merged_catalog_names?.length ?? 0) > 0
                ? `Já unificou ${row.merged_catalog_names!.length} ${
                    row.merged_catalog_names!.length === 1 ? "item" : "itens"
                  }`
                : formatQty(row.current_quantity, row.unit),
            keywords: [
              row.name,
              row.sku,
              row.ean,
              row.barcode,
              ...(row.merged_catalog_names ?? []),
            ]
              .filter(Boolean)
              .join(" "),
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setUnifyFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [choice, companyId, item.productId, debouncedUnifySearch]);

  const purchaseOptions = useMemo(
    () =>
      purchases
        .filter((row) => row.product_id !== item.productId)
        .map((row) => ({
          value: row.product_id,
          label: row.name,
          description: formatQty(row.current_quantity, row.unit),
          keywords: [row.sku, row.ean, row.barcode].filter(Boolean).join(" "),
        })),
    [purchases, item.productId],
  );

  const unifyOptions = useMemo(() => {
    const queue =
      item.kind === "purchase_unlinked" ? soldOptions : purchaseOptions;
    const byId = new Map<string, SearchSelectOption>();
    for (const row of catalogOptions) byId.set(row.value, row);
    for (const row of queue) {
      if (!byId.has(row.value)) byId.set(row.value, row);
    }
    return [...byId.values()];
  }, [catalogOptions, item.kind, purchaseOptions, soldOptions]);

  const fichaPicked = Boolean(
    createFichaName.trim() || parseFichaPick(recipeId),
  );
  const ingredientStockUnit = (item.unit || "un").trim().toLowerCase() || "un";
  const ingredientInputQty = parseQty(ingredientQty);
  const ingredientInputUnit = ingredientUnitCode.trim().toLowerCase() || ingredientStockUnit;
  const ingredientValid = Boolean(
    fichaPicked &&
      ingredientInputQty != null &&
      recipeLineUnitIsAllowed(
        ingredientStockUnit,
        ingredientInputUnit,
        ingredientConversions,
      ),
  );

  useEffect(() => {
    if (choice !== "ingredient" || !fichaPicked) return;
    let cancelled = false;
    void loadProductUnitConversions(companyId, item.productId).then((res) => {
      if (cancelled) return;
      setIngredientConversions(res.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [choice, companyId, fichaPicked, item.productId]);

  const openMergeFrom = async (
    sourceId: string,
    partnerIds: string[],
    survivorIsSource: boolean,
  ) => {
    const [first, ...rest] = partnerIds;
    if (!first) return;
    setBusy(true);
    const product = await fetchProductById(sourceId);
    setBusy(false);
    if (!product) {
      toast.error("Não foi possível carregar o produto.");
      return;
    }
    setMergeQueue(rest);
    setMergeProduct(product);
    setMergePartnerId(first);
    setMergeSurvivorIsSource(survivorIsSource);
    setMergeOpen(true);
  };

  const startUnify = async () => {
    const ids = pickedPartners.map((row) => row.id);
    const fallback =
      ids.length === 0 && isPurchase
        ? (suggestion?.sold.product_id ?? null)
        : null;
    const partnerIds = fallback ? [fallback] : ids;
    if (partnerIds.length === 0) {
      toast.error("Escolha ao menos um produto para unificar.");
      return;
    }
    await openMergeFrom(item.productId, partnerIds, !isPurchase);
  };

  const continueUnify = async (winnerId: string) => {
    if (mergeQueue.length === 0) {
      onResolved();
      return;
    }
    const [next, ...rest] = mergeQueue;
    setBusy(true);
    const product = await fetchProductById(winnerId);
    setBusy(false);
    if (!product || !next) {
      toast.error(
        "Unificação parcial. Não foi possível seguir para o próximo.",
      );
      onResolved();
      return;
    }
    setMergeQueue(rest);
    setMergeProduct(product);
    setMergePartnerId(next);
    setMergeSurvivorIsSource(hasMergedCatalogItems(product));
    setMergeOpen(true);
  };

  const dismissPurchase = async () => {
    setBusy(true);
    const res = await dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId: item.productId,
      bucket: "ENTRY_NO_EXIT",
      resolution: "DISMISSED",
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível registrar.");
      return;
    }
    toast.success("Item marcado: não é venda e não é insumo.");
    onResolved();
  };

  const dismissFromQueue = async () => {
    const bucket =
      item.kind === "purchase_unlinked"
        ? "ENTRY_NO_EXIT"
        : item.kind === "recipe_without_ingredients"
          ? "RECIPE_NO_INGREDIENTS"
          : "EXIT_NO_ENTRY";
    return dashboardImportReviewSetResolution(supabase, {
      companyId,
      productId: item.productId,
      bucket,
      resolution: "DISMISSED",
    });
  };

  const revertRecipeStubIfNeeded = async () => {
    if (!item.recipeId) return { ok: true as const };
    return dashboardImportReviewEpocRecipeRevertToProduct(
      supabase,
      companyId,
      item.productId,
    );
  };

  const dismissSoldAsProduct = async () => {
    setBusy(true);
    if (item.recipeId) {
      const res = await dashboardImportReviewEpocRecipeRevertToProduct(
        supabase,
        companyId,
        item.productId,
      );
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível converter em produto.");
        return;
      }
    } else {
      const res = await dashboardImportReviewSetResolution(supabase, {
        companyId,
        productId: item.productId,
        bucket: "EXIT_NO_ENTRY",
        resolution: "DISMISSED",
      });
      setBusy(false);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível registrar.");
        return;
      }
    }
    toast.success("Registrado como produto interno, sem ficha técnica.");
    onResolved();
  };

  const finishIngredientLink = async (alreadyLinked: boolean) => {
    const dismissed = await dismissFromQueue();
    if (!dismissed.ok) {
      toast.error(
        dismissed.error ?? "Insumo vinculado, mas a fila não atualizou.",
      );
    } else {
      toast.success(
        alreadyLinked
          ? "Este item já estava na ficha."
          : "Insumo vinculado. A próxima entrada neste item alimenta a ficha.",
      );
    }
    onResolved();
  };

  const linkToRecipe = async (existingRecipeId: string) => {
    if (!existingRecipeId || !ingredientValid || ingredientInputQty == null)
      return;
    setBusy(true);
    const res = await addPurchaseAsRecipeIngredient(supabase, {
      companyId,
      recipeId: existingRecipeId,
      ingredientProductId: item.productId,
      inputQuantity: ingredientInputQty,
      inputUnitCode: ingredientInputUnit,
    });
    if (!res.ok) {
      setBusy(false);
      toast.error(res.error ?? "Não foi possível vincular o insumo.");
      return;
    }
    await finishIngredientLink(res.already_linked === true);
    setBusy(false);
  };

  const createFichaAndLink = async () => {
    const name = createFichaName.trim();
    if (!name || !ingredientValid || ingredientInputQty == null) return;
    setBusy(true);
    const created = await createCatalogProduct({ companyId, name });
    if (!created.product) {
      setBusy(false);
      toast.error(created.error ?? "Não foi possível cadastrar a ficha.");
      return;
    }
    const saved = await saveProductTechnicalSheet(
      companyId,
      created.product.id,
      [
        {
          product_id: item.productId,
          input_quantity: ingredientInputQty,
          input_unit_code: ingredientInputUnit,
        },
      ],
      1,
      fichaTab,
    );
    if (!saved.ok) {
      setBusy(false);
      toast.error(saved.error ?? "Não foi possível criar a ficha.");
      return;
    }
    await finishIngredientLink(false);
    setBusy(false);
  };

  const convertProductAndLink = async (outputProductId: string) => {
    if (!outputProductId || !ingredientValid || ingredientInputQty == null)
      return;
    setBusy(true);
    const saved = await saveProductTechnicalSheet(
      companyId,
      outputProductId,
      [
        {
          product_id: item.productId,
          input_quantity: ingredientInputQty,
          input_unit_code: ingredientInputUnit,
        },
      ],
      1,
      fichaTab,
    );
    if (!saved.ok) {
      setBusy(false);
      toast.error(
        saved.error ?? "Não foi possível converter o produto em ficha.",
      );
      return;
    }
    await finishIngredientLink(false);
    setBusy(false);
  };

  const confirmIngredientLink = async () => {
    if (!ingredientValid) return;
    if (createFichaName.trim()) {
      await createFichaAndLink();
      return;
    }
    const pick = parseFichaPick(recipeId);
    if (pick?.type === "recipe") {
      await linkToRecipe(pick.id);
      return;
    }
    if (pick?.type === "product") {
      await convertProductAndLink(pick.id);
    }
  };

  const confirmAsGrouping = async () => {
    setBusy(true);
    try {
      const reverted = await revertRecipeStubIfNeeded();
      if (!reverted.ok) {
        toast.error(reverted.error ?? "Não foi possível ajustar a ficha.");
        return;
      }
      await promoteProductToSaleFamily(item.productId);
      const dismissed = await dismissFromQueue();
      if (!dismissed.ok) {
        toast.error(
          dismissed.error ?? "Agrupamento criado, mas a fila não atualizou.",
        );
      } else {
        toast.success(
          "Este item agora é o agrupamento. A venda não baixa estoque neste SKU.",
        );
      }
      setConfirmPromote(false);
      onResolved();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível tornar agrupamento.",
      );
    } finally {
      setBusy(false);
    }
  };

  const linkAsVariant = async () => {
    if (!familyId && !newFamilyName.trim()) return;
    setBusy(true);
    try {
      const reverted = await revertRecipeStubIfNeeded();
      if (!reverted.ok) {
        toast.error(reverted.error ?? "Não foi possível ajustar a ficha.");
        return;
      }
      const candidates = await fetchSaleFamilyCandidates(companyId, []);
      const family = await ensureSaleFamilyProductId({
        companyId,
        familyProductId: familyId,
        newFamilyName,
        existing: candidates.filter((row) => row.id !== item.productId),
      });
      if (!family.ok) {
        toast.error(family.error);
        return;
      }
      await linkSaleFamilyVariant({
        companyId,
        familyProductId: family.id,
        variantName: item.name,
        variantSku: item.sku,
        variantUnit: item.unit !== "—" ? item.unit : "un",
        qtyPerSale: 1,
        variantProductId: item.productId,
      });
      const dismissed = await dismissFromQueue();
      if (!dismissed.ok) {
        toast.error(
          dismissed.error ?? "Variante ligada, mas a fila não atualizou.",
        );
      } else {
        toast.success(
          familyId
            ? "Produto ligado ao agrupamento. Continua no cadastro."
            : "Agrupamento cadastrado e produto ligado como variante.",
        );
      }
      onResolved();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível vincular.",
      );
    } finally {
      setBusy(false);
    }
  };

  const isPurchase = item.kind === "purchase_unlinked";
  const title = PRODUCT_SETUP_CHOICE_LABEL[choice];

  useEffect(() => {
    if (!onPrimaryActionChange) return;
    if (choice === "recipe" || choice === "intermediate") {
      return;
    }
    if (choice === "link_item") {
      onPrimaryActionChange({
        label:
          pickedPartners.length > 1
            ? `Unificar ${pickedPartners.length} produtos`
            : "Vincular",
        disabled:
          busy ||
          (pickedPartners.length === 0 &&
            !(isPurchase && suggestion?.sold.product_id)),
        busy,
        run: () => void startUnify(),
      });
      return;
    }
    if (choice === "ingredient") {
      onPrimaryActionChange({
        label: createFichaName.trim()
          ? "Criar ficha e vincular"
          : parseFichaPick(recipeId)?.type === "product"
            ? "Converter e vincular"
            : "Vincular à ficha",
        disabled: busy || !ingredientValid,
        busy,
        run: () => void confirmIngredientLink(),
      });
      return;
    }
    if (choice === "sale_family") {
      onPrimaryActionChange({
        label: "Confirmar agrupamento",
        disabled: busy,
        busy,
        run: () => setConfirmPromote(true),
      });
      return;
    }
    if (choice === "sale_family_variant") {
      onPrimaryActionChange({
        label: "Ligar ao agrupamento",
        disabled: busy || (!familyId && !newFamilyName.trim()),
        busy,
        run: () => void linkAsVariant(),
      });
      return;
    }
    if (choice === "skip") {
      onPrimaryActionChange({
        label: "Confirmar",
        disabled: busy,
        busy,
        run: () =>
          void (isPurchase ? dismissPurchase() : dismissSoldAsProduct()),
      });
      return;
    }
    onPrimaryActionChange(null);
    // run() usa os handlers do render atual; incluir as funções recria o efeito em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver acima
  }, [
    busy,
    choice,
    createFichaName,
    familyId,
    ingredientValid,
    isPurchase,
    newFamilyName,
    onPrimaryActionChange,
    pickedPartners.length,
    recipeId,
    suggestion?.sold.product_id,
  ]);

  if (choice === "recipe" || choice === "intermediate") {
    const finishRecipeSetup = async () => {
      if (item.kind === "purchase_unlinked") {
        await dismissFromQueue();
      } else {
        await dashboardImportReviewMarkTechSheetSaved(
          supabase,
          companyId,
          item.productId,
        );
        await dashboardImportReviewFinalizeRecipeProductSales(
          supabase,
          companyId,
          item.productId,
        );
      }
      onResolved();
    };
    return (
      <CorrelationRecipeComposer
        key={item.key}
        companyId={companyId}
        outputProductId={item.productId}
        outputName={item.name}
        kind={choice === "intermediate" ? "intermediate" : "sale"}
        suggestedIngredients={suggestedRecipeIngredients}
        hidePrimaryAction={hidePrimaryAction}
        onPrimaryActionChange={onPrimaryActionChange}
        onSaved={finishRecipeSetup}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {hideTitle ? null : (
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.name}</p>
        </div>
      )}

      {choice === "link_item" ? (
        <div className="space-y-3">
          {isPurchase && suggestion ? (
            <p className="text-sm">
              Sugestão:{" "}
              <span className="font-medium">{suggestion.sold.name}</span>
            </p>
          ) : null}
          {pickedPartners.length > 0 ? (
            <ul className="space-y-2">
              {pickedPartners.map((row) => {
                return (
                  <li key={row.id} className="flex w-full items-center gap-2">
                    <div className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-3 text-sm font-normal">
                      <span className="truncate">{row.label}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setPickedPartners((prev) =>
                          prev.filter((p) => p.id !== row.id),
                        )
                      }
                      aria-label={`Remover ${row.label}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <SearchSelect
            value=""
            onValueChange={(next) => {
              if (!next || pickedPartners.some((row) => row.id === next))
                return;
              const opt = unifyOptions.find((row) => row.value === next);
              setPickedPartners((prev) => [
                ...prev,
                { id: next, label: opt?.label ?? next },
              ]);
            }}
            options={unifyOptions.filter(
              (row) => !pickedPartners.some((p) => p.id === row.value),
            )}
            placeholder="Adicionar produto…"
            searchPlaceholder="Buscar no catálogo…"
            emptyMessage="Nenhum produto encontrado no catálogo."
            loading={
              unifyFetching ||
              unifySearch.trim() !== debouncedUnifySearch.trim()
            }
            onSearchChange={setUnifySearch}
          />
          {hidePrimaryAction ? null : (
            <Button
              type="button"
              disabled={
                busy ||
                (pickedPartners.length === 0 &&
                  !(isPurchase && suggestion?.sold.product_id))
              }
              onClick={() => void startUnify()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {pickedPartners.length > 1
                ? `Unificar ${pickedPartners.length} produtos`
                : "Vincular"}
            </Button>
          )}
        </div>
      ) : null}

      {choice === "ingredient" ? (
        <div className="space-y-4">
          <SearchSelect
            value={recipeId}
            onValueChange={(next) => {
              setRecipeId(next);
              setCreateFichaName("");
            }}
            options={recipeOptions}
            tabs={[
              { value: "sale", label: "Ficha técnica" },
              { value: "intermediate", label: "Ficha de produção" },
            ]}
            tab={fichaTab}
            onTabChange={(next) => {
              const kind = next as TechnicalSheetKind;
              setFichaTab(kind);
              const pick = parseFichaPick(recipeId);
              if (pick?.type === "recipe") {
                const selected = recipeById.get(pick.id);
                const selectedKind =
                  selected?.recipe_type === "PRODUCTION"
                    ? "intermediate"
                    : "sale";
                if (selected && selectedKind !== kind) setRecipeId("");
              }
            }}
            placeholder={
              fichaTab === "intermediate"
                ? "Escolher ficha de produção ou produto"
                : "Escolher ficha técnica ou produto"
            }
            searchPlaceholder="Buscar ficha, produto ou digitar um nome novo…"
            emptyMessage="Nada nesta aba — cadastre o texto digitado."
            loading={
              fichaProductsLoading ||
              fichaSearch.trim() !== debouncedFichaSearch.trim()
            }
            onSearchChange={setFichaSearch}
            triggerLabel={
              createFichaName.trim()
                ? `Nova ${fichaTab === "intermediate" ? "ficha de produção" : "ficha técnica"}: ${createFichaName.trim()}`
                : undefined
            }
            onCreate={(query) => {
              setCreateFichaName(query);
              setRecipeId("");
            }}
            createLabel={(query) =>
              fichaTab === "intermediate"
                ? `Cadastrar ficha de produção «${query}»`
                : `Cadastrar ficha técnica «${query}»`
            }
          />

          {fichaPicked ? (
            <ul className="space-y-1.5">
              <CorrelationRecipeIngredientRow
                companyId={companyId}
                line={{
                  productId: item.productId,
                  name: item.name,
                  stockUnit: ingredientStockUnit,
                  qty: ingredientQty,
                  unitCode: ingredientInputUnit,
                }}
                conversions={ingredientConversions}
                onQtyChange={setIngredientQty}
                onUnitChange={setIngredientUnitCode}
                onConversionsChange={setIngredientConversions}
              />
            </ul>
          ) : null}
          {hidePrimaryAction ? null : (
            <Button
              type="button"
              disabled={busy || !ingredientValid}
              onClick={() => void confirmIngredientLink()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {createFichaName.trim()
                ? "Criar ficha e vincular"
                : parseFichaPick(recipeId)?.type === "product"
                  ? "Converter e vincular"
                  : "Vincular à ficha"}
            </Button>
          )}
        </div>
      ) : null}

      {choice === "sale_family" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A venda de «{item.name}» gera receita e não baixa estoque neste SKU.
            A baixa vem das variantes ligadas (estoque do dia).
          </p>
          {hidePrimaryAction ? null : (
            <Button
              type="button"
              disabled={busy}
              onClick={() => setConfirmPromote(true)}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar agrupamento
            </Button>
          )}
        </div>
      ) : null}

      {choice === "sale_family_variant" ? (
        <div className="space-y-3">
          <SaleFamilyDestinationFields
            companyId={companyId}
            excludeProductId={item.productId}
            familyId={familyId}
            newFamilyName={newFamilyName}
            onFamilyIdChange={setFamilyId}
            onNewFamilyNameChange={setNewFamilyName}
            disabled={busy}
          />

          {hidePrimaryAction ? null : (
            <Button
              type="button"
              disabled={busy || (!familyId && !newFamilyName.trim())}
              onClick={() => void linkAsVariant()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Ligar ao agrupamento
            </Button>
          )}
        </div>
      ) : null}

      {choice === "skip" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isPurchase
              ? "Fica como produto interno. Entradas da nota continuam neste cadastro, sem unificar e sem entrar em ficha."
              : "Fica como produto interno. Sem ficha, sem agrupamento e sem unificar agora."}
          </p>
          {hidePrimaryAction ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void (isPurchase ? dismissPurchase() : dismissSoldAsProduct())
              }
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          )}
        </div>
      ) : null}

      <AlertDialog open={confirmPromote} onOpenChange={setConfirmPromote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este produto é o agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A venda de «{item.name}» gera receita e não baixa estoque. A baixa
              vem do relatório do dia, nos produtos ligados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmAsGrouping();
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {mergeProduct ? (
        <ProductMergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          companyId={companyId}
          sourceProduct={mergeProduct}
          formatCurrency={formatCurrency}
          initialPartnerId={mergePartnerId}
          initialSurvivorIsSource={mergeSurvivorIsSource}
          onMerged={(winnerId) => {
            setMergeOpen(false);
            void continueUnify(winnerId);
          }}
        />
      ) : null}
    </div>
  );
}

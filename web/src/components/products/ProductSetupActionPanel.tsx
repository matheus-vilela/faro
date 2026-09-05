import {
  EstoqueRecipeMatchIngredientConfig,
  type IngredientLinkConfig,
} from "@/components/estoque/EstoqueRecipeMatchIngredientConfig";
import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
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
import { SearchSelect } from "@/components/ui/search-select";
import {
  dashboardImportReviewEpocRecipeRevertToProduct,
  dashboardImportReviewFinalizeRecipeProductSales,
  dashboardImportReviewMarkTechSheetSaved,
  dashboardImportReviewSetResolution,
} from "@/lib/dashboardImportReview";
import {
  addPurchaseAsRecipeIngredient,
  bestSoldSuggestionForPurchase,
  type ProductRecipeMatchRow,
  type PurchaseMatchRow,
  type RecipePickRow,
} from "@/lib/onboardingProductRecipeMatch";
import {
  fetchSaleFamilyCandidates,
  linkSaleFamilyVariant,
  promoteProductToSaleFamily,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";
import {
  setupItemAsMatchRow,
  PRODUCT_SETUP_CHOICE_LABEL,
  type ProductSetupChoice,
  type ProductSetupItem,
} from "@/lib/productSetupQueue";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

export function ProductSetupActionPanel({
  companyId,
  item,
  choice,
  soldOnly,
  recipes,
  purchases,
  onResolved,
}: {
  companyId: string;
  item: ProductSetupItem;
  choice: ProductSetupChoice;
  soldOnly: ProductRecipeMatchRow[];
  recipes: RecipePickRow[];
  purchases: PurchaseMatchRow[];
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [mergeProduct, setMergeProduct] = useState<Product | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePartnerId, setMergePartnerId] = useState<string | null>(null);
  const [mergeSurvivorIsSource, setMergeSurvivorIsSource] = useState(false);
  const [pickedPartnerId, setPickedPartnerId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [families, setFamilies] = useState<SaleFamilyProductOption[]>([]);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [ingredientConfig, setIngredientConfig] =
    useState<IngredientLinkConfig | null>(null);

  useEffect(() => {
    setBusy(false);
    setMergeProduct(null);
    setMergeOpen(false);
    setMergePartnerId(null);
    setPickedPartnerId("");
    setRecipeId("");
    setFamilyId("");
    setConfirmPromote(false);
    setIngredientConfig(null);
  }, [item.key, choice]);

  useEffect(() => {
    if (choice !== "sale_family_variant") return;
    let cancelled = false;
    void fetchSaleFamilyCandidates(companyId, [])
      .then((rows) => {
        if (!cancelled) {
          setFamilies(
            rows.filter(
              (row) =>
                row.id !== item.productId &&
                row.stock_control_type !== "INTERMEDIATE",
            ),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Não foi possível listar agrupamentos.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [choice, companyId, item.productId]);

  const suggestion = useMemo(() => {
    if (item.kind !== "purchase_unlinked") return null;
    return bestSoldSuggestionForPurchase(setupItemAsMatchRow(item), soldOnly);
  }, [item, soldOnly]);

  const recipeOptions = useMemo(
    () => recipes.map((row) => ({ value: row.id, label: row.name })),
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

  const matchRow = setupItemAsMatchRow(item);

  const openMerge = async (
    partnerId: string | null,
    survivorIsSource: boolean,
  ) => {
    setBusy(true);
    const product = await fetchProductById(item.productId);
    setBusy(false);
    if (!product) {
      toast.error("Não foi possível carregar o produto.");
      return;
    }
    setMergeProduct(product);
    setMergePartnerId(partnerId);
    setMergeSurvivorIsSource(survivorIsSource);
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
    toast.success("Registrado como item de venda, sem ficha técnica.");
    onResolved();
  };

  const linkToRecipe = async () => {
    if (!recipeId || !ingredientConfig?.isValid) return;
    setBusy(true);
    const res = await addPurchaseAsRecipeIngredient(supabase, {
      companyId,
      recipeId,
      ingredientProductId: item.productId,
      inputQuantity: ingredientConfig.inputQuantity,
      inputUnitCode: ingredientConfig.inputUnitCode,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível vincular o insumo.");
      return;
    }
    toast.success(
      res.already_linked
        ? "Este item já estava na ficha."
        : "Insumo vinculado. A próxima entrada neste item alimenta a ficha.",
    );
    onResolved();
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
        toast.error(dismissed.error ?? "Agrupamento criado, mas a fila não atualizou.");
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
    if (!familyId) return;
    setBusy(true);
    try {
      const reverted = await revertRecipeStubIfNeeded();
      if (!reverted.ok) {
        toast.error(reverted.error ?? "Não foi possível ajustar a ficha.");
        return;
      }
      await linkSaleFamilyVariant({
        companyId,
        familyProductId: familyId,
        variantName: item.name,
        variantSku: item.sku,
        variantUnit: item.unit !== "—" ? item.unit : "un",
        qtyPerSale: 1,
        variantProductId: item.productId,
      });
      const dismissed = await dismissFromQueue();
      if (!dismissed.ok) {
        toast.error(dismissed.error ?? "Variante ligada, mas a fila não atualizou.");
      } else {
        toast.success("Produto ligado ao agrupamento. Continua no cadastro.");
      }
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível vincular.");
    } finally {
      setBusy(false);
    }
  };

  const isPurchase = item.kind === "purchase_unlinked";
  const title = PRODUCT_SETUP_CHOICE_LABEL[choice];

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
      <EstoqueReceitasPanel
        key={item.key}
        companyId={companyId}
        sheetOnly
        embedInline
        ingredientsOnly
        initialOpenRecipeId={item.recipeId}
        prefillNewRecipeOutputProductId={item.recipeId ? null : item.productId}
        prefillNewRecipeAutoOpen={false}
        technicalSheetOutputProductId={item.productId}
        technicalSheetKind={choice === "intermediate" ? "intermediate" : "sale"}
        contextOutputProductId={item.productId}
        onTechnicalSheetSaved={() => void finishRecipeSetup()}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{item.name}</p>
      </div>

      {choice === "link_item" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isPurchase
              ? "Este cadastro e o item vendido no PDV passam a ser o mesmo. A nota movimenta o item certo."
              : "Une este cadastro ao item da compra. A nota e a venda passam a ser o mesmo produto."}
          </p>
          {isPurchase && suggestion ? (
            <p className="text-sm">
              Sugestão: <span className="font-medium">{suggestion.sold.name}</span>
            </p>
          ) : null}
          <SearchSelect
            value={pickedPartnerId}
            onValueChange={setPickedPartnerId}
            options={isPurchase ? soldOptions : purchaseOptions}
            placeholder="Escolher o outro item"
            searchPlaceholder="Buscar produto…"
            emptyMessage="Nenhum item na fila. Abra o diálogo para buscar no catálogo."
          />
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void openMerge(
                pickedPartnerId ||
                  (isPurchase ? suggestion?.sold.product_id ?? null : null),
                !isPurchase,
              )
            }
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Vincular
          </Button>
        </div>
      ) : null}

      {choice === "ingredient" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A entrada neste item passa a alimentar a ficha do prato.
          </p>
          <SearchSelect
            value={recipeId}
            onValueChange={setRecipeId}
            options={recipeOptions}
            placeholder="Escolher ficha"
            searchPlaceholder="Buscar ficha…"
            emptyMessage="Nenhuma ficha cadastrada."
          />
          <EstoqueRecipeMatchIngredientConfig
            companyId={companyId}
            ingredient={matchRow}
            onChange={setIngredientConfig}
          />
          <Button
            type="button"
            disabled={busy || !recipeId || !ingredientConfig?.isValid}
            onClick={() => void linkToRecipe()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Vincular à ficha
          </Button>
        </div>
      ) : null}

      {choice === "sale_family" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A venda de «{item.name}» gera receita e não baixa estoque neste
            SKU. A baixa vem das variantes ligadas (estoque do dia).
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => setConfirmPromote(true)}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirmar agrupamento
          </Button>
        </div>
      ) : null}

      {choice === "sale_family_variant" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Este cadastro continua sendo produto de estoque, ligado a um
            agrupamento de cardápio.
          </p>
          <SearchSelect
            value={familyId}
            onValueChange={setFamilyId}
            options={families.map((row) => ({
              value: row.id,
              label: row.name,
              description:
                row.stock_control_type === "SALE_FAMILY"
                  ? row.sku
                    ? `Agrupamento · SKU ${row.sku}`
                    : "Agrupamento"
                  : row.sku
                    ? `SKU ${row.sku} · vira agrupamento ao ligar`
                    : "Vira agrupamento ao ligar",
              keywords: row.sku ?? "",
            }))}
            placeholder="Escolher agrupamento"
            searchPlaceholder="Buscar agrupamento…"
            emptyMessage="Nenhum agrupamento no cadastro."
          />
          <Button
            type="button"
            disabled={busy || !familyId}
            onClick={() => void linkAsVariant()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Ligar ao agrupamento
          </Button>
        </div>
      ) : null}

      {choice === "skip" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isPurchase
              ? "Fica como produto de estoque. Entradas da nota continuam neste cadastro, sem unificar e sem entrar em ficha."
              : "Fica como produto. Sem ficha, sem agrupamento e sem unificar agora."}
          </p>
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
        </div>
      ) : null}

      <AlertDialog open={confirmPromote} onOpenChange={setConfirmPromote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este produto é o agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A venda de «{item.name}» gera receita e não baixa estoque. A
              baixa vem do relatório do dia, nos produtos ligados.
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
          onMerged={() => {
            setMergeOpen(false);
            onResolved();
          }}
        />
      ) : null}
    </div>
  );
}

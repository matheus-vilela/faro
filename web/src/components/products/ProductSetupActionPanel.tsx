import {
  EstoqueRecipeMatchIngredientConfig,
  type IngredientLinkConfig,
} from "@/components/estoque/EstoqueRecipeMatchIngredientConfig";
import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
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
  const [ingredientConfig, setIngredientConfig] =
    useState<IngredientLinkConfig | null>(null);

  useEffect(() => {
    setBusy(false);
    setMergeProduct(null);
    setMergeOpen(false);
    setMergePartnerId(null);
    setPickedPartnerId("");
    setRecipeId("");
    setIngredientConfig(null);
  }, [item.key, choice]);

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

  const isPurchase = item.kind === "purchase_unlinked";
  const title = PRODUCT_SETUP_CHOICE_LABEL[choice];

  if (choice === "recipe" && item.kind !== "purchase_unlinked") {
    const finishRecipeSetup = async () => {
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

      {choice === "skip" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {isPurchase
              ? "Este item sai da fila. Entradas futuras da nota continuam neste cadastro, sem descontar outro produto e sem entrar em ficha."
              : "Este item sai da fila. Não vamos criar ficha nem vincular a outro cadastro agora."}
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

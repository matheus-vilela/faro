import { RecipeProducePanel } from "@/components/estoque/RecipeProducePanel";
import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { fetchProductTechnicalSheet } from "@/lib/productTechnicalSheet";
import type { RecipeProductionIngredientInput } from "@/lib/recipeProductionPreview";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export function ProductProduceCard({
  companyId,
  product,
  active = true,
  className,
  onProduced,
}: {
  companyId: string;
  product: Product;
  active?: boolean;
  className?: string;
  onProduced?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchYield, setBatchYield] = useState(1);
  const [ingredients, setIngredients] = useState<
    RecipeProductionIngredientInput[]
  >([]);
  const [hasSheet, setHasSheet] = useState(false);

  useEffect(() => {
    if (!active || !companyId || !product.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchProductTechnicalSheet(companyId, product.id).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        setHasSheet(false);
        return;
      }
      const sheet = res.data;
      if (!sheet?.recipe_id || sheet.sheet_kind !== "intermediate") {
        setHasSheet(false);
        setIngredients([]);
        return;
      }
      setHasSheet(true);
      setBatchYield(sheet.batch_yield || 1);
      setIngredients(
        sheet.ingredients.map((ing) => ({
          productId: ing.product_id,
          name: ing.name,
          quantity: Number(ing.input_quantity) || 0,
          unitLabel: systemUnitLabel(ing.input_unit_code || ing.unit || "un"),
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [active, companyId, product.id]);

  if (loading) {
    return (
      <div
        className={cn(
          PRODUCT_SHEET_SECTION,
          "flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando ficha de produção…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(PRODUCT_SHEET_SECTION, className)}>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!hasSheet) {
    return (
      <div className={cn(PRODUCT_SHEET_SECTION, className)}>
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Produzir
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Este produto ainda não tem ficha de produção. Cadastre os insumos em
          Configuração → Ficha técnica.
        </p>
      </div>
    );
  }

  return (
    <RecipeProducePanel
      companyId={companyId}
      mode="produce"
      outputProductId={product.id}
      outputName={product.name}
      outputUnit={product.unit}
      batchYield={batchYield}
      ingredients={ingredients}
      className={className}
      onProduced={onProduced}
    />
  );
}

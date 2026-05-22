import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { fetchProductTechnicalSheet } from "@/lib/productTechnicalSheet";
import type { Product } from "@/types/product";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type ProductTechnicalSheetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  outputProduct: Product;
  onSaved: (
    recipeId: string | null,
    backfill?: { output_out_movements: number; ingredient_movements_created: number },
  ) => void;
};

export function ProductTechnicalSheetDialog({
  open,
  onOpenChange,
  companyId,
  outputProduct,
  onSaved,
}: ProductTechnicalSheetDialogProps) {
  const [initLoading, setInitLoading] = useState(false);
  const [recipeId, setRecipeId] = useState<string | null>(null);

  const loadRecipeId = useCallback(async () => {
    setInitLoading(true);
    const res = await fetchProductTechnicalSheet(companyId, outputProduct.id);
    setInitLoading(false);
    if (res.error) {
      toast.error(res.error);
      setRecipeId(null);
      return;
    }
    setRecipeId(res.data?.recipe_id ?? null);
  }, [companyId, outputProduct.id]);

  useEffect(() => {
    if (!open) return;
    void loadRecipeId();
  }, [open, loadRecipeId]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setRecipeId(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {initLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando ficha…
          </div>
        ) : (
          <div className="flex min-h-[min(70vh,640px)] flex-col p-4">
            <EstoqueReceitasPanel
              companyId={companyId}
              sheetOnly
              embedInline
              ingredientsOnly
              initialOpenRecipeId={recipeId}
              prefillNewRecipeOutputProductId={
                recipeId ? null : outputProduct.id
              }
              prefillNewRecipeAutoOpen={false}
              technicalSheetOutputProductId={outputProduct.id}
              onTechnicalSheetSaved={(id, backfill) => {
                onSaved(id, backfill);
                handleOpenChange(false);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

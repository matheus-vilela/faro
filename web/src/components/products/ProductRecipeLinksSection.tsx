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
  fetchProductRecipeUtilizations,
  removePurchaseRecipeIngredient,
  type ProductRecipeUtilization,
} from "@/lib/onboardingProductRecipeMatch";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChefHat, Loader2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

function formatQtyUnit(qty: number | null, unit: string | null): string | null {
  if (qty == null) return null;
  const q = qty.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return unit ? `${q} ${unit}` : q;
}

export function ProductRecipeLinksSection({
  companyId,
  productId,
  productName,
  className,
  onChanged,
}: {
  companyId: string;
  productId: string;
  productName: string;
  className?: string;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<ProductRecipeUtilization[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ProductRecipeUtilization | null>(null);
  const [undoing, setUndoing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchProductRecipeUtilizations(
      supabase,
      companyId,
      productId,
    );
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
      setRows([]);
      return;
    }
    setRows(res.rows);
  }, [companyId, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUndo = async () => {
    if (!pending) return;
    setUndoing(true);
    const res = await removePurchaseRecipeIngredient(supabase, {
      companyId,
      recipeId: pending.recipe_id,
      ingredientProductId: productId,
    });
    setUndoing(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível desfazer o vínculo.");
      return;
    }
    toast.success(`Removido da ficha «${pending.recipe_name}».`);
    setPending(null);
    void load();
    onChanged?.();
  };

  if (loading) {
    return (
      <section className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando vínculos em fichas…
        </div>
      </section>
    );
  }

  if (rows.length === 0) return null;

  return (
    <>
      <section className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2">
          <ChefHat className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Vínculos em fichas</p>
        </div>
        <ul className="space-y-2">
          {rows.map((row) => {
            const qtyLabel = formatQtyUnit(
              row.input_quantity,
              row.input_unit_code,
            );
            return (
              <li
                key={row.recipe_id}
                className="flex flex-col gap-2 rounded-xl border border-border/80 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium leading-snug">
                    Insumo em «{row.recipe_name}»
                  </p>
                  {qtyLabel ? (
                    <p className="text-xs text-muted-foreground">
                      Consumo: {qtyLabel} por porção
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setPending(row)}
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  Desfazer
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <AlertDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open && !undoing) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer vínculo com a ficha?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? (
                <>
                  Isso remove «{productName}» como insumo da ficha «
                  {pending.recipe_name}». A ficha em si permanece.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoing}
              onClick={(e) => {
                e.preventDefault();
                void handleUndo();
              }}
            >
              {undoing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Desfazendo…
                </>
              ) : (
                "Confirmar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

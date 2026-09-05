import {
  formatProductionQty,
  type RecipeProductionPreview,
} from "@/lib/recipeProductionPreview";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function RecipeProductionSummary({
  preview,
  showEntry,
}: {
  preview: RecipeProductionPreview;
  showEntry: boolean;
}) {
  return (
    <div className="space-y-3">
      {showEntry ? (
        <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-3">
          <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-teal-800 dark:text-teal-100">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Entrada no estoque
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
            +{formatProductionQty(preview.outputQty)} {preview.outputUnit}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {preview.outputName} · {formatProductionQty(preview.batches)}{" "}
            {preview.batches === 1 ? "receita" : "receitas"} ×{" "}
            {formatProductionQty(preview.batchYield)} de rendimento
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3">
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-destructive">
          <ArrowDownRight className="h-3.5 w-3.5" />
          Saída de insumos
        </p>
        {preview.ingredients.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhum insumo na ficha.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {preview.ingredients.map((ing) => (
              <li
                key={ing.productId}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="min-w-0 truncate text-foreground">
                  {ing.name}
                </span>
                <span className="shrink-0 tabular-nums font-medium text-destructive">
                  −{formatProductionQty(ing.quantity)} {ing.unitLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

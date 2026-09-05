import { cn } from "@/lib/utils";
import { ArrowLeftRight, ChefHat, FileBadge, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";

export type ProductCorrelationCounts = {
  total: number;
  purchases: number;
  sold: number;
  recipes: number;
};

function KpiTile({
  icon,
  label,
  value,
  highlight,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 sm:px-4",
        highlight
          ? "border-amber-500/40 bg-amber-500/[0.07]"
          : "border-border/80 bg-card",
      )}
    >
      <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-xl font-semibold tabular-nums",
          highlight && "text-amber-800 dark:text-amber-300",
        )}
      >
        {value.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

/** Contagens da fila de correlação (vendidos × compras da nota). */
export function ProductCorrelationKpis({
  counts,
}: {
  counts: ProductCorrelationCounts;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
        label="Pendentes"
        value={counts.total}
        highlight={counts.total > 0}
      />
      <KpiTile
        icon={<ShoppingBag className="h-3.5 w-3.5" />}
        label="Vendidos sem entrada"
        value={counts.sold}
        highlight={counts.sold > 0}
      />
      <KpiTile
        icon={<FileBadge className="h-3.5 w-3.5" />}
        label="Compras sem uso"
        value={counts.purchases}
        highlight={counts.purchases > 0}
      />
      <KpiTile
        icon={<ChefHat className="h-3.5 w-3.5" />}
        label="Fichas incompletas"
        value={counts.recipes}
        highlight={counts.recipes > 0}
      />
    </div>
  );
}

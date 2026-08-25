import { cn } from "@/lib/utils";
import type { CatalogStockKpis } from "@/lib/productCatalogValue";
import { AlertTriangle, Coins, Package, PackageX } from "lucide-react";

export function ProductCatalogKpis({
  kpis,
  formatCurrency,
  onBelowMin,
  onZero,
}: {
  kpis: CatalogStockKpis;
  formatCurrency: (v: number) => string;
  onBelowMin: () => void;
  onZero: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-xl border border-border/80 bg-card px-3 py-3 sm:px-4">
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3.5 w-3.5" />
          Itens ativos
        </p>
        <p className="mt-1.5 text-xl font-semibold tabular-nums">
          {kpis.activeCount.toLocaleString("pt-BR")}
        </p>
      </div>
      <div className="rounded-xl border border-border/80 bg-card px-3 py-3 sm:px-4">
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          <Coins className="h-3.5 w-3.5" />
          Valor em estoque
        </p>
        <p className="mt-1.5 text-xl font-semibold tabular-nums">
          {formatCurrency(kpis.stockValue)}
        </p>
      </div>
      <button
        type="button"
        onClick={onBelowMin}
        className={cn(
          "rounded-xl border px-3 py-3 text-left sm:px-4",
          kpis.belowMinCount > 0
            ? "border-destructive/40 bg-destructive/5"
            : "border-border/80 bg-card",
        )}
      >
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          Abaixo do mínimo
        </p>
        <p
          className={cn(
            "mt-1.5 text-xl font-semibold tabular-nums",
            kpis.belowMinCount > 0 && "text-destructive",
          )}
        >
          {kpis.belowMinCount.toLocaleString("pt-BR")}
        </p>
      </button>
      <button
        type="button"
        onClick={onZero}
        className="rounded-xl border border-border/80 bg-card px-3 py-3 text-left sm:px-4"
      >
        <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          <PackageX className="h-3.5 w-3.5" />
          Zerados
        </p>
        <p className="mt-1.5 text-xl font-semibold tabular-nums">
          {kpis.zeroCount.toLocaleString("pt-BR")}
        </p>
      </button>
    </div>
  );
}

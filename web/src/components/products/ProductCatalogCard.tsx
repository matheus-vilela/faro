import { Badge } from "@/components/ui/badge";
import { isSystemUnitCode } from "@/lib/companyUnits/productUnitOptions";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  AlertTriangle,
  ChevronRight,
  Package,
  PowerOff,
  ShoppingCart,
} from "lucide-react";

export type ProductCatalogLayout = "list" | "grid";

const CMV_CATEGORY_TAG_STYLES = [
  "border-sky-300/70 bg-sky-500/10 text-sky-950 dark:border-sky-600/50 dark:bg-sky-500/[0.14] dark:text-sky-50",
  "border-violet-300/70 bg-violet-500/10 text-violet-950 dark:border-violet-600/50 dark:bg-violet-500/[0.14] dark:text-violet-50",
  "border-emerald-300/70 bg-emerald-500/10 text-emerald-950 dark:border-emerald-600/50 dark:bg-emerald-500/[0.14] dark:text-emerald-50",
  "border-amber-300/80 bg-amber-500/12 text-amber-950 dark:border-amber-600/50 dark:bg-amber-500/[0.15] dark:text-amber-50",
  "border-rose-300/70 bg-rose-500/10 text-rose-950 dark:border-rose-600/50 dark:bg-rose-500/[0.14] dark:text-rose-50",
  "border-cyan-300/70 bg-cyan-500/10 text-cyan-950 dark:border-cyan-600/50 dark:bg-cyan-500/[0.14] dark:text-cyan-50",
] as const;

function cmvCategoryTagClass(index: number) {
  return CMV_CATEGORY_TAG_STYLES[index % CMV_CATEGORY_TAG_STYLES.length];
}

function productComposesCmv(p: Pick<Product, "composes_cmv">): boolean {
  return p.composes_cmv !== false;
}

function unitCostParts(p: Product) {
  const cmv =
    p.average_cost != null && p.average_cost > 0
      ? Number(p.average_cost)
      : null;
  const last =
    p.last_unit_value != null && p.last_unit_value > 0
      ? Number(p.last_unit_value)
      : null;
  const lastStock =
    p.last_unit_value_stock != null && p.last_unit_value_stock > 0
      ? Number(p.last_unit_value_stock)
      : last;
  const unit = cmv ?? lastStock ?? null;
  return {
    cmv,
    last,
    unit,
    lastUnitCode: p.last_unit_value_unit_code ?? p.unit,
  };
}

export function ProductCatalogCard({
  product: p,
  layout,
  formatCurrency,
  onOpen,
  operationalType,
  operationalTypeLabel,
  catalogTags,
  pendingPurchaseQty,
  conversionRowCount,
}: {
  product: Product;
  layout: ProductCatalogLayout;
  formatCurrency: (v: number) => string;
  onOpen: (product: Product) => void;
  operationalType: string | null;
  operationalTypeLabel: (value: string | null | undefined) => string;
  catalogTags?: { id: string; name: string }[];
  pendingPurchaseQty: number;
  conversionRowCount: number;
}) {
  const isGrid = layout === "grid";
  const qNum = Number(p.current_quantity);
  const minNum = Number(p.min_quantity ?? 0);
  const stockIsNegative = qNum < 0;
  const stockIsZero = !stockIsNegative && (p.stock_is_zero ?? qNum <= 0);
  const stockBelowMinPositive =
    p.stock_below_min_positive ??
    (minNum > 0 && qNum > 0 && qNum <= minNum);
  const needsStockHighlight =
    p.stock_has_alert ??
    (stockIsNegative || stockIsZero || (minNum > 0 && qNum <= minNum));
  const qtyStr = Number(p.current_quantity).toLocaleString("pt-BR");
  const minStr =
    p.min_quantity > 0
      ? Number(p.min_quantity).toLocaleString("pt-BR")
      : "—";
  const { cmv, last, unit: unitCost, lastUnitCode } = unitCostParts(p);
  const stockLineValue =
    unitCost != null ? Number(p.current_quantity) * unitCost : null;
  const composesLabel = productComposesCmv(p)
    ? "Compõe CMV: Sim"
    : "Compõe CMV: Não";
  const catSegments =
    catalogTags && catalogTags.length > 0
      ? [...catalogTags.map((c) => c.name), composesLabel]
      : [composesLabel];
  const visibleCatSegments = isGrid ? catSegments.slice(0, 2) : catSegments;
  const hiddenCatCount = isGrid
    ? Math.max(0, catSegments.length - visibleCatSegments.length)
    : 0;

  const statusBadges = (
    <>
      {p.is_active === false && (
        <Badge
          variant="secondary"
          className="h-6 gap-1 px-2 text-[0.7rem] font-normal"
        >
          <PowerOff className="h-3 w-3" />
          Inativo
        </Badge>
      )}
      {stockIsNegative && (
        <Badge
          variant="destructive"
          className="h-6 gap-1 px-2 text-[0.7rem] font-normal"
        >
          <AlertTriangle className="h-3 w-3" />
          {isGrid ? "Negativo" : "Estoque negativo"}
        </Badge>
      )}
      {stockIsZero && (
        <Badge
          variant="destructive"
          className="h-6 gap-1 px-2 text-[0.7rem] font-normal"
        >
          <AlertTriangle className="h-3 w-3" />
          {isGrid ? "Zerado" : "Estoque zerado"}
        </Badge>
      )}
      {stockBelowMinPositive && (
        <Badge
          variant="secondary"
          className="h-6 gap-1 border-amber-500/40 bg-amber-500/10 px-2 text-[0.7rem] font-normal text-amber-950 dark:text-amber-50"
        >
          <AlertTriangle className="h-3 w-3" />
          {isGrid ? "Baixo" : "Abaixo do mínimo"}
        </Badge>
      )}
      {pendingPurchaseQty > 0 && !isGrid && (
        <Badge
          variant="outline"
          className="h-6 gap-1 border-blue-500/35 bg-blue-500/[0.08] px-2 text-[0.7rem] font-normal text-blue-950 dark:border-blue-400/35 dark:bg-blue-500/15 dark:text-blue-50"
        >
          <ShoppingCart className="h-3 w-3" />
          Compra em andamento
        </Badge>
      )}
      {(p.import_unit_needs_review === true || !isSystemUnitCode(p.unit)) &&
        !isGrid && (
          <Badge
            variant="secondary"
            className="h-6 gap-1 border-rose-500/40 bg-rose-500/10 px-2 text-[0.7rem] font-normal text-rose-950 dark:text-rose-100"
          >
            <AlertTriangle className="h-3 w-3" />
            Revisar unidade
          </Badge>
        )}
    </>
  );

  const metricsGrid = (
    <div
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:gap-3",
        !isGrid && "lg:grid-cols-4 xl:min-w-[min(100%,36rem)] xl:max-w-2xl xl:shrink-0 2xl:min-w-[min(100%,40rem)]",
      )}
    >
      <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Quantidade
        </p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums leading-none text-foreground",
            isGrid ? "text-base" : "text-lg sm:text-xl",
          )}
        >
          <span className="inline-flex flex-wrap items-baseline gap-x-1">
            <span>{qtyStr}</span>
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              {p.unit}
            </span>
          </span>
          {pendingPurchaseQty > 0 ? (
            <span className="mt-1.5 block text-xs font-normal tabular-nums leading-snug text-blue-700 dark:text-blue-300">
              +{pendingPurchaseQty.toLocaleString("pt-BR")} {p.unit}
              {!isGrid ? " em pedido de compra" : " pedido"}
            </span>
          ) : null}
        </p>
      </div>
      <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Estoque mínimo
        </p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums leading-none text-foreground",
            isGrid ? "text-base" : "text-lg sm:text-xl",
          )}
        >
          {minStr}
          {p.min_quantity > 0 ? (
            <span className="ml-1 text-xs font-medium text-muted-foreground sm:text-sm">
              {p.unit}
            </span>
          ) : null}
        </p>
      </div>
      <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Preço unitário
        </p>
        <p className="mt-2 text-sm font-semibold tabular-nums leading-tight text-foreground sm:text-base">
          {cmv != null ? (
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
              <span className="whitespace-nowrap">{formatCurrency(cmv)}</span>
              <span className="text-[0.65rem] font-normal text-muted-foreground sm:text-xs">
                /{p.unit} · médio
              </span>
            </span>
          ) : last != null ? (
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
              <span className="whitespace-nowrap">{formatCurrency(last)}</span>
              <span className="text-[0.65rem] font-normal text-muted-foreground sm:text-xs">
                /{lastUnitCode ?? p.unit} · último
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </p>
      </div>
      <div
        className={cn(
          "rounded-xl border px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5",
          stockLineValue != null && unitCost != null
            ? "border-primary/25 bg-primary/[0.06]"
            : "border-border/70 bg-background/70",
        )}
      >
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Valor em estoque
        </p>
        <p
          className={cn(
            "mt-2 font-bold tabular-nums leading-snug",
            isGrid ? "text-sm sm:text-base" : "text-base sm:text-lg",
            stockLineValue != null && unitCost != null
              ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {stockLineValue != null && unitCost != null
            ? formatCurrency(stockLineValue)
            : "—"}
        </p>
      </div>
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(p)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(p)}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/25 text-left shadow-sm transition-all",
        "hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isGrid ? "flex h-full flex-col p-3 sm:p-4" : "p-4 sm:p-5 md:p-6",
        p.is_active === false && "opacity-[0.82]",
        needsStockHighlight
          ? "border-destructive/35 bg-destructive/[0.04] ring-1 ring-inset ring-destructive/15"
          : "border-border/80",
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          isGrid ? "min-h-0 flex-1 flex-col sm:gap-3" : "sm:gap-4",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl border shadow-sm",
            isGrid ? "h-10 w-10" : "mt-0.5 h-11 w-11 sm:h-12 sm:w-12",
            needsStockHighlight
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border/70 bg-muted/50 text-muted-foreground group-hover:border-primary/25 group-hover:bg-primary/5 group-hover:text-primary",
          )}
          aria-hidden
        >
          <Package
            className={cn(isGrid ? "h-4 w-4" : "h-5 w-5 sm:h-6 sm:w-6")}
            strokeWidth={1.6}
          />
        </div>

        <div
          className={cn(
            "min-w-0 flex-1",
            isGrid ? "flex flex-col gap-3" : "space-y-3 sm:space-y-3.5",
          )}
        >
          {isGrid ? (
            <>
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground">
                    {p.name}
                  </h3>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="flex flex-wrap gap-1.5">{statusBadges}</div>
                {visibleCatSegments.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {operationalType ? (
                      <span className="inline-flex max-w-full items-center rounded-full border border-indigo-300/70 bg-indigo-500/10 px-2 py-0.5 text-[0.65rem] font-medium leading-none text-indigo-950 dark:border-indigo-600/50 dark:bg-indigo-500/[0.14] dark:text-indigo-50">
                        {operationalTypeLabel(operationalType)}
                      </span>
                    ) : null}
                    {visibleCatSegments.map((seg, idx) => (
                      <span
                        key={`${p.id}-${idx}-${seg}`}
                        className={cn(
                          "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-medium leading-none shadow-sm",
                          cmvCategoryTagClass(idx),
                        )}
                      >
                        <span className="truncate">{seg}</span>
                      </span>
                    ))}
                    {hiddenCatCount > 0 ? (
                      <span className="text-[0.65rem] text-muted-foreground">
                        +{hiddenCatCount}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-[0.65rem] text-muted-foreground">
                  {p.sku ? (
                    <>
                      <span className="font-mono">{p.sku}</span>
                      <span className="mx-1.5 text-border">·</span>
                    </>
                  ) : null}
                  {conversionRowCount} conversão(ões)
                </p>
              </div>
              {metricsGrid}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-6">
                <div className="flex min-w-0 items-start justify-between gap-3 xl:flex-1">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl">
                        {p.name}
                      </h3>
                      {statusBadges}
                    </div>

                    {catSegments.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {operationalType ? (
                          <span
                            className={cn(
                              "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm",
                              "border-indigo-300/70 bg-indigo-500/10 text-indigo-950 dark:border-indigo-600/50 dark:bg-indigo-500/[0.14] dark:text-indigo-50",
                            )}
                          >
                            <span className="truncate">
                              Tipo final: {operationalTypeLabel(operationalType)}
                            </span>
                          </span>
                        ) : null}
                        {catSegments.map((seg, idx) => (
                          <span
                            key={`${p.id}-${idx}-${seg}`}
                            className={cn(
                              "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm",
                              cmvCategoryTagClass(idx),
                            )}
                          >
                            <span className="truncate">{seg}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <p className="text-xs text-muted-foreground sm:text-[0.8rem]">
                      {p.sku && (
                        <>
                          <span className="font-mono text-[0.8rem] sm:text-sm">
                            {p.sku}
                          </span>
                          <span className="mx-2 text-border">·</span>
                        </>
                      )}
                      <span> Conversões: {conversionRowCount}</span>
                    </p>
                  </div>

                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary sm:h-10 sm:w-10 xl:hidden"
                    aria-hidden
                  >
                    <ChevronRight className="h-5 w-5" />
                  </span>
                </div>

                {metricsGrid}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

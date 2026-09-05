import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import {
  lastPriceDisplayUnit,
  lastPriceNeedsConversion,
  lastPricePerStockUnit,
  lastPriceRecorded,
  type LastPriceConversionRow,
} from "@/lib/lastPricePerStockUnit";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import { AlertTriangle, Plus } from "lucide-react";

function productLineUnit(
  p: Product,
  conversions?: LastPriceConversionRow[],
): {
  last: number | null;
  lastUnitCode: string | null;
  lastPerStock: number | null;
  lineUnit: number | null;
} {
  const last = lastPriceRecorded(p);
  const lastStock =
    p.last_unit_value_stock != null && p.last_unit_value_stock > 0
      ? Number(p.last_unit_value_stock)
      : last;
  const average =
    p.average_cost != null && p.average_cost > 0
      ? Number(p.average_cost)
      : null;
  return {
    last,
    lastUnitCode: lastPriceDisplayUnit(p) || null,
    lastPerStock: lastPricePerStockUnit(p, conversions),
    lineUnit: average ?? lastStock ?? null,
  };
}

function Metric({
  label,
  value,
  suffix,
  extra,
  action,
  emphasize,
}: {
  label: string;
  value: string;
  suffix?: string;
  extra?: { value: string; suffix: string };
  action?: ReactNode;
  emphasize?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 font-semibold tabular-nums leading-tight",
          emphasize ? "text-lg sm:text-xl" : "text-base sm:text-lg",
        )}
      >
        {value}
        {suffix ? (
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </p>
      {extra ? (
        <p className="mt-1 text-xs font-medium tabular-nums leading-snug text-muted-foreground">
          {extra.value}
          <span className="ml-1">{extra.suffix}</span>
        </p>
      ) : null}
      {action}
    </div>
  );
}

export function ProductStockValueCard({
  product,
  formatCurrency,
  conversions,
  conversionsLoading,
  onCreateConversion,
  className,
}: {
  product: Product;
  formatCurrency: (value: number) => string;
  conversions?: LastPriceConversionRow[];
  conversionsLoading?: boolean;
  onCreateConversion?: (priceUnit: string) => void;
  className?: string;
}) {
  const qty = Number(product.current_quantity);
  const min = Number(product.min_quantity);
  const unit = product.unit;
  const { last, lastUnitCode, lastPerStock, lineUnit } = productLineUnit(
    product,
    conversions,
  );
  const needsConversion =
    !conversionsLoading && lastPriceNeedsConversion(product, conversions);
  const lineValue = lineUnit != null ? qty * lineUnit : null;
  const isFamily = product.stock_control_type === "SALE_FAMILY";
  const lowStock = !isFamily && min > 0 && qty <= min;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Estoque e valor
        </p>
        {lowStock ? (
          <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-destructive">
            <AlertTriangle className="size-3" />
            Abaixo do mínimo
          </span>
        ) : null}
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x divide-y divide-border">
        <Metric
          label="Quantidade"
          value={qty.toLocaleString("pt-BR")}
          suffix={unit}
        />
        <Metric
          label="Mínimo"
          value={min > 0 ? min.toLocaleString("pt-BR") : "—"}
          suffix={min > 0 ? unit : undefined}
        />
        <Metric
          label="Último preço"
          value={last != null ? formatCurrency(last) : "—"}
          suffix={last != null ? `por ${lastUnitCode ?? unit}` : undefined}
          extra={
            lastPerStock != null
              ? {
                  value: formatCurrency(lastPerStock),
                  suffix: `por ${unit}`,
                }
              : undefined
          }
          action={
            needsConversion && onCreateConversion ? (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs leading-snug text-muted-foreground">
                  Sem conversão para {unit}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() =>
                    onCreateConversion(lastUnitCode ?? unit)
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Criar conversão
                </Button>
              </div>
            ) : undefined
          }
        />
        <Metric
          label="Valor em estoque"
          value={lineValue != null ? formatCurrency(lineValue) : "—"}
          emphasize={lineValue != null}
        />
      </div>
      {lowStock ? (
        <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive sm:px-5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs leading-snug">
            Estoque no ou abaixo do mínimo. Confira compras ou ajuste o mínimo
            em Editar.
          </p>
        </div>
      ) : null}
    </div>
  );
}

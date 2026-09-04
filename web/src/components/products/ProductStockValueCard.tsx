import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import { AlertTriangle } from "lucide-react";

function productLineUnit(p: Product): {
  last: number | null;
  lastUnitCode: string | null;
  lineUnit: number | null;
} {
  const last =
    p.last_unit_value != null && p.last_unit_value > 0
      ? Number(p.last_unit_value)
      : null;
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
    lastUnitCode: p.last_unit_value_unit_code ?? p.unit ?? null,
    lineUnit: average ?? lastStock ?? null,
  };
}

function Metric({
  label,
  value,
  suffix,
  emphasize,
}: {
  label: string;
  value: string;
  suffix?: string;
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
    </div>
  );
}

export function ProductStockValueCard({
  product,
  formatCurrency,
  className,
}: {
  product: Product;
  formatCurrency: (value: number) => string;
  className?: string;
}) {
  const qty = Number(product.current_quantity);
  const min = Number(product.min_quantity);
  const unit = product.unit;
  const { last, lastUnitCode, lineUnit } = productLineUnit(product);
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

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RevenueEntry } from "@/types/revenue";
import {
  serviceDailySaleDisplayAmount,
  serviceDailySaleTitle,
  type ServiceDailySaleCalendarRow,
} from "@/types/serviceDailySale";

export type DaySaleKind = "product" | "service";

export type DaySaleListItem = {
  id: string;
  kind: DaySaleKind;
  name: string;
  quantity: number;
  unitPrice: number;
  gross: number;
  tax: number;
  net: number;
  /** Só produtos abrem o detalhe. */
  revenueEntryId?: string;
};

export function daySaleFromRevenueEntry(entry: RevenueEntry): DaySaleListItem {
  const quantity = Number(entry.quantity) || 0;
  const gross = Number(entry.gross_amount) || 0;
  const unitFromField = Number(entry.unit_value);
  const unitPrice =
    Number.isFinite(unitFromField) && unitFromField > 0
      ? unitFromField
      : quantity > 0
        ? gross / quantity
        : 0;
  return {
    id: entry.id,
    kind: "product",
    name: entry.title?.trim() || "Produto",
    quantity,
    unitPrice,
    gross,
    tax: Number(entry.tax_amount) || 0,
    net: Number(entry.net_amount) || 0,
    revenueEntryId: entry.id,
  };
}

export function daySaleFromService(
  sale: ServiceDailySaleCalendarRow,
): DaySaleListItem {
  const gross = serviceDailySaleDisplayAmount(sale);
  return {
    id: sale.id,
    kind: "service",
    name: serviceDailySaleTitle(sale),
    quantity: Number(sale.quantity) || 0,
    unitPrice: Number(sale.unit_price) || 0,
    gross,
    tax: 0,
    net: gross,
  };
}

function Metric({
  label,
  value,
  emphasize,
  tone,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: "emerald" | "sky" | "muted" | "rose";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "tabular-nums",
          emphasize ? "text-base font-bold" : "text-sm font-semibold",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
          tone === "sky" && "text-sky-700 dark:text-sky-400",
          tone === "rose" && "text-rose-700 dark:text-rose-400",
          (!tone || tone === "muted") && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function DaySaleItemCard({
  item,
  formatCurrency,
  onClick,
}: {
  item: DaySaleListItem;
  formatCurrency: (v: number) => string;
  onClick?: () => void;
}) {
  const isProduct = item.kind === "product";
  const interactive = typeof onClick === "function";
  const className = cn(
    "flex w-full flex-col gap-2.5 rounded-lg border px-3 py-2.5 text-left",
    isProduct
      ? "border-emerald-600/30 dark:border-emerald-500/35"
      : "border-sky-600/35 dark:border-sky-500/40",
    interactive && "transition-colors hover:bg-muted/50",
  );

  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
          {item.name}
        </p>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0",
            isProduct
              ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
          )}
        >
          {isProduct ? "Produto" : "Serviço"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <Metric
          label="Qtd"
          value={item.quantity.toLocaleString("pt-BR", {
            maximumFractionDigits: 4,
          })}
        />
        <Metric label="Preço unit." value={formatCurrency(item.unitPrice)} />
        <Metric label="Total bruto" value={formatCurrency(item.gross)} />
        <Metric
          label="Taxa"
          value={formatCurrency(item.tax)}
          tone={item.tax > 0 ? "rose" : "muted"}
        />
        <Metric
          label="Total líquido"
          value={formatCurrency(item.net)}
          emphasize
          tone={isProduct ? "emerald" : "sky"}
        />
      </div>
    </>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}

/** @deprecated Prefer DaySaleItemCard via daySaleFromRevenueEntry */
export function RevenueDaySaleListCard({
  entry,
  formatCurrency,
  onClick,
}: {
  entry: RevenueEntry;
  formatCurrency: (v: number) => string;
  onClick: () => void;
}) {
  return (
    <DaySaleItemCard
      item={daySaleFromRevenueEntry(entry)}
      formatCurrency={formatCurrency}
      onClick={onClick}
    />
  );
}

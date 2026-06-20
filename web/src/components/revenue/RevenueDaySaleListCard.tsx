import { cn } from "@/lib/utils";
import type { RevenueEntry } from "@/types/revenue";

export function RevenueDaySaleListCard({
  entry,
  formatCurrency,
  onClick,
}: {
  entry: RevenueEntry;
  formatCurrency: (v: number) => string;
  onClick: () => void;
}) {
  const isSale =
    entry.entry_mode === "product_sale" || entry.entry_mode === "recipe_sale";
  const cmv = Number(entry.cmv_amount ?? 0);
  const showCmv = isSale;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border border-emerald-600/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 dark:border-emerald-500/35"
    >
      <p className="text-sm font-medium leading-snug text-foreground">{entry.title}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Líquido
          </p>
          <p className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatCurrency(Number(entry.net_amount))}
          </p>
        </div>
        {showCmv ? (
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              CMV
            </p>
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                entry.cmv_needs_backfill
                  ? "text-orange-700 dark:text-orange-300"
                  : "text-rose-700 dark:text-rose-400",
              )}
            >
              {entry.cmv_needs_backfill && cmv <= 0
                ? "Pendente"
                : formatCurrency(cmv)}
            </p>
          </div>
        ) : null}
      </div>
      {showCmv ? (
        <p className="text-[11px] tabular-nums text-muted-foreground">
          Bruto {formatCurrency(Number(entry.gross_amount))}
          {" · "}
          Taxa −{formatCurrency(Number(entry.tax_amount))}
        </p>
      ) : null}
    </button>
  );
}

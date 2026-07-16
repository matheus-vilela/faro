import {
  PayableOriginBadge,
  PayableSituationBadge,
} from "@/components/fluxo/PayableListBadges";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import { formatContasCount } from "@/lib/payableTotals";
import {
  boletoSupplierLabel,
  categoryTipoIcon,
  formatDueDateShort,
  groupPayablesByCategory,
  resolvePayableOrigin,
  resolvePayableSituation,
} from "@/lib/payableListViews";
import { resolveReceiptExpenseId } from "@/lib/payableBoletoReceipt";
import type { PayableReceiptExpense } from "@/lib/payableBoletoReceipt";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { FluxoBoletoRow } from "@/types/expenseSeries";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function itemSubtitle(b: FluxoBoletoRow): string | null {
  if (isProjectedBoleto(b)) return "Lançamento fixo mensal";
  const supplier = boletoSupplierLabel(b);
  return supplier !== "—" ? supplier : null;
}

export function PayableByCategoryView({
  boletos,
  categoriesById,
  expenseById,
  todayYmd,
  loading,
  emptyMessage,
  formatCurrency,
  onSelect,
}: {
  boletos: FluxoBoletoRow[];
  categoriesById: Map<string, CompanyCategory>;
  expenseById: Map<string, PayableReceiptExpense>;
  todayYmd: string;
  loading: boolean;
  emptyMessage: string;
  formatCurrency: (v: number) => string;
  onSelect: (b: FluxoBoletoRow) => void;
}) {
  const groups = useMemo(
    () => groupPayablesByCategory(boletos, categoriesById),
    [boletos, categoriesById],
  );

  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (groups.length === 0) {
      queueMicrotask(() => setOpenKeys(new Set()));
      return;
    }
    queueMicrotask(() => setOpenKeys(new Set([groups[0]!.key])));
  }, [groups]);

  if (loading) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  if (groups.length === 0) {
    return <p className="text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const open = openKeys.has(group.key);
        const Icon = categoryTipoIcon(group.tipo);
        return (
          <Collapsible
            key={group.key}
            open={open}
            onOpenChange={(next) => {
              setOpenKeys((prev) => {
                const copy = new Set(prev);
                if (next) copy.add(group.key);
                else copy.delete(group.key);
                return copy;
              });
            }}
          >
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      open ? "rotate-0" : "-rotate-90",
                    )}
                    aria-hidden
                  />
                  <Icon
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">
                      {group.name}
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">
                      {formatContasCount(group.count)}
                    </span>
                  </span>
                  <span className="shrink-0 text-base font-bold tabular-nums">
                    {formatCurrency(group.amount)}
                  </span>
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="border-t border-border/70 px-4 pb-3 pt-1">
                  {group.subgroups.map((sub) => (
                    <div key={sub.key} className="pt-3">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {sub.label}
                      </p>
                      <ul className="divide-y divide-border/60">
                        {sub.items.map((b) => {
                          const situation = resolvePayableSituation(
                            b,
                            todayYmd,
                          );
                          const origin = resolvePayableOrigin(b, expenseById);
                          const subtitle = itemSubtitle(b);
                          const rowKey =
                            b.id ||
                            `${resolveReceiptExpenseId(b) ?? "x"}-${b.due_date}`;
                          return (
                            <li key={rowKey}>
                              <button
                                type="button"
                                onClick={() => onSelect(b)}
                                className="flex w-full flex-col gap-2 py-3 text-left transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-foreground">
                                    {formatBoletoFluxoDescription(b) ||
                                      "Conta a pagar"}
                                  </p>
                                  {subtitle ? (
                                    <p className="truncate text-sm text-muted-foreground">
                                      {subtitle}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                  <PayableOriginBadge origin={origin} />
                                  <span className="text-sm text-muted-foreground">
                                    Vence {formatDueDateShort(b.due_date)}
                                  </span>
                                  <PayableSituationBadge
                                    situation={situation}
                                  />
                                  <span className="min-w-20 text-right text-sm font-bold tabular-nums">
                                    {formatCurrency(Number(b.amount) || 0)}
                                  </span>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}

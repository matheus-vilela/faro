import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  DaySaleItemCard,
  daySaleFromRevenueEntry,
  daySaleFromService,
  type DaySaleKind,
  type DaySaleListItem,
} from "@/components/revenue/RevenueDaySaleListCard";
import type { RevenueCalendarDayListPayload } from "@/components/revenue/RevenueEntriesCalendar";
import { useSheetListView } from "@/hooks/useSheetListView";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type KindFilter = "all" | DaySaleKind;
type SortKey =
  | "kind"
  | "name"
  | "quantity"
  | "unitPrice"
  | "gross"
  | "tax"
  | "net";

function compareItems(
  a: DaySaleListItem,
  b: DaySaleListItem,
  sortKey: SortKey,
  ascending: boolean,
): number {
  let cmp = 0;
  if (sortKey === "name" || sortKey === "kind") {
    cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), "pt-BR", {
      sensitivity: "base",
    });
  } else {
    cmp = Number(a[sortKey]) - Number(b[sortKey]);
  }
  if (cmp === 0) {
    cmp = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  }
  return ascending ? cmp : -cmp;
}

export function RevenueDaySalesSheet({
  payload,
  open,
  onOpenChange,
  formatCurrency,
  onProductClick,
}: {
  payload: RevenueCalendarDayListPayload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatCurrency: (v: number) => string;
  onProductClick?: (revenueEntryId: string) => void;
}) {
  const viewMode = useSheetListView();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKindFilter("all");
    setSearch("");
    setSortKey("net");
    setSortAsc(false);
  }, [open, payload?.dateKey]);

  const allItems = useMemo(() => {
    if (!payload) return [] as DaySaleListItem[];
    return [
      ...payload.items.map(daySaleFromRevenueEntry),
      ...payload.serviceItems.map(daySaleFromService),
    ];
  }, [payload]);

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allItems
      .filter((item) => {
        if (kindFilter !== "all" && item.kind !== kindFilter) return false;
        if (!term) return true;
        return item.name.toLowerCase().includes(term);
      })
      .sort((a, b) => compareItems(a, b, sortKey, sortAsc));
  }, [allItems, kindFilter, search, sortKey, sortAsc]);

  const totals = useMemo(() => {
    let gross = 0;
    let tax = 0;
    let net = 0;
    for (const item of filteredSorted) {
      gross += item.gross;
      tax += item.tax;
      net += item.net;
    }
    return { gross, tax, net, count: filteredSorted.length };
  }, [filteredSorted]);

  const productCount = allItems.filter((i) => i.kind === "product").length;
  const serviceCount = allItems.filter((i) => i.kind === "service").length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === "name" || key === "kind");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        maximizable
        className="z-50 flex w-full flex-col gap-0 overflow-hidden p-0"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-20 text-left">
          <SheetTitle className="capitalize">Vendas neste dia</SheetTitle>
          <SheetDescription className="capitalize">
            {payload?.title ?? "—"}
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 space-y-3 border-b px-6 py-3">
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Total geral
              {kindFilter !== "all" || search.trim()
                ? " (filtrado)"
                : ""}
            </p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totals.net)}
              </p>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                <p>Bruto {formatCurrency(totals.gross)}</p>
                <p>Taxas −{formatCurrency(totals.tax)}</p>
                <p>
                  {totals.count} item{totals.count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>

          <div
            className="inline-flex w-full rounded-full bg-muted p-1 sm:w-auto"
            role="tablist"
            aria-label="Tipo de venda"
          >
            {(
              [
                { value: "all", label: "Todos", count: allItems.length },
                { value: "product", label: "Produtos", count: productCount },
                { value: "service", label: "Serviços", count: serviceCount },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={kindFilter === opt.value}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 flex-1 rounded-full px-3 shadow-none sm:flex-none",
                  kindFilter === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                onClick={() => setKindFilter(opt.value)}
              >
                {opt.label}
                <span className="tabular-nums text-muted-foreground">
                  {opt.count}
                </span>
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por nome…"
                className="h-9 pl-8"
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {filteredSorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {allItems.length === 0
                ? "Nenhuma venda neste dia."
                : "Nenhum item com os filtros actuais."}
            </p>
          ) : viewMode === "cards" ? (
            <div className="space-y-4">
              {(kindFilter === "all" || kindFilter === "product") &&
              filteredSorted.some((i) => i.kind === "product") ? (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-sm bg-emerald-500"
                      aria-hidden
                    />
                    <h3 className="text-sm font-semibold">Produtos</h3>
                  </div>
                  {filteredSorted
                    .filter((i) => i.kind === "product")
                    .map((item) => (
                      <DaySaleItemCard
                        key={item.id}
                        item={item}
                        formatCurrency={formatCurrency}
                        onClick={
                          item.revenueEntryId && onProductClick
                            ? () => onProductClick(item.revenueEntryId!)
                            : undefined
                        }
                      />
                    ))}
                </section>
              ) : null}
              {(kindFilter === "all" || kindFilter === "service") &&
              filteredSorted.some((i) => i.kind === "service") ? (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-sm bg-sky-500"
                      aria-hidden
                    />
                    <h3 className="text-sm font-semibold">Serviços</h3>
                  </div>
                  {filteredSorted
                    .filter((i) => i.kind === "service")
                    .map((item) => (
                      <DaySaleItemCard
                        key={item.id}
                        item={item}
                        formatCurrency={formatCurrency}
                      />
                    ))}
                </section>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <SortableTableHead
                      label="Tipo"
                      column="kind"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      label="Nome"
                      column="name"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      label="Qtd"
                      column="quantity"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Preço unit."
                      column="unitPrice"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Total bruto"
                      column="gross"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Taxa"
                      column="tax"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Total líquido"
                      column="net"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((item) => {
                    const clickable =
                      item.kind === "product" &&
                      item.revenueEntryId &&
                      onProductClick;
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-b last:border-0",
                          clickable &&
                            "cursor-pointer hover:bg-muted/40",
                        )}
                        onClick={
                          clickable
                            ? () => onProductClick!(item.revenueEntryId!)
                            : undefined
                        }
                      >
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              item.kind === "product"
                                ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                                : "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
                            )}
                          >
                            {item.kind === "product" ? "Produto" : "Serviço"}
                          </Badge>
                        </td>
                        <td className="max-w-[14rem] truncate px-3 py-2 font-medium">
                          {item.name}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {item.quantity.toLocaleString("pt-BR", {
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(item.gross)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700 dark:text-rose-400">
                          {formatCurrency(item.tax)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-semibold tabular-nums",
                            item.kind === "product"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-sky-700 dark:text-sky-400",
                          )}
                        >
                          {formatCurrency(item.net)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 text-xs font-semibold">
                    <td className="px-3 py-2" colSpan={4}>
                      Total ({totals.count})
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totals.gross)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totals.tax)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(totals.net)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

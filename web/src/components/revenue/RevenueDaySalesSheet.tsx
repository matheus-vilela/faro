import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DaySaleItemCard,
  daySaleFromRevenueEntry,
  daySaleFromService,
  type DaySaleKind,
  type DaySaleListItem,
} from "@/components/revenue/RevenueDaySaleListCard";
import type { RevenueCalendarDayListPayload } from "@/components/revenue/RevenueEntriesCalendar";
import { cn } from "@/lib/utils";
import { ArrowDownAZ, ArrowUpAZ, LayoutGrid, List, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type KindFilter = "all" | DaySaleKind;
type SortKey = "name" | "quantity" | "unitPrice" | "gross" | "tax" | "net";
type ViewMode = "cards" | "table";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Nome" },
  { value: "quantity", label: "Quantidade" },
  { value: "unitPrice", label: "Preço unit." },
  { value: "gross", label: "Total bruto" },
  { value: "tax", label: "Taxa" },
  { value: "net", label: "Total líquido" },
];

function compareItems(
  a: DaySaleListItem,
  b: DaySaleListItem,
  sortKey: SortKey,
  ascending: boolean,
): number {
  let cmp = 0;
  if (sortKey === "name") {
    cmp = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
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
  modal = true,
}: {
  payload: RevenueCalendarDayListPayload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatCurrency: (v: number) => string;
  onProductClick?: (revenueEntryId: string) => void;
  /** Quando outro sheet está por cima, use false para não fechar este ao interagir. */
  modal?: boolean;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (!open) return;
    setViewMode("cards");
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
      <SheetContent
        className={cn(
          "z-50 flex w-full flex-col gap-0 overflow-hidden p-0",
          viewMode === "table" ? "sm:max-w-4xl" : "sm:max-w-lg",
        )}
      >
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12 text-left">
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
            <Select
              value={kindFilter}
              onValueChange={(v) => setKindFilter(v as KindFilter)}
            >
              <SelectTrigger className="h-9 w-[9.5rem]">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  Todos ({allItems.length})
                </SelectItem>
                <SelectItem value="product">
                  Produtos ({productCount})
                </SelectItem>
                <SelectItem value="service">
                  Serviços ({serviceCount})
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortKey}
              onValueChange={(v) => setSortKey(v as SortKey)}
            >
              <SelectTrigger className="h-9 w-[9.5rem]">
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              title={sortAsc ? "Crescente" : "Decrescente"}
              onClick={() => setSortAsc((v) => !v)}
            >
              {sortAsc ? (
                <ArrowUpAZ className="size-4" />
              ) : (
                <ArrowDownAZ className="size-4" />
              )}
            </Button>
            <div
              className="inline-flex rounded-full bg-muted p-1"
              role="tablist"
              aria-label="Formato da lista"
            >
              <Button
                type="button"
                role="tab"
                aria-selected={viewMode === "cards"}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 rounded-full px-2.5 shadow-none",
                  viewMode === "cards"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                onClick={() => setViewMode("cards")}
              >
                <LayoutGrid className="size-3.5" />
                Cards
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={viewMode === "table"}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 rounded-full px-2.5 shadow-none",
                  viewMode === "table"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                onClick={() => setViewMode("table")}
              >
                <List className="size-3.5" />
                Tabela
              </Button>
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
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium text-right">Qtd</th>
                    <th className="px-3 py-2 font-medium text-right">
                      Preço unit.
                    </th>
                    <th className="px-3 py-2 font-medium text-right">
                      Total bruto
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Taxa</th>
                    <th className="px-3 py-2 font-medium text-right">
                      Total líquido
                    </th>
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

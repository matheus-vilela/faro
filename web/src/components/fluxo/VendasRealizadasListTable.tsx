import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { orderedYmdRange } from "@/lib/monthYmdRange";
import { categoryGroupLabel } from "@/lib/vendasRealizadasResumo";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { RevenueEntry } from "@/types/revenue";
import {
  serviceDailySaleDisplayAmount,
  serviceDailySaleTitle,
  type ServiceDailySaleCalendarRow,
} from "@/types/serviceDailySale";
import { FilterX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

export type VendasListKindFilter = "all" | "product" | "service";
export type VendasListGroupMode = "product" | "product_day";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type TablePageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type SortKey =
  | "date"
  | "description"
  | "kind"
  | "category"
  | "quantity"
  | "amount";

type UnifiedRow = {
  key: string;
  kind: "product" | "service";
  groupId: string;
  dateYmd: string;
  dateYmdEnd: string;
  description: string;
  categoryLabel: string;
  categoryId: string | null;
  amount: number;
  quantity: number | null;
  revenueEntryId?: string;
  service?: ServiceDailySaleCalendarRow;
};

function formatQty(q: number | null): string {
  if (q == null) return "—";
  return q.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function parseQuantity(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function revenueGroupId(entry: RevenueEntry): string {
  if (entry.entry_mode === "product_sale" && entry.product_id) {
    return `product:${entry.product_id}`;
  }
  if (entry.entry_mode === "recipe_sale" && entry.recipe_id) {
    return `recipe:${entry.recipe_id}`;
  }
  return `manual:${entry.title.trim().toLowerCase() || entry.id}`;
}

function formatDateBr(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function formatDateCell(row: UnifiedRow): string {
  if (row.dateYmd === row.dateYmdEnd) return formatDateBr(row.dateYmd);
  return `${formatDateBr(row.dateYmd)} – ${formatDateBr(row.dateYmdEnd)}`;
}

function productGroupKey(row: UnifiedRow): string {
  return row.groupId;
}

function groupVendasRows(
  rows: UnifiedRow[],
  mode: VendasListGroupMode,
): UnifiedRow[] {
  const buckets = new Map<string, UnifiedRow[]>();
  for (const row of rows) {
    const key =
      mode === "product_day"
        ? `${productGroupKey(row)}:${row.dateYmd}`
        : productGroupKey(row);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const grouped: UnifiedRow[] = [];
  for (const [key, list] of buckets) {
    const first = list[0];
    if (list.length === 1) {
      grouped.push({ ...first, key });
      continue;
    }
    const dates = list.map((r) => r.dateYmd).sort();
    const qtyParts = list
      .map((r) => r.quantity)
      .filter((q): q is number => q != null);
    grouped.push({
      ...first,
      key,
      dateYmd: dates[0],
      dateYmdEnd: dates[dates.length - 1],
      amount: list.reduce((s, r) => s + r.amount, 0),
      quantity: qtyParts.length > 0 ? qtyParts.reduce((s, q) => s + q, 0) : null,
      revenueEntryId: list.length === 1 ? first.revenueEntryId : undefined,
      service: list.length === 1 ? first.service : undefined,
    });
  }
  return grouped;
}

function compareRows(a: UnifiedRow, b: UnifiedRow, sortKey: SortKey): number {
  switch (sortKey) {
    case "date":
      return (
        a.dateYmdEnd.localeCompare(b.dateYmdEnd) ||
        a.dateYmd.localeCompare(b.dateYmd) ||
        a.description.localeCompare(b.description, "pt-BR")
      );
    case "description":
      return a.description.localeCompare(b.description, "pt-BR");
    case "kind":
      return a.kind.localeCompare(b.kind);
    case "category":
      return a.categoryLabel.localeCompare(b.categoryLabel, "pt-BR");
    case "quantity":
      return (a.quantity ?? -1) - (b.quantity ?? -1);
    case "amount":
      return a.amount - b.amount;
    default:
      return 0;
  }
}

type Props = {
  revenueEntries: RevenueEntry[];
  serviceSales: ServiceDailySaleCalendarRow[];
  categories: CompanyCategory[];
  categoriesById: Map<string, CompanyCategory>;
  loading: boolean;
  emptyMessage: string;
  formatCurrency: (v: number) => string;
  onSelectRevenueEntry: (id: string) => void;
  dateFrom: string;
  dateTo: string;
  monthBounds: { min: string; max: string };
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
};

export function VendasRealizadasListTable({
  revenueEntries,
  serviceSales,
  categoriesById,
  loading,
  emptyMessage,
  formatCurrency,
  onSelectRevenueEntry,
  dateFrom,
  dateTo,
  monthBounds,
  onDateFromChange,
  onDateToChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<VendasListKindFilter>("all");
  const [groupMode, setGroupMode] = useState<VendasListGroupMode>("product_day");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(20);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo]);

  const allRows = useMemo((): UnifiedRow[] => {
    const productRows: UnifiedRow[] = revenueEntries.map((e) => {
      const dateYmd = e.entry_date.slice(0, 10);
      return {
        key: `r-${e.id}`,
        kind: "product" as const,
        groupId: revenueGroupId(e),
        dateYmd,
        dateYmdEnd: dateYmd,
        description: e.title?.trim() || "Produto",
        categoryLabel: categoryGroupLabel(e.subcategory_id, categoriesById),
        categoryId: e.subcategory_id ?? e.category_id ?? null,
        amount: Number(e.net_amount) || 0,
        quantity: parseQuantity(e.quantity),
        revenueEntryId: e.id,
      };
    });

    const serviceRows: UnifiedRow[] = serviceSales.map((s) => {
      const dateYmd = s.sale_date.slice(0, 10);
      return {
        key: `s-${s.id}`,
        kind: "service" as const,
        groupId: `s:${s.service?.id ?? s.id}`,
        dateYmd,
        dateYmdEnd: dateYmd,
        description: serviceDailySaleTitle(s),
        categoryLabel: "Serviços",
        categoryId: null,
        amount: serviceDailySaleDisplayAmount(s),
        quantity: parseQuantity(s.quantity),
        service: s,
      };
    });

    return [...productRows, ...serviceRows];
  }, [revenueEntries, serviceSales, categoriesById]);

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const fromDate = dateFrom.trim() || monthBounds.min;
    const toDate = dateTo.trim() || monthBounds.max;
    const { gte, lte } = orderedYmdRange(fromDate, toDate);
    const filtered = allRows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (gte && r.dateYmd < gte) return false;
      if (lte && r.dateYmd > lte) return false;
      if (term) {
        const hay = `${r.description} ${r.categoryLabel}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    const grouped = groupVendasRows(filtered, groupMode);
    return grouped.slice().sort((a, b) => {
      const cmp = compareRows(a, b, sortKey);
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      return a.description.localeCompare(b.description, "pt-BR");
    });
  }, [allRows, search, kind, dateFrom, dateTo, monthBounds, groupMode, sortKey, sortAsc]);

  const totalAmount = useMemo(
    () => filteredSorted.reduce((s, r) => s + r.amount, 0),
    [filteredSorted],
  );

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredSorted.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const dateRangeIsCustom =
    dateFrom !== monthBounds.min || dateTo !== monthBounds.max;
  const hasActiveFilters =
    search.trim() !== "" ||
    dateRangeIsCustom ||
    kind !== "all" ||
    groupMode !== "product_day";

  const clearFilters = () => {
    setSearch("");
    onDateFromChange(monthBounds.min);
    onDateToChange(monthBounds.max);
    setKind("all");
    setGroupMode("product_day");
    setSortKey("date");
    setSortAsc(false);
    setPage(1);
  };

  const handleSort = (column: SortKey) => {
    if (sortKey === column) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(column);
      setSortAsc(column === "description" || column === "category");
    }
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <Label htmlFor="vendas-list-search">Busca</Label>
          <Input
            id="vendas-list-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Descrição, categoria…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendas-list-from">Data de início</Label>
          <Input
            id="vendas-list-from"
            type="date"
            aria-label="Data de início"
            title="Data de início"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => {
              onDateFromChange(e.target.value || monthBounds.min);
              setPage(1);
            }}
            className="w-auto"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendas-list-to">Data de fim</Label>
          <Input
            id="vendas-list-to"
            type="date"
            aria-label="Data de fim"
            title="Data de fim"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => {
              onDateToChange(e.target.value || monthBounds.max);
              setPage(1);
            }}
            className="w-auto"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as VendasListKindFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[9.5rem]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="product">Produtos</SelectItem>
              <SelectItem value="service">Serviços</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Agrupamento</Label>
          <Select
            value={groupMode}
            onValueChange={(v) => {
              setGroupMode(v as VendasListGroupMode);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[13rem]">
              <SelectValue placeholder="Agrupamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="product">Por período</SelectItem>
              <SelectItem value="product_day">Diário</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!hasActiveFilters}
          onClick={clearFilters}
        >
          <FilterX className="mr-2 size-4" />
          Limpar
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {loading
            ? "A carregar…"
            : `${filteredSorted.length} registro(s)${
                hasActiveFilters ? " (filtrados)" : ""
              }`}
        </p>
        {!loading && filteredSorted.length > 0 && (
          <p className="font-medium tabular-nums text-foreground">
            Total: {formatCurrency(totalAmount)}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Carregando…
        </p>
      ) : filteredSorted.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {allRows.length === 0
            ? emptyMessage
            : "Nenhum registro com estes filtros."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <SortableTableHead
                    label="Data"
                    column="date"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Descrição"
                    column="description"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Tipo"
                    column="kind"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Categoria"
                    column="category"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Qtde"
                    column="quantity"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                    align="right"
                  />
                  <SortableTableHead
                    label="Valor"
                    column="amount"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={handleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const clickable = Boolean(r.revenueEntryId);
                  const rowClass = cn(
                    "border-b last:border-0 transition-colors",
                    clickable && "cursor-pointer hover:bg-muted/40",
                  );
                  const onActivate = () => {
                    if (r.revenueEntryId) onSelectRevenueEntry(r.revenueEntryId);
                  };
                  return (
                    <tr
                      key={r.key}
                      className={rowClass}
                      onClick={clickable ? onActivate : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onActivate();
                              }
                            }
                          : undefined
                      }
                      tabIndex={clickable ? 0 : undefined}
                      role={clickable ? "button" : undefined}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDateCell(r)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        <span className="line-clamp-2">{r.description}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={
                            r.kind === "product"
                              ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                              : "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
                          }
                        >
                          {r.kind === "product" ? "Produto" : "Serviço"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.categoryLabel}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatQty(r.quantity)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-semibold tabular-nums",
                          r.kind === "product"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-sky-700 dark:text-sky-400",
                        )}
                      >
                        {formatCurrency(r.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Página {safePage} de {pageCount}
              {serviceSales.length > 0 ? (
                <>
                  {" · "}
                  Catálogo em{" "}
                  <Link
                    to="/app/servicos"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Serviços
                  </Link>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="vendas-list-page-size" className="sr-only">
                  Itens por página
                </Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v) as TablePageSize);
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    id="vendas-list-page-size"
                    size="sm"
                    className="w-[8.5rem]"
                    aria-label="Itens por página"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size} por página
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Seguinte
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

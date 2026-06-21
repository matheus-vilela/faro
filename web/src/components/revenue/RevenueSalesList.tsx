import { Pagination } from "@/components/Pagination";
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
import { tipoBadge } from "@/lib/companyCategoryLabels";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { RevenueEntry, RevenueEntryMode } from "@/types/revenue";
import type { LucideIcon } from "lucide-react";
import {
  ChefHat,
  ChevronRight,
  FileText,
  LayoutList,
  Loader2,
  Package,
  Receipt,
  Search,
  Table2,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";

export type RevenuePeriodSummary = {
  count: number;
  gross: number;
  tax: number;
  net: number;
};

export type RevenueSalesListProps = {
  rows: RevenueEntry[];
  totalCount: number;
  page: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  entryModeFilter: string;
  onEntryModeFilterChange: (value: string) => void;
  revenueTypeFilter: string;
  onRevenueTypeFilterChange: (value: string) => void;
  periodSummary: RevenuePeriodSummary | null;
  summaryLoading: boolean;
  categoriesById: Map<string, CompanyCategory>;
  categoryPathLabel: (
    leafId: string,
    map: Map<string, CompanyCategory>,
  ) => string;
  productNameById: Map<string, string>;
  recipeNameById: Map<string, string>;
  formatCurrency: (v: number) => string;
  formatDate: (isoDate: string) => string;
  revenueTypeLabels: Record<string, string>;
  entryModeLabels: Record<string, string>;
  onSelectEntry: (id: string) => void;
};

type SalesViewMode = "list" | "table";

const VIEW_MODE_STORAGE_KEY = "faro-vendas-view-mode";

const ENTRY_MODE_META: Record<
  RevenueEntryMode,
  { icon: LucideIcon; accent: string; badgeClass: string }
> = {
  manual: {
    icon: FileText,
    accent: "border-l-slate-500/90",
    badgeClass:
      "border-slate-500/25 bg-slate-500/8 text-slate-800 dark:text-slate-200",
  },
  product_sale: {
    icon: Package,
    accent: "border-l-emerald-600/90",
    badgeClass:
      "border-emerald-600/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  },
  recipe_sale: {
    icon: ChefHat,
    accent: "border-l-violet-600/90",
    badgeClass:
      "border-violet-600/25 bg-violet-500/10 text-violet-900 dark:text-violet-100",
  },
};

function readStoredViewMode(): SalesViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (v === "list" || v === "table") return v;
  } catch {
    /* ignore */
  }
  return "table";
}

function formatEntryDateParts(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  return {
    day: d.toLocaleDateString("pt-BR", { day: "2-digit" }),
    monthYear: d.toLocaleDateString("pt-BR", {
      month: "short",
      year: "numeric",
    }),
    weekday: d.toLocaleDateString("pt-BR", { weekday: "short" }),
  };
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: SalesViewMode;
  onChange: (mode: SalesViewMode) => void;
}) {
  return (
    <div
      className="flex shrink-0 rounded-lg border border-border bg-muted/30 p-0.5"
      role="group"
      aria-label="Forma de visualização"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 gap-1.5 px-2.5",
          value === "table" && "bg-background shadow-sm",
        )}
        aria-pressed={value === "table"}
        onClick={() => onChange("table")}
      >
        <Table2 className="h-4 w-4" />
        <span className="hidden sm:inline">Tabela</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 gap-1.5 px-2.5",
          value === "list" && "bg-background shadow-sm",
        )}
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
      >
        <LayoutList className="h-4 w-4" />
        <span className="hidden sm:inline">Lista</span>
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 rounded-xl border border-border bg-card p-4"
        >
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-2/3 max-w-xs animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="flex gap-2">
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
          <div className="hidden h-12 w-24 animate-pulse rounded bg-muted sm:block" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-border">
      <div className="h-10 animate-pulse bg-muted/50" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex h-12 gap-4 border-t border-border px-4 py-2"
        >
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

type RowContext = {
  mode: RevenueEntryMode;
  meta: (typeof ENTRY_MODE_META)[RevenueEntryMode];
  ModeIcon: LucideIcon;
  dateParts: ReturnType<typeof formatEntryDateParts>;
  cat: CompanyCategory | undefined;
  catLabel: string;
  subtitle: string | null;
};

function buildRowContext(
  r: RevenueEntry,
  categoriesById: Map<string, CompanyCategory>,
  categoryPathLabel: (
    leafId: string,
    map: Map<string, CompanyCategory>,
  ) => string,
  productNameById: Map<string, string>,
  recipeNameById: Map<string, string>,
): RowContext {
  const mode = (
    r.entry_mode in ENTRY_MODE_META ? r.entry_mode : "manual"
  ) as RevenueEntryMode;
  const meta = ENTRY_MODE_META[mode];
  let subtitle: string | null = null;
  if (r.entry_mode === "product_sale" && r.product_id) {
    subtitle = productNameById.get(r.product_id) ?? r.product_id;
  } else if (r.entry_mode === "recipe_sale" && r.recipe_id) {
    subtitle = recipeNameById.get(r.recipe_id) ?? r.recipe_id;
  }
  return {
    mode,
    meta,
    ModeIcon: meta.icon,
    dateParts: formatEntryDateParts(r.entry_date),
    cat: categoriesById.get(r.subcategory_id),
    catLabel: categoryPathLabel(r.subcategory_id, categoriesById),
    subtitle,
  };
}

function OriginBadge({
  meta,
  ModeIcon,
  entryModeLabels,
  entryMode,
}: {
  meta: RowContext["meta"];
  ModeIcon: LucideIcon;
  entryModeLabels: Record<string, string>;
  entryMode: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-[11px] font-normal whitespace-nowrap",
        meta.badgeClass,
      )}
    >
      <ModeIcon className="h-3 w-3 shrink-0" aria-hidden />
      {entryModeLabels[entryMode] ?? entryMode}
    </Badge>
  );
}

function RevenueSalesListView({
  rows,
  viewMode,
  categoriesById,
  categoryPathLabel,
  productNameById,
  recipeNameById,
  formatCurrency,
  formatDate,
  revenueTypeLabels,
  entryModeLabels,
  onSelectEntry,
}: {
  rows: RevenueEntry[];
  viewMode: SalesViewMode;
  categoriesById: Map<string, CompanyCategory>;
  categoryPathLabel: (
    leafId: string,
    map: Map<string, CompanyCategory>,
  ) => string;
  productNameById: Map<string, string>;
  recipeNameById: Map<string, string>;
  formatCurrency: (v: number) => string;
  formatDate: (isoDate: string) => string;
  revenueTypeLabels: Record<string, string>;
  entryModeLabels: Record<string, string>;
  onSelectEntry: (id: string) => void;
}) {
  if (viewMode === "table") {
    return (
      <div className="w-full overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[7.5rem]" />
            <col />
            <col className="w-[10.5rem]" />
            <col className="w-[8.5rem]" />
            <col className="w-[18rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[7rem]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Data</th>
              <th className="px-4 py-3 font-semibold">Título</th>
              <th className="px-4 py-3 font-semibold">Origem</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 font-semibold">Categoria</th>
              <th className="px-4 py-3 text-right font-semibold">Bruto</th>
              <th className="px-4 py-3 text-right font-semibold">Taxa</th>
              <th className="px-4 py-3 text-right font-semibold">Líquido</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ctx = buildRowContext(
                r,
                categoriesById,
                categoryPathLabel,
                productNameById,
                recipeNameById,
              );
              return (
                <tr
                  key={r.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => onSelectEntry(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && onSelectEntry(r.id)}
                  className="group cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none"
                >
                  <td className="px-4 py-3 align-middle">
                    <span className="font-medium tabular-nums text-foreground">
                      {formatDate(r.entry_date)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {r.title}
                      </p>
                      {ctx.subtitle ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {ctx.subtitle}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <OriginBadge
                      meta={ctx.meta}
                      ModeIcon={ctx.ModeIcon}
                      entryModeLabels={entryModeLabels}
                      entryMode={r.entry_mode}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Badge
                      variant="secondary"
                      className="text-[11px] font-normal"
                    >
                      {revenueTypeLabels[r.revenue_type] ?? r.revenue_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span
                      className="block truncate text-foreground"
                      title={ctx.catLabel}
                    >
                      {ctx.catLabel || "—"}
                    </span>
                    {ctx.cat ? (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {tipoBadge(ctx.cat)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right align-middle tabular-nums text-muted-foreground">
                    {formatCurrency(Number(r.gross_amount))}
                  </td>
                  <td className="px-4 py-3 text-right align-middle tabular-nums text-muted-foreground">
                    −{formatCurrency(Number(r.tax_amount))}
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatCurrency(Number(r.net_amount))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const ctx = buildRowContext(
          r,
          categoriesById,
          categoryPathLabel,
          productNameById,
          recipeNameById,
        );
        return (
          <li key={r.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectEntry(r.id)}
              onKeyDown={(e) => e.key === "Enter" && onSelectEntry(r.id)}
              className={cn(
                "group flex cursor-pointer flex-col gap-4 rounded-xl border border-l-[3px] bg-card p-4 transition-all sm:flex-row sm:items-stretch",
                "hover:border-border/90 hover:bg-muted/20 hover:shadow-sm",
                ctx.meta.accent,
              )}
            >
              <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-center sm:justify-center sm:px-1">
                <div className="flex h-15 w-15 flex-col items-center justify-center rounded-xl border border-border bg-muted/40 text-center shadow-sm">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {ctx.dateParts.weekday}
                  </span>
                  <span className="text-xl font-bold tabular-nums leading-none text-foreground">
                    {ctx.dateParts.day}
                  </span>
                  <span className="mt-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                    {ctx.dateParts.monthYear}
                  </span>
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-base font-semibold leading-snug tracking-tight">
                      {r.title}
                    </p>
                    {ctx.subtitle ? (
                      <p className="truncate text-sm text-muted-foreground">
                        <ctx.ModeIcon className="mr-1 inline h-3.5 w-3.5 opacity-70" />
                        {ctx.subtitle}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                    aria-hidden
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <OriginBadge
                    meta={ctx.meta}
                    ModeIcon={ctx.ModeIcon}
                    entryModeLabels={entryModeLabels}
                    entryMode={r.entry_mode}
                  />
                  <Badge
                    variant="secondary"
                    className="text-[11px] font-normal"
                  >
                    {revenueTypeLabels[r.revenue_type] ?? r.revenue_type}
                  </Badge>
                  {ctx.cat ? (
                    <Badge
                      variant="outline"
                      className="text-[11px] font-normal"
                    >
                      {tipoBadge(ctx.cat)}
                    </Badge>
                  ) : null}
                </div>

                <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Data da venda</dt>
                    <dd className="mt-0.5 font-medium text-foreground">
                      {formatDate(r.entry_date)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Categoria</dt>
                    <dd className="mt-0.5 truncate font-medium text-foreground">
                      {ctx.catLabel || "—"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex shrink-0 flex-row items-center justify-between gap-3 border-t border-border/60 pt-3 sm:w-42 sm:flex-col sm:items-stretch sm:justify-between sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <div className="sm:text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Líquido
                  </p>
                  <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                    {formatCurrency(Number(r.net_amount))}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    Bruto {formatCurrency(Number(r.gross_amount))}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    Taxa −{formatCurrency(Number(r.tax_amount))}
                  </p>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  return (
    <div className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Receipt className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="mt-4 text-base font-medium text-foreground">
        {hasActiveFilters
          ? "Nenhuma venda com esses filtros"
          : "Nenhuma venda neste período"}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasActiveFilters
          ? "Ajuste a busca ou os filtros, ou altere o mês de competência acima."
          : "Registre a primeira venda com o botão «Nova venda» no topo da página."}
      </p>
    </div>
  );
}

export function RevenueSalesList(props: RevenueSalesListProps) {
  const {
    rows,
    totalCount,
    page,
    onPageChange,
    loading,
    search,
    onSearchChange,
    entryModeFilter,
    onEntryModeFilterChange,
    revenueTypeFilter,
    onRevenueTypeFilterChange,
    categoriesById,
    categoryPathLabel,
    productNameById,
    recipeNameById,
    formatCurrency,
    formatDate,
    revenueTypeLabels,
    entryModeLabels,
    onSelectEntry,
  } = props;

  const [viewMode, setViewMode] = useState<SalesViewMode>(readStoredViewMode);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    entryModeFilter !== "all" ||
    revenueTypeFilter !== "all";

  return (
    <section className="w-full max-w-none space-y-4">
      <div className="w-full rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <h2 className="text-base font-semibold tracking-tight">
                    Vendas no período
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  {viewMode === "table"
                    ? "Visualização em tabela — clique na linha para detalhes"
                    : "Visualização em lista — clique no card para detalhes"}
                </p>
              </div>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </div>
            <div className="flex w-full min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap xl:max-w-3xl xl:justify-end">
              <div className="relative min-w-0 flex-1 sm:min-w-48">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por título…"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="h-10 w-full pl-9"
                />
              </div>
              <Select
                value={entryModeFilter}
                onValueChange={onEntryModeFilterChange}
              >
                <SelectTrigger className="h-10 w-full sm:w-44">
                  <SelectValue placeholder="Origem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as origens</SelectItem>
                  <SelectItem value="manual">Lançamento manual</SelectItem>
                  <SelectItem value="product_sale">Venda de produto</SelectItem>
                  <SelectItem value="recipe_sale">Venda por ficha</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={revenueTypeFilter}
                onValueChange={onRevenueTypeFilterChange}
              >
                <SelectTrigger className="h-10 w-full sm:w-44">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="operational">Operacional</SelectItem>
                  <SelectItem value="non_operational">
                    Não operacional
                  </SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0 text-muted-foreground"
                  onClick={() => {
                    onSearchChange("");
                    onEntryModeFilterChange("all");
                    onRevenueTypeFilterChange("all");
                  }}
                >
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="w-full p-4 sm:p-5">
          {loading && rows.length === 0 ? (
            viewMode === "table" ? (
              <TableSkeleton />
            ) : (
              <ListSkeleton />
            )
          ) : rows.length === 0 ? (
            <EmptyState hasActiveFilters={hasActiveFilters} />
          ) : (
            <RevenueSalesListView
              rows={rows}
              viewMode={viewMode}
              categoriesById={categoriesById}
              categoryPathLabel={categoryPathLabel}
              productNameById={productNameById}
              recipeNameById={recipeNameById}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              revenueTypeLabels={revenueTypeLabels}
              entryModeLabels={entryModeLabels}
              onSelectEntry={onSelectEntry}
            />
          )}

          {!loading && rows.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {totalCount === 1
                  ? "1 venda"
                  : `${totalCount.toLocaleString("pt-BR")} vendas`}
                {hasActiveFilters ? " (filtro ativo)" : ""}
              </p>
              <Pagination
                page={page}
                totalCount={totalCount}
                onPageChange={onPageChange}
              />
            </div>
          ) : null}

          {loading && rows.length > 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Atualizando…
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

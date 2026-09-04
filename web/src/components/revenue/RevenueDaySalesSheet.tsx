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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  DaySaleItemCard,
  DaySaleKindBadge,
  DaySaleOriginBadge,
  STOCK_ONLY_ORIGIN_LABEL,
  daySaleFromRevenueEntry,
  daySaleFromService,
  daySaleFromStockOnly,
  daySaleOriginLabel,
  type DaySaleKind,
  type DaySaleListItem,
} from "@/components/revenue/RevenueDaySaleListCard";
import { SaleFamilyLinkSheet } from "@/components/products/SaleFamilyLinkSheet";
import type { RevenueCalendarDayListPayload } from "@/components/revenue/RevenueEntriesCalendar";
import { useCompany } from "@/contexts/CompanyContext";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  canShowEpocDaySalesSyncButton,
  ymdToEpocConsultaDiaBr,
} from "@/lib/epocDaySalesSync";
import {
  listEstoqueSemVendaNaoVinculado,
} from "@/lib/epocEstoqueVsVendas";
import { isOnboardingPdvSyncInProgress } from "@/lib/onboardingPdvDefaults";
import {
  fetchLinkedSaleFamilyVariantKeys,
  fetchPersistedDayStockOuts,
} from "@/lib/productSaleFamily";
import { supabase } from "@/lib/supabase";
import { invokeEpocCsvSync } from "@/services/epocSyncCsvService";
import type { EpocEstoqueSaidaItem } from "@/services/epocEstoqueExportService";
import { cn } from "@/lib/utils";
import { ArrowDownAZ, ArrowUpAZ, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type KindFilter = "all" | DaySaleKind;
type OriginFilter = "all" | "sale" | "stock_only";
type SortKey =
  | "kind"
  | "name"
  | "origin"
  | "quantity"
  | "unitPrice"
  | "gross"
  | "tax"
  | "net";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "kind", label: "Tipo" },
  { value: "name", label: "Nome" },
  { value: "origin", label: "Origem" },
  { value: "quantity", label: "Quantidade" },
  { value: "unitPrice", label: "Preço unit." },
  { value: "gross", label: "Total bruto" },
  { value: "tax", label: "Taxa" },
  { value: "net", label: "Total líquido" },
];

function compareDaySaleItems(
  a: DaySaleListItem,
  b: DaySaleListItem,
  key: SortKey,
): number {
  let cmp = 0;
  if (key === "name" || key === "kind") {
    cmp = String(a[key]).localeCompare(String(b[key]), "pt-BR", {
      sensitivity: "base",
    });
  } else if (key === "origin") {
    cmp = daySaleOriginLabel(a).localeCompare(daySaleOriginLabel(b), "pt-BR", {
      sensitivity: "base",
    });
  } else {
    cmp = Number(a[key]) - Number(b[key]);
  }
  if (cmp === 0) {
    cmp = a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  }
  return cmp;
}

export function RevenueDaySalesSheet({
  payload,
  open,
  onOpenChange,
  formatCurrency,
  onProductClick,
  onEpocDaySynced,
}: {
  payload: RevenueCalendarDayListPayload | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formatCurrency: (v: number) => string;
  onProductClick?: (revenueEntryId: string) => void;
  onEpocDaySynced?: () => void | Promise<void>;
}) {
  const { currentCompany } = useCompany();
  const viewMode = useSheetListView();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [search, setSearch] = useState("");
  const [showEpocSync, setShowEpocSync] = useState(false);
  const [epocSyncing, setEpocSyncing] = useState(false);
  const [stockPending, setStockPending] = useState<EpocEstoqueSaidaItem[]>([]);
  const [stockTick, setStockTick] = useState(0);
  const [linkItem, setLinkItem] = useState<EpocEstoqueSaidaItem | null>(null);

  const companyId = currentCompany?.id;
  const dateKey = payload?.dateKey;
  const saleIdsKey = payload?.items.map((e) => e.id).join(",") ?? "";
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    if (!open) return;
    setKindFilter("all");
    setOriginFilter("all");
    setSearch("");
    setShowEpocSync(false);
    setEpocSyncing(false);
    setStockPending([]);
    setLinkItem(null);
  }, [open, payload?.dateKey]);

  useEffect(() => {
    if (!open || !companyId || !dateKey) {
      setShowEpocSync(false);
      return;
    }
    let cancelled = false;
    void canShowEpocDaySalesSyncButton({ companyId, dateKey }).then((show) => {
      if (!cancelled) setShowEpocSync(show);
    });
    return () => {
      cancelled = true;
    };
  }, [open, companyId, dateKey]);

  useEffect(() => {
    if (!open || !companyId || !dateKey) {
      setStockPending([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const day = payloadRef.current;
      if (!day) return;
      try {
        const productIds = [
          ...new Set(
            day.items
              .map((e) => e.product_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const [{ data: products }, linked, stockRows] = await Promise.all([
          productIds.length > 0
            ? supabase.from("products").select("id, sku, name").in("id", productIds)
            : Promise.resolve({ data: [] as Array<{ id: string; sku: string | null; name: string }> }),
          fetchLinkedSaleFamilyVariantKeys(companyId),
          fetchPersistedDayStockOuts(companyId, dateKey),
        ]);
        if (cancelled) return;
        const skuById = new Map(
          (products ?? []).map((p) => [
            p.id,
            { sku: p.sku, name: p.name },
          ]),
        );
        const vendas = day.items.map((e) => {
          const prod = e.product_id ? skuById.get(e.product_id) : undefined;
          return {
            sku: prod?.sku ?? null,
            nome: e.title?.trim() || prod?.name || "",
            qtde: e.quantity,
            total: e.gross_amount,
          };
        });
        const estoque: EpocEstoqueSaidaItem[] = stockRows.map((r) => ({
          sku: r.sku,
          nome: r.nome,
          categorias: [],
          categoria_path: "",
          acao: "Saída",
          obs: "",
          qtde: r.qtde,
          qtde_unidade: r.qtde_unidade,
          qtde_raw: "",
          qtde_volume_saida: null,
          custo_total: null,
        }));
        setStockPending(
          listEstoqueSemVendaNaoVinculado(estoque, vendas, linked),
        );
      } catch (e) {
        if (!cancelled) {
          console.warn(
            "[RevenueDaySalesSheet] estoque persistido",
            e instanceof Error ? e.message : e,
          );
          setStockPending([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, companyId, dateKey, saleIdsKey, stockTick]);

  const allItems = useMemo(() => {
    if (!payload) return [] as DaySaleListItem[];
    return [
      ...stockPending.map(daySaleFromStockOnly),
      ...payload.items.map(daySaleFromRevenueEntry),
      ...payload.serviceItems.map(daySaleFromService),
    ];
  }, [payload, stockPending]);

  const saleNames = useMemo(
    () => (payload?.items ?? []).map((e) => e.title?.trim() || "").filter(Boolean),
    [payload],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (originFilter === "stock_only" && item.origin !== "stock_only") {
        return false;
      }
      if (originFilter === "sale" && item.origin === "stock_only") {
        return false;
      }
      if (term && !item.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [allItems, kindFilter, originFilter, search]);

  const { sorted: filteredSorted, sortKey, sortAsc, onSort } =
    useClientTableSort<DaySaleListItem, SortKey>(
      filtered,
      "net",
      compareDaySaleItems,
      false,
    );

  const totals = useMemo(() => {
    let gross = 0;
    let tax = 0;
    let net = 0;
    for (const item of filteredSorted) {
      if (item.origin === "stock_only") continue;
      gross += item.gross;
      tax += item.tax;
      net += item.net;
    }
    const revenueCount = filteredSorted.filter(
      (i) => i.origin !== "stock_only",
    ).length;
    const pendingFamily = filteredSorted.filter(
      (i) => i.origin === "stock_only",
    ).length;
    return { gross, tax, net, count: revenueCount, pendingFamily };
  }, [filteredSorted]);

  const productCount = allItems.filter((i) => i.kind === "product").length;
  const serviceCount = allItems.filter((i) => i.kind === "service").length;

  const handleEpocDaySync = async () => {
    if (!companyId || !dateKey) return;
    if (isOnboardingPdvSyncInProgress(currentCompany?.onboarding_pdv)) {
      toast.error(
        "Sincronização PDV do onboarding em curso. Aguarde concluir para buscar este dia.",
      );
      return;
    }
    const diaBr = ymdToEpocConsultaDiaBr(dateKey);
    if (!diaBr) {
      toast.error("Data inválida para sincronizar no EPOC.");
      return;
    }
    setEpocSyncing(true);
    try {
      const res = await invokeEpocCsvSync(companyId, {
        consulta_dias_br: [diaBr],
      });
      if (!res.ok) {
        toast.error(
          res.error?.slice(0, 240) ??
            "Não foi possível sincronizar este dia no EPOC.",
        );
        return;
      }
      setShowEpocSync(false);
      if (res.continuing) {
        toast.message(
          res.message?.trim() ||
            "Busca deste dia iniciada no EPOC — o import continua em segundo plano.",
          { duration: 7000 },
        );
      } else {
        toast.success(
          "Busca deste dia concluída no EPOC. Se houver vendas, o import entra na fila.",
        );
      }
      await onEpocDaySynced?.();
      setStockTick((n) => n + 1);
    } finally {
      setEpocSyncing(false);
    }
  };

  const hasActiveFilters =
    kindFilter !== "all" || originFilter !== "all" || search.trim() !== "";
  const stockOnlyCount = allItems.filter((i) => i.origin === "stock_only").length;

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
              {hasActiveFilters ? " (filtrado)" : ""}
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
                  {totals.pendingFamily > 0
                    ? ` · ${totals.pendingFamily} somente estoque`
                    : ""}
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
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por nome…"
                className="h-9 pl-8"
              />
            </div>
            <Select
              value={originFilter}
              onValueChange={(v) => setOriginFilter(v as OriginFilter)}
            >
              <SelectTrigger className="h-9 w-full sm:w-48" aria-label="Origem">
                <SelectValue placeholder="Origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as origens</SelectItem>
                <SelectItem value="sale">Venda</SelectItem>
                <SelectItem value="stock_only">
                  {STOCK_ONLY_ORIGIN_LABEL}
                  {stockOnlyCount > 0 ? ` (${stockOnlyCount})` : ""}
                </SelectItem>
              </SelectContent>
            </Select>
            {viewMode === "cards" ? (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Select
                  value={sortKey}
                  onValueChange={(v) => {
                    const key = v as SortKey;
                    if (key !== sortKey) onSort(key);
                  }}
                >
                  <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Ordenar por">
                    <SelectValue placeholder="Ordenar por" />
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
                  aria-label={sortAsc ? "Ordem crescente" : "Ordem decrescente"}
                  onClick={() => onSort(sortKey)}
                >
                  {sortAsc ? (
                    <ArrowUpAZ className="size-4" />
                  ) : (
                    <ArrowDownAZ className="size-4" />
                  )}
                </Button>
              </div>
            ) : null}
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 text-muted-foreground"
                onClick={() => {
                  setKindFilter("all");
                  setOriginFilter("all");
                  setSearch("");
                }}
              >
                Limpar filtros
              </Button>
            ) : null}
            {showEpocSync ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={epocSyncing}
                onClick={() => void handleEpocDaySync()}
              >
                {epocSyncing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                Sincronizar no EPOC
              </Button>
            ) : null}
          </div>
          {totals.pendingFamily > 0 ? (
            <p className="text-amber-900 dark:text-amber-100 text-xs">
              Itens só no estoque não entram no total faturado. Vincule à
              família de cardápio se for variante.
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {filteredSorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {allItems.length === 0
                ? showEpocSync
                  ? "Nenhuma venda neste dia. Pode buscar este dia no EPOC para normalizar a base."
                  : "Nenhuma venda neste dia."
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
                        onConfigureFamily={
                          item.origin === "stock_only"
                            ? () => {
                                const found = stockPending.find(
                                  (s) =>
                                    `stock-only:${s.sku}:${s.nome}` === item.id,
                                );
                                if (found) setLinkItem(found);
                              }
                            : undefined
                        }
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
              <table className="w-full min-w-180 border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <SortableTableHead
                      label="Tipo"
                      column="kind"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                    />
                    <SortableTableHead
                      label="Nome"
                      column="name"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                    />
                    <SortableTableHead
                      label="Origem"
                      column="origin"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                    />
                    <SortableTableHead
                      label="Qtd"
                      column="quantity"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Preço unit."
                      column="unitPrice"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Total bruto"
                      column="gross"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Taxa"
                      column="tax"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Total líquido"
                      column="net"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.map((item) => {
                    const isStockOnly = item.origin === "stock_only";
                    const clickable =
                      !isStockOnly &&
                      item.kind === "product" &&
                      item.revenueEntryId &&
                      onProductClick;
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-b last:border-0",
                          isStockOnly && "bg-amber-500/6",
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
                          <DaySaleKindBadge item={item} />
                        </td>
                        <td className="max-w-56 truncate px-3 py-2 font-medium">
                          {item.name}
                          {isStockOnly ? (
                            <button
                              type="button"
                              className="mt-0.5 block text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                const found = stockPending.find(
                                  (s) =>
                                    `stock-only:${s.sku}:${s.nome}` === item.id,
                                );
                                if (found) setLinkItem(found);
                              }}
                            >
                              Vincular à família
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <DaySaleOriginBadge item={item} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {item.quantity.toLocaleString("pt-BR", {
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {isStockOnly ? "—" : formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {isStockOnly ? "—" : formatCurrency(item.gross)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700 dark:text-rose-400">
                          {isStockOnly ? "—" : formatCurrency(item.tax)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-semibold tabular-nums",
                            isStockOnly
                              ? "text-muted-foreground"
                              : item.kind === "product"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-sky-700 dark:text-sky-400",
                          )}
                        >
                          {isStockOnly ? "—" : formatCurrency(item.net)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 text-xs font-semibold">
                    <td className="px-3 py-2" colSpan={5}>
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

        {companyId ? (
          <SaleFamilyLinkSheet
            open={linkItem != null}
            onOpenChange={(next) => {
              if (!next) setLinkItem(null);
            }}
            companyId={companyId}
            saleNames={saleNames}
            variantName={linkItem?.nome}
            variantSku={linkItem?.sku}
            variantUnit={linkItem?.qtde_unidade || "un"}
            onLinked={() => {
              if (linkItem) {
                setStockPending((prev) =>
                  prev.filter(
                    (s) =>
                      !(
                        s.sku === linkItem.sku && s.nome === linkItem.nome
                      ),
                  ),
                );
              }
              setLinkItem(null);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

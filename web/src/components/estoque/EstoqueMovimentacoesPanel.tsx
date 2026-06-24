import { ProductMergeMovementPair } from "@/components/estoque/ProductMergeMovementPair";
import { RegisterManualStockMovementSheet } from "@/components/estoque/RegisterManualStockMovementSheet";
import { StockMovementOriginCell } from "@/components/estoque/StockMovementOriginCell";
import { StockMovementTypeBadge } from "@/components/estoque/StockMovementTypeBadge";
import { ProductMergeMovementUndoButton } from "@/components/products/ProductMergeAuditSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyStockMovementClassificationFilter,
  MOVEMENT_CLASSIFICATION_FILTER_OPTIONS,
  movementClassificationDisplayLabel,
  type MovementClassificationFilter,
} from "@/lib/stockMovementClassification";
import { resolveExpenseIdsForStockMovements } from "@/lib/stockMovementExpenseLink";
import {
  applyStockMovementDirectionFilter,
  type FilterableQuery,
  type MovementDirectionFilter,
} from "@/lib/stockMovementFilters";
import { stockMovementMergePairDisplay } from "@/lib/stockMovementMergeDisplay";
import { supabase } from "@/lib/supabase";
import {
  stockMovementMergeUndoProps,
  type StockMovementProductMergeMeta,
} from "@/types/productMergeAudit";
import { Loader2, Plus, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  product_id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  unit_cost: number | null;
  metadata_json:
    | (StockMovementProductMergeMeta & {
        quantity_unit?: string;
        classification?: string;
        movement_kind?: string;
      })
    | null;
  expense_id: string | null;
  products: { name: string; unit: string } | null;
};

type ProductOption = { id: string; name: string };

function createdAtFilterBounds(
  from: string,
  to: string,
): { gte?: string; lte?: string } | null {
  if (!from.trim() && !to.trim()) return null;
  const gte = from.trim()
    ? new Date(`${from.trim()}T00:00:00.000`).toISOString()
    : undefined;
  const lte = to.trim()
    ? new Date(`${to.trim()}T23:59:59.999`).toISOString()
    : undefined;
  if (!gte && !lte) return null;
  return { gte, lte };
}
function movementQuantityUnit(row: Row): string {
  const fromMeta = row.metadata_json?.quantity_unit?.trim();
  const fromProduct = row.products?.unit?.trim();
  return fromMeta || fromProduct || "un";
}

function summarizeMovements(
  rows: {
    quantity: number;
    type: string;
    unit_cost: number | null;
    reference_type: string | null;
  }[],
): Omit<MovementStats, "totalCount"> {
  let entriesValue = 0;
  let exitsValue = 0;
  let entriesHasCost = false;
  let exitsHasCost = false;
  for (const row of rows) {
    if (
      row.reference_type === "product_merge" ||
      row.reference_type === "product_merge_undo"
    ) {
      continue;
    }
    const cost = row.unit_cost != null ? Number(row.unit_cost) : NaN;
    if (!Number.isFinite(cost)) continue;
    const value = movementLineValue(row);
    if (row.type === "in") {
      entriesHasCost = true;
      entriesValue += value;
    } else {
      exitsHasCost = true;
      exitsValue += value;
    }
  }
  return { entriesValue, exitsValue, entriesHasCost, exitsHasCost };
}

type MovementStats = {
  totalCount: number;
  entriesValue: number;
  exitsValue: number;
  entriesHasCost: boolean;
  exitsHasCost: boolean;
};

const EMPTY_STATS: MovementStats = {
  totalCount: 0,
  entriesValue: 0,
  exitsValue: 0,
  entriesHasCost: false,
  exitsHasCost: false,
};

function movementLineValue(row: {
  quantity: number;
  unit_cost: number | null;
}): number {
  const cost = row.unit_cost != null ? Number(row.unit_cost) : NaN;
  const qty = Number(row.quantity);
  if (!Number.isFinite(cost) || !Number.isFinite(qty)) return 0;
  return qty * cost;
}

export function EstoqueMovimentacoesPanel({
  companyId,
  onStockChanged,
}: {
  companyId: string;
  onStockChanged?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [stats, setStats] = useState<MovementStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilterId, setProductFilterId] = useState("");
  const [directionFilter, setDirectionFilter] =
    useState<MovementDirectionFilter>("all");
  const [classificationFilter, setClassificationFilter] =
    useState<MovementClassificationFilter>("all");
  const [registerSheetOpen, setRegisterSheetOpen] = useState(false);

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        dateFrom ||
        dateTo ||
        productFilterId ||
        directionFilter !== "all" ||
        classificationFilter !== "all",
      ),
    [dateFrom, dateTo, productFilterId, directionFilter, classificationFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const dateBounds = createdAtFilterBounds(dateFrom, dateTo);

    const productsRes = await supabase
      .from("products")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name");

    setProducts((productsRes.data ?? []) as ProductOption[]);

    // Tipagem loose: PostgrestFilterBuilder recursivo estoura o limite do tsc -b.
    let listQuery: FilterableQuery = supabase
      .from("stock_movements")
      .select(
        "id, product_id, quantity, type, reference_type, reference_id, created_at, unit_cost, metadata_json, products!inner(name, unit, company_id)",
      )
      .eq("products.company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(250) as unknown as FilterableQuery;

    if (productFilterId) {
      listQuery = listQuery.eq("product_id", productFilterId);
    }
    listQuery = applyStockMovementDirectionFilter(listQuery, directionFilter);
    listQuery = applyStockMovementClassificationFilter(
      listQuery,
      classificationFilter,
    );
    if (dateBounds?.gte) {
      listQuery = (
        listQuery as FilterableQuery & {
          gte: (column: string, value: string) => FilterableQuery;
        }
      ).gte("created_at", dateBounds.gte);
    }
    if (dateBounds?.lte) {
      listQuery = (
        listQuery as FilterableQuery & {
          lte: (column: string, value: string) => FilterableQuery;
        }
      ).lte("created_at", dateBounds.lte);
    }

    const filteredListRes = await (listQuery as unknown as PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>);

    if (filteredListRes.error) {
      console.error(filteredListRes.error);
      setRows([]);
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    const base = (filteredListRes.data ?? []) as unknown as Omit<
      Row,
      "expense_id"
    >[];
    const enriched = await resolveExpenseIdsForStockMovements(base);
    setRows(enriched as Row[]);

    const productIds = (productsRes.data ?? []).map((p) => p.id);
    if (productIds.length === 0) {
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    let aggQuery: FilterableQuery = supabase
      .from("stock_movements")
      .select("quantity, type, unit_cost, reference_type", { count: "exact" });

    if (productFilterId) {
      aggQuery = aggQuery.eq("product_id", productFilterId);
    } else {
      aggQuery = (
        aggQuery as FilterableQuery & {
          in: (column: string, values: string[]) => FilterableQuery;
        }
      ).in("product_id", productIds);
    }
    aggQuery = applyStockMovementDirectionFilter(aggQuery, directionFilter);
    aggQuery = applyStockMovementClassificationFilter(
      aggQuery,
      classificationFilter,
    );
    if (dateBounds?.gte) {
      aggQuery = (
        aggQuery as FilterableQuery & {
          gte: (column: string, value: string) => FilterableQuery;
        }
      ).gte("created_at", dateBounds.gte);
    }
    if (dateBounds?.lte) {
      aggQuery = (
        aggQuery as FilterableQuery & {
          lte: (column: string, value: string) => FilterableQuery;
        }
      ).lte("created_at", dateBounds.lte);
    }

    const {
      count,
      data: aggData,
      error: aggError,
    } = await (aggQuery as unknown as PromiseLike<{
      count: number | null;
      data:
        | { quantity: number; type: string; unit_cost: number | null }[]
        | null;
      error: { message: string } | null;
    }>);

    if (aggError) {
      console.error(aggError);
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    setStats({
      totalCount: count ?? 0,
      ...summarizeMovements(aggData ?? []),
    });
    setLoading(false);
  }, [
    companyId,
    dateFrom,
    dateTo,
    productFilterId,
    directionFilter,
    classificationFilter,
  ]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const formatMoney = (v: number | null) =>
    v == null || Number.isNaN(v)
      ? "—"
      : new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(v);

  const formatBRL = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setProductFilterId("");
    setDirectionFilter("all");
    setClassificationFilter("all");
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4" />
            Movimentações de estoque
          </CardTitle>
          <CardDescription>
            Histórico de entradas, saídas e ajustes vinculados aos produtos da
            empresa. Use os filtros para refinar a lista e os totais.
          </CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => setRegisterSheetOpen(true)}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Registrar movimentação
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-blue-500/35 bg-blue-500/[0.07] px-4 py-3 shadow-sm dark:bg-blue-500/[0.14]">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-blue-950/80 dark:text-blue-50/90">
                Total de movimentações
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-blue-950 dark:text-blue-50">
                {stats.totalCount.toLocaleString("pt-BR")}
              </p>
              <p className="mt-0.5 text-xs text-blue-950/70 dark:text-blue-50/75">
                {hasActiveFilters
                  ? "Com filtros atuais"
                  : "Registros no histórico"}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/[0.08] px-4 py-3 shadow-sm dark:bg-emerald-500/[0.12]">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-950/80 dark:text-emerald-50/90">
                Valor de entradas
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-950 dark:text-emerald-50">
                {stats.entriesHasCost ? formatBRL(stats.entriesValue) : "—"}
              </p>
              <p className="mt-0.5 text-xs text-emerald-950/70 dark:text-emerald-50/75">
                Qtd × custo unitário (entradas)
              </p>
            </div>
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/[0.08] px-4 py-3 shadow-sm dark:bg-rose-500/[0.12]">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-rose-950/80 dark:text-rose-50/90">
                Valor de saídas
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-rose-950 dark:text-rose-50">
                {stats.exitsHasCost ? formatBRL(stats.exitsValue) : "—"}
              </p>
              <p className="mt-0.5 text-xs text-rose-950/70 dark:text-rose-50/75">
                Qtd × custo unitário (saídas)
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/80 bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="mov-date-from"
              className="text-xs text-muted-foreground"
            >
              Data de
            </Label>
            <Input
              id="mov-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="mov-date-to"
              className="text-xs text-muted-foreground"
            >
              Data até
            </Label>
            <Input
              id="mov-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="w-full min-w-[180px] max-w-xs space-y-1.5 sm:w-auto">
            <Label className="text-xs text-muted-foreground">Produto</Label>
            <Select
              value={productFilterId || "__all__"}
              onValueChange={(v) =>
                setProductFilterId(v === "__all__" ? "" : v)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todos os produtos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os produtos</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full min-w-[150px] max-w-[200px] space-y-1.5 sm:w-auto">
            <Label className="text-xs text-muted-foreground">Tipo</Label>
            <Select
              value={directionFilter}
              onValueChange={(v) =>
                setDirectionFilter(v as MovementDirectionFilter)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="in">Entrada</SelectItem>
                <SelectItem value="out">Saída</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-full min-w-[150px] max-w-[220px] space-y-1.5 sm:w-auto">
            <Label className="text-xs text-muted-foreground">
              Classificação
            </Label>
            <Select
              value={classificationFilter}
              onValueChange={(v) =>
                setClassificationFilter(v as MovementClassificationFilter)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENT_CLASSIFICATION_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={clearFilters}
            >
              Limpar filtros
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? "Nenhuma movimentação encontrada para essa combinação de filtros."
              : "Nenhuma movimentação registrada ainda."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="p-2 font-medium">Data</th>
                  <th className="p-2 font-medium">Produto</th>
                  <th className="p-2 font-medium">Tipo</th>
                  <th className="p-2 font-medium">Classificação</th>
                  <th className="p-2 font-medium">Qtd</th>
                  <th className="p-2 font-medium">Custo un.</th>
                  <th className="p-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const winnerName = r.products?.name ?? "—";
                  const qtyUnit = movementQuantityUnit(r);
                  const mergeUndo = stockMovementMergeUndoProps(r);
                  const mergePair = stockMovementMergePairDisplay(
                    r,
                    winnerName,
                  );
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-2">
                        {mergePair ? (
                          <ProductMergeMovementPair {...mergePair} />
                        ) : (
                          <span className="font-medium">{winnerName}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <StockMovementTypeBadge row={r} />
                      </td>
                      <td className="p-2">
                        {mergePair ? (
                          <span className="text-muted-foreground">
                            {movementClassificationDisplayLabel(r)}
                          </span>
                        ) : (
                          <StockMovementOriginCell
                            referenceType={r.reference_type}
                            expenseId={r.expense_id}
                            label={movementClassificationDisplayLabel(r)}
                          />
                        )}
                      </td>
                      <td className="p-2 tabular-nums">
                        {Number(r.quantity).toLocaleString("pt-BR")} {qtyUnit}
                      </td>
                      <td className="p-2 tabular-nums text-muted-foreground">
                        {formatMoney(
                          r.unit_cost != null ? Number(r.unit_cost) : null,
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {mergeUndo.eventId ? (
                          <ProductMergeMovementUndoButton
                            companyId={companyId}
                            eventId={mergeUndo.eventId}
                            loserName={mergeUndo.loserName}
                            undoneAt={mergeUndo.undoneAt}
                            onUndone={() => {
                              void load();
                              onStockChanged?.();
                            }}
                          />
                        ) : r.reference_type === "product_merge_undo" ||
                          r.metadata_json?.undone_at ? (
                          <Badge
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            Desfeita
                          </Badge>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <RegisterManualStockMovementSheet
        companyId={companyId}
        open={registerSheetOpen}
        onOpenChange={setRegisterSheetOpen}
        onSaved={() => {
          void load();
          onStockChanged?.();
        }}
      />
    </Card>
  );
}

import { StockMovementEditSheet } from "@/components/estoque/StockMovementEditSheet";
import { StockMovementTypeBadge } from "@/components/estoque/StockMovementTypeBadge";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { movementClassificationDisplayLabel } from "@/lib/stockMovementClassification";
import type { StockMovementEditRow } from "@/lib/stockMovementEdit";
import {
  attachStockMovementSourceDates,
  formatStockMovementListDate,
  sortStockMovementsByEffectiveDate,
} from "@/lib/stockMovementSaleDate";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type HistoryRow = {
  id: string;
  product_id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  unit_cost: number | null;
  metadata_json?: { classification?: string; quantity_unit?: string } | null;
  products: { name: string; unit: string } | null;
};

export function RecipeMovementHistory({
  companyId,
  recipeId,
  outputProductId,
  active,
}: {
  companyId: string;
  recipeId: string;
  outputProductId?: string | null;
  active: boolean;
}) {
  const [allRows, setAllRows] = useState<HistoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StockMovementEditRow | null>(null);

  useEffect(() => {
    setPage(1);
  }, [recipeId, outputProductId]);

  const load = useCallback(async () => {
    if (!recipeId) {
      setAllRows([]);
      return;
    }
    setLoading(true);
    const orFilter = outputProductId
      ? `reference_id.eq.${recipeId},and(product_id.eq.${outputProductId},reference_type.in.(intermediate_production,recipe,technical_sheet_backfill))`
      : `reference_id.eq.${recipeId}`;

    try {
      const data = await fetchAllInRange<HistoryRow>(
        supabase
          .from("stock_movements")
          .select(
            "id, product_id, quantity, type, reference_type, reference_id, created_at, unit_cost, metadata_json, products(name, unit)",
          )
          .eq("company_id", companyId)
          .or(orFilter)
          .order("created_at", { ascending: false }) as never,
      );
      const withSourceDates = await attachStockMovementSourceDates(data);
      setAllRows(sortStockMovementsByEffectiveDate(withSourceDates));
    } catch (error) {
      console.error(error);
      setAllRows([]);
    }
    setLoading(false);
  }, [companyId, recipeId, outputProductId]);

  const totalCount = allRows.length;
  const rows = useMemo(() => {
    const from = (page - 1) * PAGE_SIZE;
    return allRows.slice(from, from + PAGE_SIZE);
  }, [allRows, page]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE) || 1);
    if (page > maxPage) setPage(maxPage);
  }, [page, totalCount]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const openRow = (row: HistoryRow) => {
    const products = Array.isArray(row.products)
      ? row.products[0] ?? null
      : row.products;
    setSelected({
      id: row.id,
      product_id: row.product_id,
      quantity: row.quantity,
      type: row.type,
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      created_at: row.created_at,
      unit_cost: row.unit_cost,
      metadata_json: row.metadata_json ?? null,
      products,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando movimentações…
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
        Nenhuma movimentação desta ficha ainda. Produções e baixas de insumos
        aparecem aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-background shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Quantidade</th>
              <th className="px-3 py-2 font-medium">Classificação</th>
              <th className="px-3 py-2 font-medium text-right">Custo un.</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => openRow(row)}
                onKeyDown={(e) => e.key === "Enter" && openRow(row)}
                className={cn(
                  "group cursor-pointer border-b border-border/60 transition-colors last:border-b-0",
                  "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                  selected?.id === row.id && "bg-muted/50",
                )}
              >
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {formatStockMovementListDate(row)}
                </td>
                <td className="px-3 py-2 font-medium">
                  {row.products?.name ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <StockMovementTypeBadge
                    row={{
                      type: row.type,
                      reference_type: row.reference_type,
                    }}
                  />
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                  {row.metadata_json?.quantity_unit?.trim() ||
                    row.products?.unit ||
                    ""}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {movementClassificationDisplayLabel(row)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums text-muted-foreground",
                  )}
                >
                  {row.unit_cost != null
                    ? formatCurrency(Number(row.unit_cost))
                    : "—"}
                </td>
                <td className="px-2 py-2 text-right">
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalCount > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}
      <StockMovementEditSheet
        companyId={companyId}
        movement={selected}
        open={selected != null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
        onSaved={() => void load()}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

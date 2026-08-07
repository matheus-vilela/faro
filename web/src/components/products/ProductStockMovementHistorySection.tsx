import { ProductMergeMovementPair } from "@/components/estoque/ProductMergeMovementPair";
import { StockMovementEditSheet } from "@/components/estoque/StockMovementEditSheet";
import { StockMovementOriginCell } from "@/components/estoque/StockMovementOriginCell";
import { StockMovementTypeBadge } from "@/components/estoque/StockMovementTypeBadge";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { ProductMergeMovementUndoButton } from "@/components/products/ProductMergeAuditSection";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { resolveExpenseIdsForStockMovements } from "@/lib/stockMovementExpenseLink";
import type { StockMovementEditRow } from "@/lib/stockMovementEdit";
import { movementClassificationDisplayLabel } from "@/lib/stockMovementClassification";
import { stockMovementMergePairDisplay } from "@/lib/stockMovementMergeDisplay";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stockMovementMergeUndoProps } from "@/types/productMergeAudit";
import { ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type MovementRow = Omit<StockMovementEditRow, "product_id"> & {
  product_id?: string;
};

function movementQuantityUnit(
  row: MovementRow,
  productUnit: string,
): string {
  const fromMeta = row.metadata_json?.quantity_unit?.trim();
  return fromMeta || productUnit || "un";
}

type Props = {
  productId: string;
  productName: string;
  companyId: string;
  unit: string;
  /** Só busca quando a aba Histórico está visível. */
  active?: boolean;
  pageSize?: number;
  className?: string;
  onStockChanged?: () => void;
};

export function ProductStockMovementHistorySection({
  productId,
  productName,
  companyId,
  unit,
  active = true,
  pageSize = PAGE_SIZE,
  className,
  onStockChanged,
}: Props) {
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedMovement, setSelectedMovement] =
    useState<StockMovementEditRow | null>(null);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [productId]);

  const load = useCallback(async () => {
    if (!productId) {
      setRows([]);
      setTotalCount(0);
      return;
    }
    setLoading(true);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await supabase
      .from("stock_movements")
      .select(
        "id, product_id, quantity, type, reference_type, reference_id, created_at, unit_cost, metadata_json",
        { count: "exact" },
      )
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error(error);
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const enriched = await resolveExpenseIdsForStockMovements(
      (data ?? []) as Omit<MovementRow, "expense_id">[],
    );
    setRows(enriched);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [productId, page, pageSize]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const handleMergeUndone = () => {
    void load();
    onStockChanged?.();
  };

  const openMovement = (row: MovementRow) => {
    setSelectedMovement({
      ...row,
      product_id: row.product_id ?? productId,
      products: { name: productName, unit },
    });
  };

  return (
    <section className={cn(className)}>
      <ExpenseDetailSheet
        expenseId={expenseDetailId}
        onClose={() => setExpenseDetailId(null)}
        onRefresh={() => void load()}
        elevated
      />
      <StockMovementEditSheet
        companyId={companyId}
        movement={selectedMovement}
        open={selectedMovement != null}
        onOpenChange={(open) => {
          if (!open) setSelectedMovement(null);
        }}
        onSaved={() => {
          void load();
          onStockChanged?.();
        }}
        formatCurrency={formatCurrency}
        elevated
      />

      <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Histórico de movimentação
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Clique em uma movimentação para revisar ou corrigir.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando movimentações...
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
          Nenhuma movimentação registrada para este produto.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-border bg-background shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Quantidade</th>
                  <th className="px-3 py-2 font-medium">Origem</th>
                  <th className="px-3 py-2 font-medium">Custo un.</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const mergeUndo = stockMovementMergeUndoProps(row);
                  const mergePair = stockMovementMergePairDisplay(
                    row,
                    productName,
                  );
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openMovement(row)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && openMovement(row)
                      }
                      className={cn(
                        "group cursor-pointer border-b border-border/60 transition-colors last:border-b-0",
                        "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                        selectedMovement?.id === row.id && "bg-muted/50",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <StockMovementTypeBadge row={row} />
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                        {movementQuantityUnit(row, unit)}
                      </td>
                      <td className="px-3 py-2">
                        {mergePair ? (
                          <ProductMergeMovementPair {...mergePair} />
                        ) : (
                          <StockMovementOriginCell
                            referenceType={row.reference_type}
                            expenseId={row.expense_id ?? null}
                            label={movementClassificationDisplayLabel(row)}
                            onOpenExpense={setExpenseDetailId}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {row.unit_cost != null
                          ? formatCurrency(Number(row.unit_cost))
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div
                          className="flex items-center justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {mergeUndo.eventId ? (
                            <ProductMergeMovementUndoButton
                              companyId={companyId}
                              eventId={mergeUndo.eventId}
                              loserName={mergeUndo.loserName}
                              undoneAt={mergeUndo.undoneAt}
                              onUndone={handleMergeUndone}
                            />
                          ) : row.reference_type === "product_merge_undo" ||
                            row.metadata_json?.undone_at ? (
                            <Badge
                              variant="outline"
                              className="text-xs font-normal"
                            >
                              Desfeita
                            </Badge>
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalCount > pageSize ? (
            <Pagination
              page={page}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

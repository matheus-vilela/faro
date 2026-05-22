import { StockMovementOriginCell } from "@/components/estoque/StockMovementOriginCell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { resolveExpenseIdsForStockMovements } from "@/lib/stockMovementExpenseLink";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STOCK_REF_LABEL: Record<string, string> = {
  inventory_count: "Contagem",
  expense: "Despesa",
  expense_item: "Despesa",
  recebimento: "Recebimento",
  recipe: "Receita",
  revenue_entry: "Venda",
  waste: "Perda",
  adjustment: "Ajuste",
  purchase_order: "Compra",
  technical_sheet_backfill: "Ficha técnica (histórico)",
};

function stockRefLabel(type: string | null): string {
  if (!type) return "—";
  return STOCK_REF_LABEL[type] ?? type;
}

type MovementRow = {
  id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  unit_cost: number | null;
  metadata_json: { quantity_unit?: string } | null;
  expense_id: string | null;
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
  unit: string;
  /** Só busca quando a aba Histórico está visível. */
  active?: boolean;
  pageSize?: number;
  className?: string;
};

export function ProductStockMovementHistorySection({
  productId,
  unit,
  active = true,
  pageSize = PAGE_SIZE,
  className,
}: Props) {
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

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
        "id, quantity, type, reference_type, reference_id, created_at, unit_cost, metadata_json",
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

  return (
    <section className={cn(className)}>
      <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Histórico de movimentação
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isIn = row.type === "in";
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-border/60 last:border-b-0"
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
                        <Badge
                          variant={isIn ? "secondary" : "outline"}
                          className="gap-1 font-normal"
                        >
                          {isIn ? (
                            <ArrowDownLeft className="h-3 w-3" />
                          ) : (
                            <ArrowUpRight className="h-3 w-3" />
                          )}
                          {isIn ? "Entrada" : "Saída"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                        {movementQuantityUnit(row, unit)}
                      </td>
                      <td className="px-3 py-2">
                        <StockMovementOriginCell
                          referenceType={row.reference_type}
                          expenseId={row.expense_id}
                          label={stockRefLabel(row.reference_type)}
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {row.unit_cost != null
                          ? formatCurrency(Number(row.unit_cost))
                          : "—"}
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

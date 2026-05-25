import { StockMovementOriginCell } from "@/components/estoque/StockMovementOriginCell";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  isExpenseStockMovementReference,
  resolveExpenseIdsForStockMovements,
} from "@/lib/stockMovementExpenseLink";
import {
  isManuallyRegisteredStockMovement,
  manualStockMovementRegisteredByLabel,
} from "@/lib/manualStockMovement";
import {
  isWasteStockMovement,
  stockMovementTypeLabel,
} from "@/lib/stockMovementFilters";
import { movementClassificationDisplayLabel } from "@/lib/stockMovementClassification";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";
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
  purchase_order: "Despesa",
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
  metadata_json: {
    quantity_unit?: string;
    registration_mode?: string;
    registered_by_user_id?: string;
    registered_by_name?: string;
    classification?: string;
    movement_kind?: string;
  } | null;
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
  const [selectedMovement, setSelectedMovement] = useState<MovementRow | null>(
    null,
  );
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

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const openExpenseDetail = (expenseId: string) => {
    setExpenseDetailId(expenseId);
  };

  const selectedHasExpense =
    selectedMovement?.expense_id != null &&
    isExpenseStockMovementReference(selectedMovement.reference_type);

  const selectedIsManual =
    selectedMovement != null &&
    isManuallyRegisteredStockMovement(selectedMovement.metadata_json);

  const selectedRegisteredBy = selectedMovement
    ? manualStockMovementRegisteredByLabel(selectedMovement.metadata_json)
    : null;

  return (
    <section className={cn(className)}>
      <ExpenseDetailSheet
        expenseId={expenseDetailId}
        onClose={() => setExpenseDetailId(null)}
        onRefresh={() => void load()}
        elevated
      />

      <Sheet
        open={selectedMovement != null}
        onOpenChange={(open) => {
          if (!open) setSelectedMovement(null);
        }}
      >
        <SheetContent
          className="z-[60] flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
          overlayClassName="z-[60]"
        >
          {selectedMovement ? (
            <>
              <SheetHeader className="border-b border-border px-6 py-5 text-left">
                <SheetTitle>Movimentação de estoque</SheetTitle>
                <SheetDescription>
                  {formatDateTime(selectedMovement.created_at)}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 overflow-y-auto px-6 py-5">
                <dl className="grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Tipo</dt>
                    <dd className="mt-1">
                      <Badge
                        variant={
                          selectedMovement.type === "in"
                            ? "secondary"
                            : isWasteStockMovement(selectedMovement)
                              ? "destructive"
                              : "outline"
                        }
                        className="gap-1 font-normal"
                      >
                        {selectedMovement.type === "in" ? (
                          <ArrowDownLeft className="h-3 w-3" />
                        ) : isWasteStockMovement(selectedMovement) ? (
                          <Trash2 className="h-3 w-3" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3" />
                        )}
                        {stockMovementTypeLabel(selectedMovement)}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Quantidade
                    </dt>
                    <dd className="mt-1 font-medium tabular-nums">
                      {Number(selectedMovement.quantity).toLocaleString(
                        "pt-BR",
                      )}{" "}
                      {movementQuantityUnit(selectedMovement, unit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Classificação
                    </dt>
                    <dd className="mt-1">
                      <StockMovementOriginCell
                        referenceType={selectedMovement.reference_type}
                        expenseId={selectedMovement.expense_id}
                        label={movementClassificationDisplayLabel(
                          selectedMovement,
                        )}
                        onOpenExpense={openExpenseDetail}
                      />
                    </dd>
                  </div>
                  {selectedIsManual ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Registrado por
                      </dt>
                      <dd className="mt-1 font-medium">
                        {selectedRegisteredBy ?? "—"}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Custo unitário
                    </dt>
                    <dd className="mt-1 tabular-nums">
                      {selectedMovement.unit_cost != null
                        ? formatCurrency(Number(selectedMovement.unit_cost))
                        : "—"}
                    </dd>
                  </div>
                </dl>

                {selectedHasExpense ? (
                  <Button
                    type="button"
                    className="w-full gap-2"
                    onClick={() =>
                      openExpenseDetail(selectedMovement.expense_id!)
                    }
                  >
                    <FileText className="h-4 w-4" />
                    Visualizar despesa / nota
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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
                  const isWaste = isWasteStockMovement(row);
                  const typeLabel = stockMovementTypeLabel(row);
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedMovement(row)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && setSelectedMovement(row)
                      }
                      className={cn(
                        "cursor-pointer border-b border-border/60 transition-colors last:border-b-0",
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
                        <Badge
                          variant={
                            isIn ? "secondary" : isWaste ? "destructive" : "outline"
                          }
                          className="gap-1 font-normal"
                        >
                          {isIn ? (
                            <ArrowDownLeft className="h-3 w-3" />
                          ) : isWaste ? (
                            <Trash2 className="h-3 w-3" />
                          ) : (
                            <ArrowUpRight className="h-3 w-3" />
                          )}
                          {typeLabel}
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
                          onOpenExpense={openExpenseDetail}
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

import {
  PayableOriginBadge,
  PayableSituationBadge,
} from "@/components/fluxo/PayableListBadges";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  boletoSupplierLabel,
  formatCategoryPathBullet,
  formatDueDateCell,
  resolvePayableOrigin,
  resolvePayableSituation,
  sortPayablesByDueDate,
} from "@/lib/payableListViews";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { resolveReceiptExpenseId } from "@/lib/payableBoletoReceipt";
import type { PayableReceiptExpense } from "@/lib/payableBoletoReceipt";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { FluxoBoletoRow } from "@/types/expenseSeries";
import { useMemo } from "react";

export function PayableByDueDateView({
  boletos,
  categoriesById,
  expenseById,
  todayYmd,
  loading,
  emptyMessage,
  formatCurrency,
  onSelect,
}: {
  boletos: FluxoBoletoRow[];
  categoriesById: Map<string, CompanyCategory>;
  expenseById: Map<string, PayableReceiptExpense>;
  todayYmd: string;
  loading: boolean;
  emptyMessage: string;
  formatCurrency: (v: number) => string;
  onSelect: (b: FluxoBoletoRow) => void;
}) {
  const rows = useMemo(() => sortPayablesByDueDate(boletos), [boletos]);
  type DueSortKey =
    | "due"
    | "supplier"
    | "category"
    | "origin"
    | "situation"
    | "amount";
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    FluxoBoletoRow,
    DueSortKey
  >(rows, "due", (a, b, key) => {
    switch (key) {
      case "due":
        return a.due_date.localeCompare(b.due_date);
      case "supplier":
        return boletoSupplierLabel(a).localeCompare(
          boletoSupplierLabel(b),
          "pt-BR",
        );
      case "category":
        return formatCategoryPathBullet(a, categoriesById).localeCompare(
          formatCategoryPathBullet(b, categoriesById),
          "pt-BR",
        );
      case "origin":
        return resolvePayableOrigin(a, expenseById).localeCompare(
          resolvePayableOrigin(b, expenseById),
        );
      case "situation":
        return resolvePayableSituation(a, todayYmd).localeCompare(
          resolvePayableSituation(b, todayYmd),
        );
      case "amount":
        return Number(a.amount) - Number(b.amount);
      default:
        return 0;
    }
  });

  if (loading) {
    return <p className="text-muted-foreground">Carregando...</p>;
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Próximos vencimentos</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <SortableTableHead
                  label="Vencimento"
                  column="due"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="pb-2 pr-3 font-semibold"
                />
                <SortableTableHead
                  label="Fornecedor"
                  column="supplier"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="pb-2 pr-3 font-semibold"
                />
                <SortableTableHead
                  label="Categoria"
                  column="category"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="pb-2 pr-3 font-semibold"
                />
                <SortableTableHead
                  label="Origem"
                  column="origin"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="pb-2 pr-3 font-semibold"
                />
                <SortableTableHead
                  label="Situação"
                  column="situation"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="pb-2 pr-3 font-semibold"
                />
                <SortableTableHead
                  label="Valor"
                  column="amount"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  align="right"
                  className="pb-2 font-semibold"
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const dueCell = formatDueDateCell(b.due_date, todayYmd);
                const situation = resolvePayableSituation(b, todayYmd);
                const origin = resolvePayableOrigin(b, expenseById);
                const rowKey =
                  b.id ||
                  `${resolveReceiptExpenseId(b) ?? "x"}-${b.due_date}`;
                return (
                  <tr
                    key={rowKey}
                    className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/30"
                    onClick={() => onSelect(b)}
                  >
                    <td
                      className={cn(
                        "py-3 pr-3 font-medium tabular-nums",
                        dueCell.tone === "overdue" &&
                          "text-red-600 dark:text-red-400",
                        dueCell.tone === "today" &&
                          "text-orange-600 dark:text-orange-400",
                      )}
                    >
                      {dueCell.label}
                    </td>
                    <td className="max-w-[10rem] truncate py-3 pr-3">
                      {boletoSupplierLabel(b)}
                    </td>
                    <td className="max-w-[12rem] truncate py-3 pr-3 text-muted-foreground">
                      {formatCategoryPathBullet(b, categoriesById)}
                    </td>
                    <td className="py-3 pr-3">
                      <PayableOriginBadge origin={origin} />
                    </td>
                    <td className="py-3 pr-3">
                      <PayableSituationBadge situation={situation} />
                    </td>
                    <td className="py-3 text-right font-bold tabular-nums">
                      {formatCurrency(Number(b.amount) || 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

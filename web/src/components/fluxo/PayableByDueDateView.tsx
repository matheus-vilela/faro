import {
  PayableOriginBadge,
  PayableRemainderBadge,
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
                <th className="pb-2 pr-3 font-semibold">Vencimento</th>
                <th className="pb-2 pr-3 font-semibold">Fornecedor</th>
                <th className="pb-2 pr-3 font-semibold">Categoria</th>
                <th className="pb-2 pr-3 font-semibold">Origem</th>
                <th className="pb-2 pr-3 font-semibold">Situação</th>
                <th className="pb-2 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PayableOriginBadge origin={origin} />
                        {b.split_from_boleto_id ? (
                          <PayableRemainderBadge />
                        ) : null}
                      </div>
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

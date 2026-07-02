import {
  isExpenseStockMovementReference,
  stockMovementExpenseHref,
} from "@/lib/stockMovementExpenseLink";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

type Props = {
  referenceType: string | null;
  expenseId: string | null;
  label: string;
  /** Abre detalhes da despesa na mesma tela (sem navegar para /app/despesas). */
  onOpenExpense?: (expenseId: string) => void;
  className?: string;
};

export function StockMovementOriginCell({
  referenceType,
  expenseId,
  label,
  onOpenExpense,
  className,
}: Props) {
  if (expenseId && isExpenseStockMovementReference(referenceType)) {
    const linkClass = cn(
      "inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline",
      className,
    );
    if (onOpenExpense) {
      return (
        <button
          type="button"
          className={cn(linkClass, "text-left")}
          title="Ver despesa nesta tela"
          onClick={(e) => {
            e.stopPropagation();
            onOpenExpense(expenseId);
          }}
        >
          {label}
          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </button>
      );
    }
    return (
      <Link
        to={stockMovementExpenseHref(expenseId)}
        className={linkClass}
        title="Abrir nota fiscal"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </Link>
    );
  }
  return <span className={cn("text-muted-foreground", className)}>{label}</span>;
}

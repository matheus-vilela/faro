import {
  isExpenseStockMovementReference,
  stockMovementExpenseHref,
} from "@/lib/stockMovementExpenseLink";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

type Props = {
  referenceType: string | null;
  expenseId: string | null;
  label: string;
};

export function StockMovementOriginCell({
  referenceType,
  expenseId,
  label,
}: Props) {
  if (expenseId && isExpenseStockMovementReference(referenceType)) {
    return (
      <Link
        to={stockMovementExpenseHref(expenseId)}
        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
        title="Abrir despesa"
      >
        {label}
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </Link>
    );
  }
  return <span className="text-muted-foreground">{label}</span>;
}

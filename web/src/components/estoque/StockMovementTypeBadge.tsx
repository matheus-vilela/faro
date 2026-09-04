import { Badge } from "@/components/ui/badge";
import { stockMovementTypeDisplay } from "@/lib/stockMovementMergeDisplay";
import { cn } from "@/lib/utils";
import type { StockMovementProductMergeMeta } from "@/types/productMergeAudit";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardList,
  GitMerge,
  Trash2,
  Undo2,
} from "lucide-react";

type Row = {
  type: string;
  reference_type: string | null;
  metadata_json?: StockMovementProductMergeMeta | null;
};

export function StockMovementTypeBadge({
  row,
  className,
}: {
  row: Row;
  className?: string;
}) {
  const display = stockMovementTypeDisplay(row);

  if (display.kind === "merge" || display.kind === "merge_undo") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-violet-500/30 bg-violet-500/10 font-normal text-violet-900 dark:text-violet-200",
          className,
        )}
      >
        {display.kind === "merge_undo" ? (
          <Undo2 className="h-3 w-3" />
        ) : (
          <GitMerge className="h-3 w-3" />
        )}
        {display.label}
      </Badge>
    );
  }

  const isCount = row.reference_type === "inventory_count";
  const isIn = display.kind === "in";

  if (isCount) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-teal-500/35 bg-teal-500/10 font-normal text-teal-900 dark:text-teal-200",
          className,
        )}
      >
        <ClipboardList className="h-3 w-3" />
        {display.label}
      </Badge>
    );
  }

  return (
    <Badge
      variant={
        isIn ? "secondary" : display.kind === "waste" ? "destructive" : "outline"
      }
      className={cn("gap-1 font-normal", className)}
    >
      {isIn ? (
        <ArrowDownLeft className="h-3 w-3" />
      ) : display.kind === "waste" ? (
        <Trash2 className="h-3 w-3" />
      ) : (
        <ArrowUpRight className="h-3 w-3" />
      )}
      {display.label}
    </Badge>
  );
}

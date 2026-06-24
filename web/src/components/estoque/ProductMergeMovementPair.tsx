import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StockMovementMergePairDisplay } from "@/lib/stockMovementMergeDisplay";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function ProductMergeMovementPair({
  loserName,
  winnerName,
  undo = false,
  undone = false,
  className,
}: StockMovementMergePairDisplay & { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1.5 text-sm leading-snug",
        className,
      )}
    >
      {undo ? (
        <>
          <span className="font-medium text-foreground">{winnerName}</span>
          <ArrowLeft
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
            {loserName}
          </span>
          <span className="text-xs text-muted-foreground">restaurado</span>
        </>
      ) : (
        <>
          <span
            className="max-w-[10rem] truncate text-muted-foreground line-through decoration-muted-foreground/50 sm:max-w-[14rem]"
            title={loserName}
          >
            {loserName}
          </span>
          <ArrowRight
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span
            className="max-w-[10rem] truncate font-medium text-foreground sm:max-w-[14rem]"
            title={winnerName}
          >
            {winnerName}
          </span>
        </>
      )}
      {undone ? (
        <Badge variant="outline" className="text-[0.65rem] font-normal">
          Desfeita
        </Badge>
      ) : null}
    </span>
  );
}

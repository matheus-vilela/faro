import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { DreTreeNode } from "@/lib/dre/dreTree";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { DreTreePanel } from "./DreTreePanel";

export type DreValueTone = "receita" | "deducao" | "despesa" | "resultado" | "muted";

const TONE: Record<DreValueTone, string> = {
  receita: "text-emerald-600 dark:text-emerald-400",
  deducao: "text-orange-600 dark:text-orange-400",
  despesa: "text-rose-700 dark:text-rose-400",
  resultado: "text-foreground font-semibold",
  muted: "text-muted-foreground",
};

interface DreExpandableLineProps {
  label: string;
  amount: number;
  tone: DreValueTone;
  prefix?: string;
  tree?: DreTreeNode[] | null;
  treeDisplayNegative?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export function DreExpandableLine({
  label,
  amount,
  tone,
  prefix,
  tree,
  treeDisplayNegative,
  defaultOpen = false,
  className,
}: DreExpandableLineProps) {
  const hasTree = tree && tree.length > 0;
  const valueCls = TONE[tone];

  const labelBlock = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {prefix ? (
        <span className="w-6 shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
          {prefix}
        </span>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 truncate font-medium">{label}</span>
    </span>
  );

  const amountBlock = (
    <span className={cn("shrink-0 text-right tabular-nums", valueCls)}>{formatBrl(amount)}</span>
  );

  if (!hasTree) {
    return (
      <div
        className={cn(
          "flex items-baseline justify-between gap-3 py-2.5 text-sm sm:text-base",
          className,
        )}
      >
        {labelBlock}
        {amountBlock}
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("group/line", className)}>
      <CollapsibleTrigger
        className={cn(
          "flex w-full min-w-0 items-baseline justify-between gap-3 rounded-md py-2.5 text-left text-sm sm:text-base outline-none",
          "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {prefix ? (
            <span className="w-6 shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
              {prefix}
            </span>
          ) : (
            <span className="w-6 shrink-0" aria-hidden />
          )}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-0 truncate font-medium">{label}</span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/line:rotate-180"
              aria-hidden
            />
          </span>
        </span>
        {amountBlock}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3 pl-4 sm:pl-8">
        <DreTreePanel
          nodes={tree!}
          valueClassName={valueCls}
          displayNegative={treeDisplayNegative}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DreHighlightBlock({
  label,
  amount,
  tone = "resultado",
  className,
}: {
  label: string;
  amount: number;
  tone?: DreValueTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-baseline justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 sm:gap-3 sm:px-4",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-semibold leading-snug text-foreground sm:text-sm md:text-base">
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 text-right tabular-nums text-xs font-semibold leading-none tracking-tight sm:text-sm md:text-lg",
          TONE[tone],
        )}
      >
        {formatBrl(amount)}
      </span>
    </div>
  );
}

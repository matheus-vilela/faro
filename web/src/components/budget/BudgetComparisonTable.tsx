import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BudgetAmountInput } from "@/components/budget/BudgetAmountInput";
import type { BudgetComparisonNode, BudgetDeviationStatus } from "@/lib/budget/types";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

const STATUS_LABEL: Record<BudgetDeviationStatus, string> = {
  ok: "Dentro",
  warning: "Atenção",
  over: "Estourou",
  no_budget: "Sem meta",
  empty: "—",
};

const STATUS_BADGE: Record<BudgetDeviationStatus, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  over: "bg-red-500/10 text-red-700 dark:text-red-400",
  no_budget: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  empty: "bg-muted text-muted-foreground",
};

const ROW_BG: Record<BudgetDeviationStatus, string> = {
  ok: "",
  warning: "bg-amber-500/5",
  over: "bg-red-500/5",
  no_budget: "bg-amber-500/5",
  empty: "",
};

function PercentBar({ percent }: { percent: number | null }) {
  if (percent == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const clamped = Math.min(percent, 150);
  const tone =
    percent > 100
      ? "bg-red-500"
      : percent > 90
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="flex min-w-[5rem] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", tone)}
          style={{ width: `${Math.min(clamped, 100)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {percent.toLocaleString("pt-BR", {
          maximumFractionDigits: 0,
        })}
        %
      </span>
    </div>
  );
}

function ComparisonRow({
  node,
  depth,
  onSaveBudget,
  savingCategoryId,
  disabled,
  avg3mByCategoryId,
}: {
  node: BudgetComparisonNode;
  depth: number;
  onSaveBudget: (categoryId: string, amount: number) => Promise<void>;
  savingCategoryId: string | null;
  disabled?: boolean;
  avg3mByCategoryId: Map<string, number>;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const rowClass = ROW_BG[node.status];
  const avg3m = node.isLeaf
    ? (avg3mByCategoryId.get(node.id) ?? 0)
    : node.children.reduce((s, ch) => {
        // rollup approx from leaves in subtree via recursive sum of leaf avgs
        return s + leafAvgSum(ch, avg3mByCategoryId);
      }, 0);

  return (
    <>
      <tr className={cn("border-b border-border/40 text-sm", rowClass)}>
        <td className="py-2.5 pr-3">
          <div
            className="flex min-w-0 items-center gap-1"
            style={{ paddingLeft: depth * 12 }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-muted"
                aria-expanded={open}
                aria-label={open ? "Recolher" : "Expandir"}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    !open && "-rotate-90",
                  )}
                />
              </button>
            ) : (
              <span className="w-6 shrink-0" aria-hidden />
            )}
            <span
              className={cn(
                "min-w-0 truncate",
                depth === 0 ? "font-semibold text-foreground" : "text-foreground",
                depth > 0 && !node.isLeaf && "font-medium",
              )}
            >
              {node.name}
            </span>
          </div>
        </td>
        <td className="hidden py-2.5 px-2 text-right tabular-nums text-muted-foreground md:table-cell">
          {avg3m > 0 ? formatBrl(avg3m) : "—"}
        </td>
        <td className="py-2.5 px-2 text-right">
          {node.isLeaf ? (
            <BudgetAmountInput
              value={node.budgeted}
              onSave={(amount) => onSaveBudget(node.id, amount)}
              saving={savingCategoryId === node.id}
              disabled={disabled}
            />
          ) : (
            <span className="tabular-nums text-muted-foreground">
              {formatBrl(node.budgeted)}
            </span>
          )}
        </td>
        <td className="py-2.5 px-2 text-right tabular-nums">
          {formatBrl(node.actual)}
        </td>
        <td
          className={cn(
            "py-2.5 px-2 text-right tabular-nums",
            node.variance > 0
              ? "text-red-600 dark:text-red-400"
              : node.variance < 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground",
          )}
        >
          {node.variance >= 0 ? "+" : ""}
          {formatBrl(node.variance)}
        </td>
        <td className="hidden py-2.5 px-2 sm:table-cell">
          <PercentBar percent={node.percentConsumed} />
        </td>
        <td className="py-2.5 pl-2 text-right">
          {node.status !== "empty" ? (
            <Badge
              variant="secondary"
              className={cn("text-[11px] font-medium", STATUS_BADGE[node.status])}
            >
              {STATUS_LABEL[node.status]}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {hasChildren && open
        ? node.children.map((child) => (
            <ComparisonRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onSaveBudget={onSaveBudget}
              savingCategoryId={savingCategoryId}
              disabled={disabled}
              avg3mByCategoryId={avg3mByCategoryId}
            />
          ))
        : null}
    </>
  );
}

function leafAvgSum(
  node: BudgetComparisonNode,
  avg3mByCategoryId: Map<string, number>,
): number {
  if (node.isLeaf) return avg3mByCategoryId.get(node.id) ?? 0;
  return node.children.reduce(
    (s, ch) => s + leafAvgSum(ch, avg3mByCategoryId),
    0,
  );
}

export function BudgetComparisonTable({
  sections,
  onSaveBudget,
  savingCategoryId,
  disabled,
  avg3mByCategoryId = new Map(),
}: {
  sections: BudgetComparisonNode[];
  onSaveBudget: (categoryId: string, amount: number) => Promise<void>;
  savingCategoryId: string | null;
  disabled?: boolean;
  avg3mByCategoryId?: Map<string, number>;
}) {
  if (sections.length === 0) {
    return (
      <Card className="border-border/80 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma despesa orçada ou realizada neste período.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Comparativo por categoria</CardTitle>
        <CardDescription>
          Realizado = contas a pagar no período (não o lucro do DRE). Use a média
          dos 3 meses anteriores como referência para o orçado.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 pb-0 sm:px-6">
        <table className="w-full min-w-[800px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 text-left sm:px-0">Categoria</th>
              <th className="hidden px-2 py-2 text-right md:table-cell">
                Média 3m
              </th>
              <th className="px-2 py-2 text-right">Orçado</th>
              <th className="px-2 py-2 text-right">Realizado</th>
              <th className="px-2 py-2 text-right">Desvio</th>
              <th className="hidden px-2 py-2 sm:table-cell">Consumido</th>
              <th className="px-4 py-2 text-right sm:pl-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <ComparisonRow
                key={section.id}
                node={section}
                depth={0}
                onSaveBudget={onSaveBudget}
                savingCategoryId={savingCategoryId}
                disabled={disabled}
                avg3mByCategoryId={avg3mByCategoryId}
              />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

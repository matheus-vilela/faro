import type { DreTreeNode } from "@/lib/dre/dreTree";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";

interface DreTreePanelProps {
  nodes: DreTreeNode[];
  valueClassName: string;
  /** Exibe valores como negativos (deduções/despesas). */
  displayNegative?: boolean;
  /** Sem borda externa — use dentro de um contêiner que já define o painel (ex.: DRE Resultado financeiro). */
  embedded?: boolean;
}

function Row({
  node,
  depth,
  valueClassName,
  displayNegative,
}: {
  node: DreTreeNode;
  depth: number;
  valueClassName: string;
  displayNegative?: boolean;
}) {
  const v = displayNegative ? -Math.abs(node.amount) : node.amount;
  return (
    <li className="min-w-0">
      <div
        className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/40 py-1.5 text-sm last:border-0"
        style={{ paddingLeft: depth * 12 }}
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{node.name}</span>
        <span className={cn("shrink-0 text-right tabular-nums", valueClassName)}>
          {formatBrl(v)}
        </span>
      </div>
      {node.children.length > 0 ? (
        <ul className="mt-0.5">
          {node.children.map((ch) => (
            <Row
              key={ch.id}
              node={ch}
              depth={depth + 1}
              valueClassName={valueClassName}
              displayNegative={displayNegative}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DreTreePanel({
  nodes,
  valueClassName,
  displayNegative,
  embedded,
}: DreTreePanelProps) {
  const panelClass = embedded
    ? "px-2 py-1"
    : "rounded-md border border-border/60 bg-background/50 px-2 py-1";

  if (nodes.length === 0) {
    const empty = (
      <p className="py-2 pl-1 text-xs text-muted-foreground">
        Nenhuma categoria com movimento neste período.
      </p>
    );
    if (embedded) return empty;
    return <div className="rounded-md border border-border/60 bg-background/50 px-2 py-1">{empty}</div>;
  }
  return (
    <ul className={panelClass}>
      {nodes.map((n) => (
        <Row
          key={n.id}
          node={n}
          depth={0}
          valueClassName={valueClassName}
          displayNegative={displayNegative}
        />
      ))}
    </ul>
  );
}

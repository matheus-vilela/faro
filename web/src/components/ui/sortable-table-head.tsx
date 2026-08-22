import { cn } from "@/lib/utils";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";

export function SortableTableHead<K extends string>({
  label,
  column,
  sortKey,
  sortAsc,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  column: K;
  sortKey: K;
  sortAsc: boolean;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === column;
  return (
    <th
      className={cn(
        "px-3 py-2.5 font-medium",
        align === "right" && "text-right",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sortAsc ? (
            <ArrowUpAZ className="size-3.5 opacity-70" />
          ) : (
            <ArrowDownAZ className="size-3.5 opacity-70" />
          )
        ) : null}
      </button>
    </th>
  );
}

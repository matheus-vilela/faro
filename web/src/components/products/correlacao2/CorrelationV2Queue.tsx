import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import {
  PRODUCT_SETUP_ORIGIN_LABEL,
  SETUP_STOCK_ONLY_LABEL,
  setupItemMatchesFilters,
  setupItemShowsStockOnly,
  setupItemSourceLabel,
  type ProductSetupOriginFilter,
} from "@/lib/productSetupListFilter";
import { formatTurnoverLine, itemTurnoverQty } from "@/lib/productSetupQueue";
import {
  INTENT_TO_CHOICE,
  intentLabel,
  type CorrelationCase,
  type CorrelationIntent,
} from "@/lib/productValidation/correlationCase";
import { cn } from "@/lib/utils";
import { FilterX } from "lucide-react";
import { useMemo, useState } from "react";

type SortKey = "name" | "turnover";

function compareCases(
  a: CorrelationCase,
  b: CorrelationCase,
  key: SortKey,
): number {
  if (key === "name") return a.subject.name.localeCompare(b.subject.name, "pt-BR");
  return itemTurnoverQty(a.subject) - itemTurnoverQty(b.subject);
}

const SOURCE_BADGE_CLASS: Record<string, string> = {
  purchase_unlinked:
    "border-amber-500/35 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  sold_unlinked:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  recipe_without_ingredients:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  recipe_sales_unlinked:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
};

function CaseIdentity({
  row,
  intent,
  showVolume = false,
}: {
  row: CorrelationCase;
  intent: CorrelationIntent;
  showVolume?: boolean;
}) {
  const choice = INTENT_TO_CHOICE[intent];
  const volume = showVolume ? formatTurnoverLine(row.subject) : null;
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{row.subject.name}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn("font-normal", SOURCE_BADGE_CLASS[row.subject.kind])}
        >
          {setupItemSourceLabel(row.subject)}
        </Badge>
        {setupItemShowsStockOnly(row.subject, choice) ? (
          <Badge
            variant="outline"
            className="border-sky-500/35 bg-sky-500/15 font-normal text-sky-900 dark:text-sky-200"
          >
            {SETUP_STOCK_ONLY_LABEL}
          </Badge>
        ) : null}
        {volume ? (
          <span className="text-xs text-muted-foreground">{volume}</span>
        ) : null}
      </div>
    </div>
  );
}

export function CorrelationV2Queue({
  cases,
  intentFor,
  activeId,
  onSelect,
}: {
  cases: CorrelationCase[];
  intentFor: (row: CorrelationCase) => CorrelationIntent;
  activeId: string | null;
  onSelect: (row: CorrelationCase) => void;
}) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<ProductSetupOriginFilter>("all");

  const filtered = useMemo(
    () =>
      cases.filter((row) =>
        setupItemMatchesFilters(row.subject, query, origin),
      ),
    [cases, query, origin],
  );

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    CorrelationCase,
    SortKey
  >(filtered, "turnover", compareCases, false);

  const filtersDefault = query.trim() === "" && origin === "all";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, SKU ou EAN…"
          className="h-8 min-w-[12rem] flex-1 md:max-w-xs"
        />
        <Select
          value={origin}
          onValueChange={(next) => setOrigin(next as ProductSetupOriginFilter)}
        >
          <SelectTrigger size="sm" className="h-8 w-40 bg-background">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.keys(PRODUCT_SETUP_ORIGIN_LABEL) as ProductSetupOriginFilter[]
            ).map((value) => (
              <SelectItem key={value} value={value}>
                {PRODUCT_SETUP_ORIGIN_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={filtersDefault}
          onClick={() => {
            setQuery("");
            setOrigin("all");
          }}
        >
          <FilterX className="mr-1 size-3.5" />
          Limpar
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          Nenhum item neste filtro.
        </p>
      ) : isMobile ? (
        <ul className="space-y-2">
          {sorted.map((row) => {
            const selected = row.id === activeId;
            const intent = intentFor(row);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-xl border p-3 text-left",
                    selected
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/80 bg-card",
                  )}
                  onClick={() => onSelect(row)}
                >
                  <CaseIdentity row={row} intent={intent} showVolume />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {intentLabel(intent)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="min-h-0 max-h-[min(70vh,720px)] overflow-auto rounded-md border">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <SortableTableHead
                  label="Item"
                  column="name"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="w-fit"
                />
                <SortableTableHead
                  label="Volume"
                  column="turnover"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="w-32"
                />
                <th className="px-3 py-2.5 font-medium">Sugerido</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const selected = row.id === activeId;
                const intent = intentFor(row);
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "cursor-pointer border-b last:border-0",
                      selected ? "bg-primary/5" : "hover:bg-muted/40",
                    )}
                    onClick={() => onSelect(row)}
                  >
                    <td className="w-[40%] px-3 py-2.5">
                      <CaseIdentity row={row} intent={intent} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {formatTurnoverLine(row.subject) ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {intentLabel(intent)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

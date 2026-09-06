import { ProductSetupActionPanel } from "@/components/products/ProductSetupActionPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
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
import type { ProductSetupPrimaryAction } from "@/lib/productSetupPrimaryAction";
import {
  itemTurnoverAmount,
  itemTurnoverQty,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import {
  casesFromQueue,
  excludeResolvedCases,
  INTENT_TO_CHOICE,
  intentLabel,
  listCorrelationCases,
  type CorrelationCase,
  type CorrelationIntent,
} from "@/lib/productValidation/correlationCase";
import type { ProductValidationResult } from "@/lib/productValidation/types";
import { cn } from "@/lib/utils";
import { FilterX, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type SortKey = "name" | "turnover";

function compareCases(
  a: CorrelationCase,
  b: CorrelationCase,
  key: SortKey,
): number {
  if (key === "name") {
    return a.subject.name.localeCompare(b.subject.name, "pt-BR");
  }
  const amount = itemTurnoverAmount(a.subject) - itemTurnoverAmount(b.subject);
  if (amount !== 0) return amount;
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
}: {
  row: CorrelationCase;
  intent: CorrelationIntent;
}) {
  const choice = INTENT_TO_CHOICE[intent];
  return (
    <div className="min-w-0">
      <p className="truncate font-medium" title={row.subject.name}>
        {row.subject.name}
      </p>
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
        {row.aiIntent === intent && row.score > 0 ? (
          <span className="text-xs text-muted-foreground">
            {row.score.toLocaleString("pt-BR")}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function IntentSelect({
  row,
  value,
  onChange,
}: {
  row: CorrelationCase;
  value: CorrelationIntent;
  onChange: (intent: CorrelationIntent) => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <SearchSelect
        value={value}
        onValueChange={(next) => onChange(next as CorrelationIntent)}
        options={row.availableIntents.map((intent) => ({
          value: intent,
          label: intentLabel(intent),
        }))}
        placeholder="O que é este item?"
        triggerClassName="h-9 w-full min-w-44 bg-background"
      />
    </div>
  );
}

function unifyPartners(row: CorrelationCase) {
  return row.counterparts
    .filter((item) => item.item.productId !== row.subject.productId)
    .map((item) => ({
      id: item.item.productId,
      label: item.item.name,
    }));
}

function recipeHintCount(row: CorrelationCase): number {
  return row.counterparts.filter(
    (item) => item.item.productId !== row.subject.productId,
  ).length;
}

function RowFlow({
  companyId,
  queue,
  row,
  intent,
  active,
  onActivate,
  onResolved,
  children,
}: {
  companyId: string;
  queue: ProductSetupQueue;
  row: CorrelationCase;
  intent: CorrelationIntent;
  active: boolean;
  onActivate: () => void;
  onResolved: () => void;
  children: (parts: { flow: ReactNode; action: ReactNode }) => ReactNode;
}) {
  const [action, setAction] = useState<ProductSetupPrimaryAction | null>(null);
  const [visited, setVisited] = useState(active);
  const choice = INTENT_TO_CHOICE[intent];
  const isRecipe = intent === "recipe" || intent === "produce";
  const loadsConversions = isRecipe || intent === "ingredient";

  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);

  const mountPanel = !loadsConversions || visited;
  const hintCount = recipeHintCount(row);

  const flow = (
    <div className="min-w-0" onClick={onActivate}>
      {mountPanel ? (
        <ProductSetupActionPanel
          key={`${row.id}:${choice}`}
          companyId={companyId}
          item={row.subject}
          choice={choice}
          soldOnly={queue.soldOnly}
          recipes={queue.recipes}
          purchases={queue.purchases}
          hideTitle
          hidePrimaryAction
          onPrimaryActionChange={setAction}
          suggestedUnifyPartners={intent === "unify" ? unifyPartners(row) : []}
          suggestedRecipeIngredients={
            isRecipe
              ? row.counterparts
                  .filter(
                    (item) => item.item.productId !== row.subject.productId,
                  )
                  .map((item) => ({
                    id: item.item.productId,
                    name: item.item.name,
                    unit: item.item.unit,
                  }))
              : []
          }
          onResolved={onResolved}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {isRecipe
            ? hintCount > 0
              ? `${hintCount} ${hintCount === 1 ? "insumo sugerido" : "insumos sugeridos"}`
              : "Clique para montar a ficha"
            : "Clique para informar quantidade e vincular"}
        </p>
      )}
    </div>
  );

  const actionNode = (
    <div className="flex justify-end">
      {action ? (
        <Button
          type="button"
          size="sm"
          disabled={action.disabled}
          onClick={action.run}
        >
          {action.busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {action.label}
        </Button>
      ) : null}
    </div>
  );

  return <>{children({ flow, action: actionNode })}</>;
}

export function CorrelationCaseWorkbench({
  companyId,
  queue,
  result,
  onResolved,
}: {
  companyId: string;
  queue: ProductSetupQueue;
  result: ProductValidationResult | null;
  onResolved: (productId: string) => void;
}) {
  const isMobile = useIsMobile();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [intents, setIntents] = useState<Record<string, CorrelationIntent>>({});
  const [hiddenProductIds, setHiddenProductIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<ProductSetupOriginFilter>("all");

  const cases = useMemo(
    () => excludeResolvedCases(casesFromQueue(queue, result), hiddenProductIds),
    [queue, result, hiddenProductIds],
  );

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

  const listed = useMemo(() => listCorrelationCases(sorted), [sorted]);

  useEffect(() => {
    if (activeId && listed.some((row) => row.id === activeId)) return;
    setActiveId(listed[0]?.id ?? null);
  }, [listed, activeId]);

  const intentFor = (row: CorrelationCase): CorrelationIntent =>
    intents[row.id] ?? row.suggestedIntent;

  const markResolved = (productId: string) => {
    setHiddenProductIds((current) => {
      const next = new Set(current);
      if (productId) next.add(productId);
      return next;
    });
    setActiveId(null);
    onResolved(productId);
  };

  const filtersDefault = query.trim() === "" && origin === "all";

  if (cases.length === 0) return null;

  const rowChrome = (row: CorrelationCase) => {
    const intent = intentFor(row);
    return {
      intent,
      selected: row.id === activeId,
      identity: <CaseIdentity row={row} intent={intent} />,
      selector: (
        <IntentSelect
          row={row}
          value={intent}
          onChange={(next) => {
            setIntents((current) => ({ ...current, [row.id]: next }));
            setActiveId(row.id);
          }}
        />
      ),
    };
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, SKU ou EAN…"
          className="h-8 min-w-[12rem] flex-1 md:max-w-xs"
        />
        <SearchSelect
          value={origin}
          onValueChange={(next) => setOrigin(next as ProductSetupOriginFilter)}
          options={(
            Object.keys(
              PRODUCT_SETUP_ORIGIN_LABEL,
            ) as ProductSetupOriginFilter[]
          ).map((value) => ({
            value,
            label: PRODUCT_SETUP_ORIGIN_LABEL[value],
          }))}
          placeholder="Origem"
          size="sm"
          triggerClassName="w-40 bg-background"
        />
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

      {listed.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          Nenhum item neste filtro.
        </p>
      ) : isMobile ? (
        <ul className="space-y-2">
          {listed.map((row) => {
            const view = rowChrome(row);
            return (
              <li
                key={row.id}
                className={cn(
                  "space-y-3 rounded-xl border p-3",
                  view.selected
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/80 bg-card",
                )}
                onClick={() => setActiveId(row.id)}
              >
                {view.identity}
                {view.selector}
                <RowFlow
                  companyId={companyId}
                  queue={queue}
                  row={row}
                  intent={view.intent}
                  active={view.selected}
                  onActivate={() => setActiveId(row.id)}
                  onResolved={() => markResolved(row.subject.productId)}
                >
                  {({ flow, action }) => (
                    <div className="space-y-3">
                      {flow}
                      {action}
                    </div>
                  )}
                </RowFlow>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <SortableTableHead
                  label="Item"
                  column="name"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  className="w-[25%]"
                />
                <th className="w-[20%] px-3 py-2.5 font-medium">O que é</th>
                <th className="px-3 py-2.5 font-medium">Fluxo</th>
                <th className="w-48 px-3 py-2.5 font-medium text-right">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((row) => {
                const view = rowChrome(row);
                return (
                  <RowFlow
                    key={row.id}
                    companyId={companyId}
                    queue={queue}
                    row={row}
                    intent={view.intent}
                    active={view.selected}
                    onActivate={() => setActiveId(row.id)}
                    onResolved={() => markResolved(row.subject.productId)}
                  >
                    {({ flow, action }) => (
                      <tr
                        className={cn(
                          "cursor-pointer border-b align-top last:border-0",
                          view.selected ? "bg-primary/5" : "hover:bg-muted/30",
                        )}
                        onClick={() => setActiveId(row.id)}
                      >
                        <td className="w-[16%] px-3 py-3">{view.identity}</td>
                        <td className="px-3 py-3">{view.selector}</td>
                        <td className="px-3 py-3">{flow}</td>
                        <td className="px-3 py-3">{action}</td>
                      </tr>
                    )}
                  </RowFlow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

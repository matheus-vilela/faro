import { ProductSetupActionPanel } from "@/components/products/ProductSetupActionPanel";
import { Badge } from "@/components/ui/badge";
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
import {
  formatTurnoverLine,
  itemTurnoverQty,
  setupChoicesForItem,
  suggestedSetupChoice,
  type ProductSetupChoice,
  type ProductSetupItem,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import { cn } from "@/lib/utils";
import { CheckCircle2, Inbox, Package, Search } from "lucide-react";
import { useMemo, useState } from "react";

type SortKey = "name" | "turnover";

function compareSetup(
  a: ProductSetupItem,
  b: ProductSetupItem,
  key: SortKey,
): number {
  if (key === "name") return a.name.localeCompare(b.name, "pt-BR");
  if (key === "turnover") {
    const d = itemTurnoverQty(a) - itemTurnoverQty(b);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, "pt-BR");
  }
  return 0;
}

const SOURCE_BADGE_CLASS: Record<ProductSetupItem["kind"], string> = {
  purchase_unlinked:
    "border-amber-500/35 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  sold_unlinked:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  recipe_without_ingredients:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  recipe_sales_unlinked:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
};

function ItemIdentity({
  item,
  choice,
  showVolume = false,
}: {
  item: ProductSetupItem;
  choice?: ProductSetupChoice;
  showVolume?: boolean;
}) {
  const volume = showVolume ? formatTurnoverLine(item) : null;
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{item.name}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn("font-normal", SOURCE_BADGE_CLASS[item.kind])}
        >
          {setupItemSourceLabel(item)}
        </Badge>
        {setupItemShowsStockOnly(item, choice) ? (
          <Badge
            variant="outline"
            className="font-normal border-sky-500/35 bg-sky-500/15 text-sky-900 dark:text-sky-200"
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

function RoleSelect({
  item,
  value,
  onChange,
}: {
  item: ProductSetupItem;
  value: ProductSetupChoice | undefined;
  onChange: (choice: ProductSetupChoice) => void;
}) {
  const options = setupChoicesForItem(item);
  const selectValue =
    value && options.some((option) => option.value === value)
      ? value
      : undefined;
  return (
    <Select
      value={selectValue}
      onValueChange={(next) => onChange(next as ProductSetupChoice)}
    >
      <SelectTrigger
        size="sm"
        className="h-9 w-full min-w-56 bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder="O que é este item?" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProductSetupInbox({
  companyId,
  queue,
  onlyKeys,
  compact = false,
  onResolved,
}: {
  companyId: string;
  queue: ProductSetupQueue;
  onlyKeys?: string[];
  compact?: boolean;
  onResolved?: () => void;
}) {
  const isMobile = useIsMobile();
  const [choices, setChoices] = useState<Record<string, ProductSetupChoice>>(
    {},
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<ProductSetupOriginFilter>("all");

  const items = useMemo(() => {
    const all = queue.items;
    if (!onlyKeys?.length) return all;
    const allow = new Set(onlyKeys);
    return all.filter((item) => allow.has(item.key));
  }, [queue.items, onlyKeys]);

  const filtered = useMemo(
    () => items.filter((item) => setupItemMatchesFilters(item, query, origin)),
    [items, query, origin],
  );

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    ProductSetupItem,
    SortKey
  >(filtered, "turnover", compareSetup, false);

  const choiceFor = (item: ProductSetupItem): ProductSetupChoice | undefined => {
    const picked = choices[item.key];
    if (
      picked &&
      setupChoicesForItem(item).some((option) => option.value === picked)
    ) {
      return picked;
    }
    return suggestedSetupChoice(item);
  };

  const activeItem = items.find((item) => item.key === activeKey) ?? null;
  const activeChoice = activeItem ? choiceFor(activeItem) : undefined;

  const pickRole = (item: ProductSetupItem, choice: ProductSetupChoice) => {
    setChoices((current) => ({ ...current, [item.key]: choice }));
    setActiveKey(item.key);
  };

  const selectItem = (item: ProductSetupItem) => {
    const choice = choiceFor(item);
    if (choice) {
      pickRole(item, choice);
      return;
    }
    setActiveKey(item.key);
  };

  const total = items.length;

  const isRecipePanel = Boolean(
    activeItem &&
      (activeChoice === "recipe" || activeChoice === "intermediate"),
  );

  const panel = (
    <section
      className={cn(
        "flex min-h-0 flex-col lg:sticky lg:top-4 lg:max-h-[min(70vh,720px)]",
        isRecipePanel
          ? "overflow-hidden"
          : "overflow-y-auto rounded-xl border border-border/80 bg-card p-4",
      )}
    >
      {activeItem && activeChoice ? (
        <ProductSetupActionPanel
          companyId={companyId}
          item={activeItem}
          choice={activeChoice}
          soldOnly={queue.soldOnly}
          recipes={queue.recipes}
          purchases={queue.purchases}
          onResolved={() => {
            setActiveKey(null);
            onResolved?.();
          }}
        />
      ) : (
        <div className="flex min-h-55 flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
          <Package className="h-8 w-8 opacity-40" />
          <p>
            Diga o que é o item: produto, ficha, intermediário, agrupamento ou
            unificar.
          </p>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      {compact ? null : (
      <div
        className={cn(
          "rounded-xl border p-4",
          total > 0
            ? "border-amber-500/35 bg-amber-500/[0.07]"
            : "border-border/80 bg-card",
        )}
      >
        <div className="flex items-start gap-3">
          {total > 0 ? (
            <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-amber-800 dark:text-amber-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {total > 0
                ? `${total.toLocaleString("pt-BR")} ${total === 1 ? "item precisa" : "itens precisam"} de setup`
                : "Cadastro alinhado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {total > 0
                ? "Filtre a lista e diga o que é cada item. O detalhe abre ao lado."
                : "Novos itens da nota ou do PDV aparecem aqui até terem um papel definido."}
            </p>
          </div>
        </div>
      </div>
      )}

      {total > 0 ? (
        <div
            className={cn(
              "grid items-start gap-4",
              !isMobile &&
                "lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]",
            )}
          >
            <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nome, SKU ou EAN…"
                  className="pl-8"
                />
              </div>
              <Select
                value={origin}
                onValueChange={(next) =>
                  setOrigin(next as ProductSetupOriginFilter)
                }
              >
                <SelectTrigger className="h-9 w-full bg-background sm:w-44">
                  <SelectValue placeholder="Origem" />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(
                      PRODUCT_SETUP_ORIGIN_LABEL,
                    ) as ProductSetupOriginFilter[]
                  ).map((value) => (
                    <SelectItem key={value} value={value}>
                      {PRODUCT_SETUP_ORIGIN_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sorted.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                Nenhum item neste filtro.
              </p>
            ) : isMobile ? (
              <ul className="space-y-2">
                {sorted.map((item) => {
                  const selected = item.key === activeKey;
                  return (
                    <li key={item.key}>
                      <div
                        className={cn(
                          "cursor-pointer rounded-xl border p-3",
                          selected
                            ? "border-primary/40 bg-primary/5"
                            : "border-border/80 bg-card",
                        )}
                        onClick={() => selectItem(item)}
                      >
                        <ItemIdentity
                          item={item}
                          choice={choiceFor(item)}
                          showVolume
                        />
                        <div className="mt-3">
                          <RoleSelect
                            item={item}
                            value={choiceFor(item)}
                            onChange={(choice) => pickRole(item, choice)}
                          />
                        </div>
                      </div>
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
                        className="w-36"
                      />
                      <th className="px-3 py-2.5 font-medium">O que é</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((item) => {
                      const selected = item.key === activeKey;
                      return (
                        <tr
                          key={item.key}
                          className={cn(
                            "cursor-pointer border-b last:border-0",
                            selected ? "bg-primary/5" : "hover:bg-muted/40",
                          )}
                          onClick={() => selectItem(item)}
                        >
                          <td className="w-[32%] px-3 py-2.5">
                            <ItemIdentity
                              item={item}
                              choice={choiceFor(item)}
                            />
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                            {formatTurnoverLine(item) ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <RoleSelect
                              item={item}
                              value={choiceFor(item)}
                              onChange={(choice) => pickRole(item, choice)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </div>

            {panel}
          </div>
      ) : null}
    </div>
  );
}

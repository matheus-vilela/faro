import { ProductSetupActionPanel } from "@/components/products/ProductSetupActionPanel";
import { Badge } from "@/components/ui/badge";
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
  formatTurnoverLine,
  itemTurnoverQty,
  setupChoicesForItem,
  type ProductSetupChoice,
  type ProductSetupItem,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import { cn } from "@/lib/utils";
import { CheckCircle2, Inbox, Package } from "lucide-react";
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

function formatUnitLine(item: ProductSetupItem): string | null {
  const unit = item.unit && item.unit !== "—" ? item.unit : "";
  if (item.quantity) {
    const qty = Number(item.quantity).toLocaleString("pt-BR", {
      maximumFractionDigits: 4,
    });
    return unit ? `${qty} ${unit}` : qty;
  }
  return unit || null;
}

const SOURCE_BADGE_CLASS: Record<ProductSetupItem["kind"], string> = {
  purchase_unlinked:
    "border-amber-500/35 bg-amber-500/15 text-amber-900 dark:text-amber-200",
  sold_unlinked:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  recipe_without_ingredients:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200",
  recipe_sales_unlinked:
    "border-emerald-500/35 bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
};

function ItemIdentity({ item }: { item: ProductSetupItem }) {
  const unitLine = formatUnitLine(item);
  const turnoverLine = formatTurnoverLine(item);
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{item.name}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {turnoverLine ? (
          <Badge
            variant="outline"
            className="border-emerald-500/35 bg-emerald-500/15 font-normal text-emerald-900 dark:text-emerald-200"
          >
            {turnoverLine}
          </Badge>
        ) : unitLine ? (
          <Badge
            variant="outline"
            className="border-sky-500/35 bg-sky-500/15 font-normal text-sky-900 dark:text-sky-200"
          >
            {unitLine}
          </Badge>
        ) : null}
        <Badge
          variant="outline"
          className={cn("font-normal", SOURCE_BADGE_CLASS[item.kind])}
        >
          {item.sourceLabel}
        </Badge>
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
        className="h-9 w-full min-w-64 bg-background"
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

  const items = useMemo(() => {
    const all = queue.items;
    if (!onlyKeys?.length) return all;
    const allow = new Set(onlyKeys);
    return all.filter((item) => allow.has(item.key));
  }, [queue.items, onlyKeys]);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    ProductSetupItem,
    SortKey
  >(items, "turnover", compareSetup, false);

  const activeItem = sorted.find((item) => item.key === activeKey) ?? null;
  const activeChoiceRaw = activeItem ? choices[activeItem.key] : undefined;
  const activeChoice =
    activeItem &&
    activeChoiceRaw &&
    setupChoicesForItem(activeItem).some(
      (option) => option.value === activeChoiceRaw,
    )
      ? activeChoiceRaw
      : undefined;

  const pickRole = (item: ProductSetupItem, choice: ProductSetupChoice) => {
    setChoices((current) => ({ ...current, [item.key]: choice }));
    setActiveKey(item.key);
  };

  const total = items.length;

  const isRecipePanel = Boolean(activeItem && activeChoice === "recipe");

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
          <p>Escolha o que é o item na lista para continuar aqui.</p>
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
                ? "Na lista, diga o que é cada item. O detalhe abre ao lado."
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
            {isMobile ? (
              <ul className="space-y-2">
                {sorted.map((item) => {
                  const selected = item.key === activeKey;
                  return (
                    <li key={item.key}>
                      <div
                        className={cn(
                          "rounded-xl border p-3",
                          selected
                            ? "border-primary/40 bg-primary/5"
                            : "border-border/80 bg-card",
                        )}
                      >
                        <ItemIdentity item={item} />
                        <div className="mt-3">
                          <RoleSelect
                            item={item}
                            value={choices[item.key]}
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
                            "border-b last:border-0",
                            selected ? "bg-primary/5" : "hover:bg-muted/40",
                          )}
                        >
                          <td className="w-[32%] px-3 py-2.5">
                            <ItemIdentity item={item} />
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                            {formatTurnoverLine(item) ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <RoleSelect
                              item={item}
                              value={choices[item.key]}
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

            {panel}
          </div>
      ) : null}
    </div>
  );
}

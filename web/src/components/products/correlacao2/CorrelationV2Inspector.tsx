import { ProductSetupActionPanel } from "@/components/products/ProductSetupActionPanel";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SETUP_STOCK_ONLY_LABEL,
  setupItemShowsStockOnly,
  setupItemSourceLabel,
} from "@/lib/productSetupListFilter";
import {
  formatTurnoverLine,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import {
  INTENT_TO_CHOICE,
  intentLabel,
  type CorrelationCase,
  type CorrelationIntent,
} from "@/lib/productValidation/correlationCase";
import { cn } from "@/lib/utils";
import { Package, Sparkles } from "lucide-react";

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

function AiHint({
  selected,
  intent,
}: {
  selected: CorrelationCase;
  intent: CorrelationIntent;
}) {
  if (!selected.aiIntent) return null;
  const top = selected.counterparts[0];
  const score =
    selected.score > 0 ? `${selected.score.toLocaleString("pt-BR")}%` : null;
  const match = selected.aiIntent === intent;

  if (match) {
    return (
      <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-violet-900 dark:text-violet-200">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Sugestão do agente
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {top
            ? `${intentLabel(selected.aiIntent)} com «${top.item.name}»${score ? ` (${score})` : ""}.`
            : `${intentLabel(selected.aiIntent)}${score ? ` (${score})` : ""}.`}
        </p>
      </div>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      O agente sugeriu {intentLabel(selected.aiIntent).toLowerCase()}
      {top ? ` com «${top.item.name}»` : ""}.
    </p>
  );
}

export function CorrelationV2Inspector({
  companyId,
  queue,
  selected,
  intent,
  onIntentChange,
  onResolved,
}: {
  companyId: string;
  queue: ProductSetupQueue;
  selected: CorrelationCase | null;
  intent: CorrelationIntent | null;
  onIntentChange: (intent: CorrelationIntent) => void;
  onResolved: (productId: string) => void;
}) {
  if (!selected || !intent) {
    return (
      <section className="flex min-h-55 flex-col items-center justify-center gap-2 rounded-xl border border-border/80 bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        <Package className="h-8 w-8 opacity-40" />
        <p>Escolha um item na fila. O inspector abre o que dá para fazer.</p>
      </section>
    );
  }

  const choice = INTENT_TO_CHOICE[intent];
  const isRecipe = intent === "recipe" || intent === "produce";
  const stockOnly = setupItemShowsStockOnly(selected.subject, choice);
  const volume = formatTurnoverLine(selected.subject);

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-y-auto rounded-xl border border-border/80 bg-card p-4 lg:sticky lg:top-4 lg:max-h-[min(70vh,720px)]",
        isRecipe && "overflow-hidden",
      )}
    >
      <div className="mb-4 space-y-3">
        <div>
          <p className="text-base font-semibold">{selected.subject.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "font-normal",
                SOURCE_BADGE_CLASS[selected.subject.kind],
              )}
            >
              {setupItemSourceLabel(selected.subject)}
            </Badge>
            {stockOnly ? (
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
        <AiHint selected={selected} intent={intent} />
        <Select
          value={intent}
          onValueChange={(next) => onIntentChange(next as CorrelationIntent)}
        >
          <SelectTrigger className="h-9 w-full bg-background">
            <SelectValue placeholder="O que é este item?" />
          </SelectTrigger>
          <SelectContent>
            {selected.availableIntents.map((row) => (
              <SelectItem key={row} value={row}>
                {intentLabel(row)}
                {selected.aiIntent === row ? " · agente" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ProductSetupActionPanel
        key={`${selected.id}:${choice}`}
        companyId={companyId}
        item={selected.subject}
        choice={choice}
        soldOnly={queue.soldOnly}
        recipes={queue.recipes}
        purchases={queue.purchases}
        hideTitle
        onResolved={() => onResolved(selected.subject.productId)}
      />
    </section>
  );
}

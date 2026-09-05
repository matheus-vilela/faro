import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  SearchSelect,
  type SearchSelectOption,
} from "@/components/ui/search-select";
import {
  formatTurnoverLine,
  type ProductSetupItem,
} from "@/lib/productSetupQueue";
import type {
  RecipeSuggestion,
  SameItemSuggestion,
} from "@/lib/productValidation/types";
import { cn } from "@/lib/utils";
import { ChefHat, Loader2, Merge, Plus, Sparkles, X } from "lucide-react";

function pct(score: number, isZeroOne = false): string {
  const n = isZeroOne ? score * 100 : score;
  return `${Math.round(n).toLocaleString("pt-BR")}%`;
}

function itemOption(item: ProductSetupItem): SearchSelectOption {
  return {
    value: item.productId,
    label: item.name,
    description: formatTurnoverLine(item) ?? item.sourceLabel,
    keywords: [item.sku, item.ean, item.barcode, item.sourceLabel]
      .filter(Boolean)
      .join(" "),
  };
}

function withCurrentItem(
  items: ProductSetupItem[],
  current: ProductSetupItem | undefined,
): ProductSetupItem[] {
  if (!current) return items;
  if (items.some((row) => row.productId === current.productId)) return items;
  return [current, ...items];
}

function SideCard({
  title,
  sub,
  borderClass,
}: {
  title: string;
  sub: string;
  borderClass?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5",
        borderClass,
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-semibold leading-tight" title={title}>
          {title}
        </p>
        {sub ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ScoreMark({
  label,
  strong,
}: {
  label: string;
  strong: boolean;
}) {
  return (
    <div className="mx-auto mt-1 flex flex-col items-center self-start">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          strong
            ? "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {strong ? "=" : "≈"}
      </div>
      <span className="mt-1 tabular-nums text-[10px] font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function resolvePurchaseItems(
  selectedIds: string[],
  suggestion: SameItemSuggestion,
  purchaseChoices: ProductSetupItem[],
): ProductSetupItem[] {
  const byId = new Map<string, ProductSetupItem>();
  for (const row of suggestion.candidates) {
    byId.set(row.purchase.productId, row.purchase);
  }
  for (const row of purchaseChoices) {
    byId.set(row.productId, row);
  }
  return selectedIds
    .map((id) => byId.get(id))
    .filter((row): row is ProductSetupItem => Boolean(row));
}

export function SameItemRow({
  suggestion,
  selectedPurchaseIds,
  onAddPurchase,
  onRemovePurchase,
  selectedSoldId,
  onSelectSold,
  purchaseChoices,
  soldChoices,
  onConfirm,
  busy,
}: {
  suggestion: SameItemSuggestion;
  selectedPurchaseIds: string[];
  onAddPurchase: (purchaseId: string) => void;
  onRemovePurchase: (purchaseId: string) => void;
  selectedSoldId: string;
  onSelectSold: (soldId: string) => void;
  purchaseChoices: ProductSetupItem[];
  soldChoices: ProductSetupItem[];
  onConfirm: () => void;
  busy: boolean;
}) {
  const aiPurchaseIds = suggestion.candidates.map(
    (row) => row.purchase.productId,
  );
  const solds = withCurrentItem(soldChoices, suggestion.sold);
  const sold =
    solds.find((row) => row.productId === selectedSoldId) ?? suggestion.sold;
  const selectedPurchases = resolvePurchaseItems(
    selectedPurchaseIds,
    suggestion,
    purchaseChoices,
  );
  const addablePurchases = purchaseChoices.filter(
    (row) => !selectedPurchaseIds.includes(row.productId),
  );
  const edited =
    selectedSoldId !== suggestion.sold.productId ||
    selectedPurchaseIds.length !== aiPurchaseIds.length ||
    selectedPurchaseIds.some((id) => !aiPurchaseIds.includes(id));
  const topScore = suggestion.candidates[0]?.score;
  const soldSub = formatTurnoverLine(sold) || "PDV / EPOC";

  return (
    <li>
      <div
        className={cn(
          "grid items-start gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]",
          edited
            ? "border-amber-500/35 bg-amber-500/5"
            : "border-emerald-500/40 bg-emerald-500/5",
        )}
      >
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Sparkles
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                edited
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-emerald-700 dark:text-emerald-300",
              )}
            />
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide",
                edited
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-emerald-800 dark:text-emerald-200",
              )}
            >
              {edited ? "Vendido (PDV) · editado" : "Vendido (PDV)"}
            </p>
          </div>
          <SearchSelect
            value={selectedSoldId}
            onValueChange={onSelectSold}
            options={solds.map(itemOption)}
            placeholder="Escolher vendido"
            searchPlaceholder="Buscar vendido no PDV…"
            emptyMessage="Nenhum vendido na fila."
            disabled={busy}
            triggerClassName="h-auto min-h-10 bg-background px-3 py-2 text-left"
            contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
          />
          {soldSub ? (
            <p className="truncate px-0.5 text-xs text-muted-foreground">
              {soldSub}
            </p>
          ) : null}
          {suggestion.conflictWithRecipe ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              O nome também parece ficha técnica. Confirme se é o mesmo item
              da nota ou se é um prato.
            </p>
          ) : null}
        </div>

        <ScoreMark
          label={
            edited ? "editado" : topScore != null ? pct(topScore) : "—"
          }
          strong={!edited}
        />

        <div className="min-w-0 space-y-2 self-start">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Nota fiscal
          </p>
          {selectedPurchases.length > 0 ? (
            <ul className="space-y-1.5">
              {selectedPurchases.map((purchase) => {
                const candidate = suggestion.candidates.find(
                  (row) => row.purchase.productId === purchase.productId,
                );
                const sub =
                  formatTurnoverLine(purchase) ||
                  purchase.sourceLabel ||
                  "Nota / compra";
                return (
                  <li
                    key={purchase.productId}
                    className="flex items-start gap-2 rounded-lg border bg-background px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={purchase.name}>
                        {purchase.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={sub}>
                        {sub}
                        {candidate ? ` · ${pct(candidate.score)}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                      disabled={busy}
                      onClick={() => onRemovePurchase(purchase.productId)}
                      aria-label={`Remover ${purchase.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
              Nenhuma compra da nota neste vendido. Adicione ao menos uma.
            </p>
          )}
          {addablePurchases.length > 0 ? (
            <SearchSelect
              value=""
              onValueChange={onAddPurchase}
              options={addablePurchases.map(itemOption)}
              placeholder="Adicionar produto da nota"
              searchPlaceholder="Buscar compra da nota…"
              emptyMessage="Nenhuma compra disponível."
              disabled={busy}
              triggerClassName="h-auto min-h-10 bg-background px-3 py-2 text-left"
              contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                busy || selectedPurchaseIds.length === 0 || !selectedSoldId
              }
              onClick={onConfirm}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Merge className="mr-1.5 h-3.5 w-3.5" />
              )}
              Unificar
              {selectedPurchaseIds.length > 1
                ? ` (${selectedPurchaseIds.length})`
                : ""}
            </Button>
            {addablePurchases.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Plus className="h-3 w-3" />
                Pode haver mais de um cadastro da nota
              </span>
            ) : null}
          </div>
          {!edited && suggestion.candidates[0]?.reasons[0] ? (
            <p className="text-xs text-muted-foreground">
              {suggestion.candidates[0].reasons[0]}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function RecipeRow({
  suggestion,
  selectedIngredientIds,
  onToggleIngredient,
  onConfirmRecipe,
  onOpenSheet,
  busy,
}: {
  suggestion: RecipeSuggestion;
  selectedIngredientIds: Set<string>;
  onToggleIngredient: (purchaseId: string) => void;
  onConfirmRecipe: () => void;
  onOpenSheet: () => void;
  busy: boolean;
}) {
  const soldSub = formatTurnoverLine(suggestion.sold) ?? "PDV / venda";
  const canConfirmIngredients =
    suggestion.ingredients.length > 0 && selectedIngredientIds.size > 0;

  return (
    <li>
      <div className="grid items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Vendido (PDV)
          </p>
          <SideCard
            title={suggestion.sold.name}
            sub={soldSub}
            borderClass="border-violet-500/25"
          />
          {suggestion.masterRecipeName ? (
            <p className="text-xs text-muted-foreground">
              Modelo: {suggestion.masterRecipeName}
            </p>
          ) : null}
          {suggestion.summaryPt ? (
            <p className="text-xs text-muted-foreground">{suggestion.summaryPt}</p>
          ) : null}
        </div>

        <ScoreMark label={pct(suggestion.roleConfidence, true)} strong />

        <div className="min-w-0 space-y-2 self-start">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Nota fiscal
          </p>
          {suggestion.ingredients.length > 0 ? (
            <ul className="space-y-1.5">
              {suggestion.ingredients.map((ingredient) => {
                const checked = selectedIngredientIds.has(
                  ingredient.purchase.productId,
                );
                const sub = formatTurnoverLine(ingredient.purchase);
                return (
                  <li
                    key={`${ingredient.hintKey}:${ingredient.purchase.productId}`}
                    className="flex items-start gap-2 rounded-lg border bg-background px-2.5 py-2"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() =>
                        onToggleIngredient(ingredient.purchase.productId)
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {ingredient.hintLabel}
                      </p>
                      <p className="truncate text-sm font-medium">
                        {ingredient.purchase.name}
                      </p>
                      {sub ? (
                        <p className="truncate text-xs text-muted-foreground">{sub}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
              Não achamos insumos pelo nome das compras. Confirme que é ficha e
              informe os itens.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={canConfirmIngredients ? onConfirmRecipe : onOpenSheet}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChefHat className="mr-1.5 h-3.5 w-3.5" />
              )}
              {canConfirmIngredients ? "Confirmar ficha" : "Abrir ficha"}
            </Button>
            {suggestion.ingredients.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onOpenSheet}
              >
                Ajustar na ficha
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function ValidationMatchListHeader() {
  return (
    <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
      <div>Vendido (PDV)</div>
      <div className="w-9" />
      <div>Nota fiscal</div>
    </div>
  );
}

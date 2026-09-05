import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  SearchSelect,
  type SearchSelectOption,
} from "@/components/ui/search-select";
import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { SaleFamilyDestinationFields } from "@/components/products/SaleFamilyDestinationFields";
import {
  formatTurnoverLine,
  type ProductSetupItem,
} from "@/lib/productSetupQueue";
import {
  CORRELATION_SOLD_ROLES,
  correlationRightTitle,
  soldRoleHint,
  type CorrelationSoldRole,
} from "@/lib/productValidation/soldRole";
import type {
  RecipeSuggestion,
  SameItemSuggestion,
} from "@/lib/productValidation/types";
import { cn } from "@/lib/utils";
import {
  Layers,
  Link2,
  Loader2,
  Merge,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";

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

function CorrelationRecipePane({
  companyId,
  soldId,
  recipeId,
  ingredientIds,
  kind,
  onSaved,
}: {
  companyId: string;
  soldId: string;
  recipeId?: string | null;
  ingredientIds: string[];
  kind: "sale" | "intermediate";
  onSaved: () => void;
}) {
  return (
    <div className="min-h-[22rem] max-h-[36rem] overflow-hidden rounded-lg border bg-background">
      <EstoqueReceitasPanel
        key={`${soldId}:${kind}:${ingredientIds.join(",")}`}
        companyId={companyId}
        sheetOnly
        embedInline
        ingredientsOnly
        initialOpenRecipeId={recipeId ?? null}
        prefillNewRecipeOutputProductId={recipeId ? null : soldId}
        prefillNewRecipeAutoOpen={false}
        technicalSheetOutputProductId={soldId}
        technicalSheetKind={kind}
        contextOutputProductId={soldId}
        prefillIngredientProductIds={ingredientIds}
        onTechnicalSheetSaved={() => onSaved()}
      />
    </div>
  );
}

function CorrelationSoldRoleFields({
  companyId,
  soldProductId,
  role,
  onRoleChange,
  familyId,
  onFamilyChange,
  newFamilyName,
  onNewFamilyNameChange,
  busy,
}: {
  companyId: string;
  soldProductId: string;
  role: CorrelationSoldRole;
  onRoleChange: (role: CorrelationSoldRole) => void;
  familyId: string;
  onFamilyChange: (familyId: string) => void;
  newFamilyName: string;
  onNewFamilyNameChange: (name: string) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <SearchSelect
        value={role}
        onValueChange={(value) => onRoleChange(value as CorrelationSoldRole)}
        options={CORRELATION_SOLD_ROLES.map((row) => ({
          value: row.value,
          label: row.label,
          description: row.hint,
        }))}
        placeholder="O que é o vendido?"
        searchPlaceholder="Buscar papel…"
        emptyMessage="Nenhuma opção."
        disabled={busy}
        triggerClassName="h-auto min-h-10 bg-background px-3 py-2 text-left"
        contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
      />
      <p className="text-xs text-muted-foreground">{soldRoleHint(role)}</p>
      {role === "variant" ? (
        <SaleFamilyDestinationFields
          companyId={companyId}
          excludeProductId={soldProductId}
          familyId={familyId}
          newFamilyName={newFamilyName}
          onFamilyIdChange={onFamilyChange}
          onNewFamilyNameChange={onNewFamilyNameChange}
          disabled={busy}
        />
      ) : null}
    </div>
  );
}

function CorrelationSoldRoleActions({
  soldName,
  role,
  familyId,
  newFamilyName,
  busy,
  purchaseCount,
  canUnify,
  canAct,
  onUnify,
  onConfirmProduct,
  onConfirmGrouping,
  onConfirmVariant,
}: {
  soldName: string;
  role: CorrelationSoldRole;
  familyId: string;
  newFamilyName: string;
  busy: boolean;
  purchaseCount: number;
  canUnify: boolean;
  canAct: boolean;
  onUnify: () => void;
  onConfirmProduct: () => void;
  onConfirmGrouping: () => void;
  onConfirmVariant: () => void;
}) {
  const [confirmPromote, setConfirmPromote] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {role === "same_product" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || !canUnify || !canAct}
            onClick={onUnify}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Merge className="mr-1.5 h-3.5 w-3.5" />
            )}
            Unificar
            {purchaseCount > 1 ? ` (${purchaseCount})` : ""}
          </Button>
        ) : null}
        {role === "product" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || !canAct}
            onClick={onConfirmProduct}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Confirmar produto interno
          </Button>
        ) : null}
        {role === "grouping" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || !canAct}
            onClick={() => setConfirmPromote(true)}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers className="mr-1.5 h-3.5 w-3.5" />
            )}
            Confirmar agrupamento
          </Button>
        ) : null}
        {role === "variant" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || !canAct || (!familyId && !newFamilyName.trim())}
            onClick={onConfirmVariant}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Ligar ao agrupamento
          </Button>
        ) : null}
      </div>
      <AlertDialog open={confirmPromote} onOpenChange={setConfirmPromote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este produto é o agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A venda de «{soldName}» gera receita e não baixa estoque neste
              SKU.
              {purchaseCount > 0
                ? ` ${purchaseCount === 1 ? "A compra" : "As compras"} da nota ${
                    purchaseCount === 1 ? "vira" : "viram"
                  } variante.`
                : " A baixa vem das variantes ligadas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                setConfirmPromote(false);
                onConfirmGrouping();
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SameItemRow({
  companyId,
  suggestion,
  selectedPurchaseIds,
  onAddPurchase,
  onRemovePurchase,
  selectedSoldId,
  onSelectSold,
  purchaseChoices,
  soldChoices,
  role,
  onRoleChange,
  familyId,
  onFamilyChange,
  onConfirm,
  onConfirmProduct,
  onConfirmGrouping,
  onConfirmVariant,
  onRecipeSaved,
  busy,
}: {
  companyId: string;
  suggestion: SameItemSuggestion;
  selectedPurchaseIds: string[];
  onAddPurchase: (purchaseId: string) => void;
  onRemovePurchase: (purchaseId: string) => void;
  selectedSoldId: string;
  onSelectSold: (soldId: string) => void;
  purchaseChoices: ProductSetupItem[];
  soldChoices: ProductSetupItem[];
  role: CorrelationSoldRole;
  onRoleChange: (role: CorrelationSoldRole) => void;
  familyId: string;
  onFamilyChange: (familyId: string) => void;
  onConfirm: () => void;
  onConfirmProduct: () => void;
  onConfirmGrouping: () => void;
  onConfirmVariant: (newFamilyName: string) => void;
  onRecipeSaved: () => void;
  busy: boolean;
}) {
  const [newFamilyName, setNewFamilyName] = useState("");
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
            : "border-sky-500/40 bg-sky-500/5",
        )}
      >
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Sparkles
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                edited
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-sky-700 dark:text-sky-300",
              )}
            />
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide",
                edited
                  ? "text-amber-800 dark:text-amber-200"
                  : "text-sky-800 dark:text-sky-200",
              )}
            >
              {edited ? "Vendido (PDV) · editado" : "O que é o vendido?"}
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
          {suggestion.conflictWithRecipe && role === "same_product" ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              O nome também parece ficha (dose, porção, prato). Não unifique
              com a garrafa da nota — use Ficha técnica.
            </p>
          ) : null}
          <CorrelationSoldRoleFields
            companyId={companyId}
            soldProductId={selectedSoldId}
            role={role}
            onRoleChange={onRoleChange}
            familyId={familyId}
            onFamilyChange={onFamilyChange}
            newFamilyName={newFamilyName}
            onNewFamilyNameChange={setNewFamilyName}
            busy={busy}
          />
        </div>

        {role === "same_product" ? (
          <ScoreMark
            label={
              edited ? "editado" : topScore != null ? pct(topScore) : "—"
            }
            strong={!edited}
          />
        ) : (
          <div className="hidden w-9 sm:block" />
        )}

        <div className="min-w-0 space-y-2 self-start">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {correlationRightTitle(role)}
          </p>
          {role === "recipe" || role === "intermediate" ? (
            <CorrelationRecipePane
              companyId={companyId}
              soldId={selectedSoldId}
              recipeId={sold.recipeId}
              ingredientIds={selectedPurchaseIds}
              kind={role === "intermediate" ? "intermediate" : "sale"}
              onSaved={onRecipeSaved}
            />
          ) : null}
          {role === "product" ? (
            <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
              O vendido fica no catálogo. As compras da nota continuam na fila
              para tratar à parte.
            </p>
          ) : null}
          {role === "variant" ? (
            <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
              Escolha o agrupamento à esquerda. A nota só unifica se for o
              mesmo SKU — use «Pode ser mesmo produto da nota».
            </p>
          ) : null}
          {role === "same_product" || role === "grouping" ? (
            <>
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
                          <p
                            className="truncate text-sm font-medium"
                            title={purchase.name}
                          >
                            {purchase.name}
                          </p>
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={sub}
                          >
                            {sub}
                            {candidate ? ` · ${pct(candidate.score)}` : ""}
                            {role === "grouping" ? " · vira variante" : ""}
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
                  {role === "same_product"
                    ? "Nenhuma compra da nota neste vendido. Adicione ao menos uma."
                    : "Sem compras da nota. O agrupamento fica sem variantes por agora."}
                </p>
              )}
              {addablePurchases.length > 0 ? (
                <SearchSelect
                  value=""
                  onValueChange={onAddPurchase}
                  options={addablePurchases.map(itemOption)}
                  placeholder={
                    role === "grouping"
                      ? "Adicionar variante da nota"
                      : "Adicionar produto da nota"
                  }
                  searchPlaceholder="Buscar compra da nota…"
                  emptyMessage="Nenhuma compra disponível."
                  disabled={busy}
                  triggerClassName="h-auto min-h-10 bg-background px-3 py-2 text-left"
                  contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
                />
              ) : null}
            </>
          ) : null}
          {role !== "recipe" && role !== "intermediate" ? (
            <CorrelationSoldRoleActions
              soldName={sold.name}
              role={role}
              familyId={familyId}
              newFamilyName={newFamilyName}
              busy={busy}
              purchaseCount={selectedPurchaseIds.length}
              canUnify={selectedPurchaseIds.length > 0}
              canAct={Boolean(selectedSoldId)}
              onUnify={onConfirm}
              onConfirmProduct={onConfirmProduct}
              onConfirmGrouping={onConfirmGrouping}
              onConfirmVariant={() => onConfirmVariant(newFamilyName)}
            />
          ) : null}
          {role === "same_product" && addablePurchases.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Plus className="h-3 w-3" />
              Pode haver mais de um cadastro da nota
            </span>
          ) : null}
          {role === "same_product" &&
          !edited &&
          suggestion.candidates[0]?.reasons[0] ? (
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
  companyId,
  suggestion,
  selectedIngredientIds,
  role,
  onRoleChange,
  familyId,
  onFamilyChange,
  onUnify,
  onConfirmProduct,
  onConfirmGrouping,
  onConfirmVariant,
  onRecipeSaved,
  busy,
}: {
  companyId: string;
  suggestion: RecipeSuggestion;
  selectedIngredientIds: Set<string>;
  role: CorrelationSoldRole;
  onRoleChange: (role: CorrelationSoldRole) => void;
  familyId: string;
  onFamilyChange: (familyId: string) => void;
  onUnify: () => void;
  onConfirmProduct: () => void;
  onConfirmGrouping: () => void;
  onConfirmVariant: (newFamilyName: string) => void;
  onRecipeSaved: () => void;
  busy: boolean;
}) {
  const [newFamilyName, setNewFamilyName] = useState("");
  const soldSub = formatTurnoverLine(suggestion.sold) ?? "PDV / venda";
  const ingredientIds =
    selectedIngredientIds.size > 0
      ? [...selectedIngredientIds]
      : suggestion.ingredients.map((row) => row.purchase.productId);

  return (
    <li>
      <div className="grid items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            O que é o vendido?
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
          <CorrelationSoldRoleFields
            companyId={companyId}
            soldProductId={suggestion.sold.productId}
            role={role}
            onRoleChange={onRoleChange}
            familyId={familyId}
            onFamilyChange={onFamilyChange}
            newFamilyName={newFamilyName}
            onNewFamilyNameChange={setNewFamilyName}
            busy={busy}
          />
        </div>

        {role === "same_product" ? (
          <ScoreMark label={pct(suggestion.roleConfidence, true)} strong />
        ) : (
          <div className="hidden w-9 sm:block" />
        )}

        <div className="min-w-0 space-y-2 self-start">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {correlationRightTitle(role)}
          </p>
          {role === "recipe" || role === "intermediate" ? (
            <CorrelationRecipePane
              companyId={companyId}
              soldId={suggestion.sold.productId}
              recipeId={suggestion.sold.recipeId}
              ingredientIds={ingredientIds}
              kind={role === "intermediate" ? "intermediate" : "sale"}
              onSaved={onRecipeSaved}
            />
          ) : null}
          {role === "product" ? (
            <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
              O vendido fica no catálogo. As compras da nota continuam na fila
              para tratar à parte.
            </p>
          ) : null}
          {role === "variant" ? (
            <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
              Escolha o agrupamento à esquerda. A nota só unifica se for o
              mesmo SKU — use «Pode ser mesmo produto da nota».
            </p>
          ) : null}
          {role === "same_product" || role === "grouping" ? (
            <ul className="space-y-1.5">
              {suggestion.ingredients.map((ingredient) => {
                const sub = formatTurnoverLine(ingredient.purchase);
                return (
                  <li
                    key={`${ingredient.hintKey}:${ingredient.purchase.productId}`}
                    className="rounded-lg border bg-background px-2.5 py-2"
                  >
                    <p className="truncate text-sm font-medium">
                      {ingredient.purchase.name}
                    </p>
                    {sub ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {sub}
                        {role === "grouping" ? " · vira variante" : ""}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {role !== "recipe" && role !== "intermediate" ? (
            <CorrelationSoldRoleActions
              soldName={suggestion.sold.name}
              role={role}
              familyId={familyId}
              newFamilyName={newFamilyName}
              busy={busy}
              purchaseCount={selectedIngredientIds.size}
              canUnify={selectedIngredientIds.size > 0}
              canAct
              onUnify={onUnify}
              onConfirmProduct={onConfirmProduct}
              onConfirmGrouping={onConfirmGrouping}
              onConfirmVariant={() => onConfirmVariant(newFamilyName)}
            />
          ) : null}
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
      <div>Conforme o papel</div>
    </div>
  );
}

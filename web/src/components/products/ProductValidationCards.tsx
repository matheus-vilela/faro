import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { SaleFamilyDestinationFields } from "@/components/products/SaleFamilyDestinationFields";
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
import { Layers, Link2, Loader2, Merge, Trash2 } from "lucide-react";
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
        "flex min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5 w-full",
        borderClass,
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <p
          className="truncate text-sm font-semibold leading-tight"
          title={title}
        >
          {title}
        </p>
        {sub ? (
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={sub}
          >
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ScoreMark({ strong }: { strong: boolean }) {
  return (
    <div className="mx-auto mt-8 flex flex-col items-center self-start">
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
  suggestion,
  selectedPurchaseIds,
  onAddPurchase,
  onRemovePurchase,
  purchaseChoices,
  onConfirm,
  busy,
}: {
  suggestion: SameItemSuggestion;
  selectedPurchaseIds: string[];
  onAddPurchase: (purchaseId: string) => void;
  onRemovePurchase: (purchaseId: string) => void;
  purchaseChoices: ProductSetupItem[];
  onConfirm: () => void;
  busy: boolean;
}) {
  const aiPurchaseIds = suggestion.candidates.map(
    (row) => row.purchase.productId,
  );
  const sold = suggestion.sold;
  const selectedPurchases = resolvePurchaseItems(
    selectedPurchaseIds,
    suggestion,
    purchaseChoices,
  );
  const addablePurchases = purchaseChoices.filter(
    (row) => !selectedPurchaseIds.includes(row.productId),
  );
  const edited =
    selectedPurchaseIds.length !== aiPurchaseIds.length ||
    selectedPurchaseIds.some((id) => !aiPurchaseIds.includes(id));
  const topScore = suggestion.candidates[0]?.score;
  const soldSub = formatTurnoverLine(sold) || "PDV / venda";
  const canRemove = selectedPurchases.length > 1;

  return (
    <li>
      <div
        className={cn(
          "space-y-3 rounded-xl border bg-card p-3",
          // edited
          //   ? "border-amber-500/35 bg-amber-500/5"
          //   : "border-sky-500/40 bg-sky-500/5",
        )}
      >
        <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">
              Vendido (PDV)
            </p>

            <SideCard
              title={sold.name}
              sub={soldSub}
              borderClass="border-violet-500/30"
            />
          </div>
          <ScoreMark strong={!edited} />
          <div className="min-w-0 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {selectedPurchases.length > 1
                ? `Produtos da nota (${selectedPurchases.length})`
                : "Produtos da nota"}
            </p>
            {selectedPurchases.length === 0 ? (
              <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
                Nenhum produto da nota. Inclua um abaixo.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {selectedPurchases.map((purchase) => {
                  const candidate = suggestion.candidates.find(
                    (row) => row.purchase.productId === purchase.productId,
                  );
                  const sub = [
                    formatTurnoverLine(purchase) ||
                      purchase.sourceLabel ||
                      "Nota fiscal / compra",
                    candidate ? pct(candidate.score) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li
                      key={purchase.productId}
                      className="flex items-start gap-2"
                    >
                      <div className="w-full flex items-center gap-2">
                        <SideCard
                          title={purchase.name}
                          sub={sub}
                          borderClass="border-amber-500/30 w-full"
                        />
                        <div
                          className="p-4 rounded-lg border bg-background hover:bg-background/50 hover:text-destructive"
                          onClick={() => onRemovePurchase(purchase.productId)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </div>
                      </div>
                      {/* {canRemove ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-1 h-7 w-7 shrink-0 text-muted-foreground"
                          disabled={busy}
                          onClick={() => onRemovePurchase(purchase.productId)}
                          aria-label={`Remover ${purchase.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      ) : null} */}
                    </li>
                  );
                })}
              </ul>
            )}
            <SearchSelect
              value=""
              onValueChange={onAddPurchase}
              options={addablePurchases.map(itemOption)}
              placeholder="Incluir outro cadastro da nota"
              searchPlaceholder="Buscar compra da nota…"
              emptyMessage="Nenhuma compra disponível."
              disabled={busy || addablePurchases.length === 0}
              size="sm"
              triggerClassName="h-12 bg-background"
              contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* <p className="text-xs text-muted-foreground">
            {selectedPurchases.length > 1
              ? `${selectedPurchases.length} cadastros da nota unificam neste vendido.`
              : (suggestion.candidates[0]?.reasons[0] ??
                "Só o mesmo item de estoque. Ficha fica em Para corrigir.")}
          </p> */}
          <Button
            type="button"
            size="sm"
            disabled={busy || selectedPurchases.length === 0}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Merge className="mr-1.5 h-3.5 w-3.5" />
            )}
            Unificar
            {selectedPurchases.length > 1
              ? ` (${selectedPurchases.length})`
              : ""}
          </Button>
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
            <p className="text-xs text-muted-foreground">
              {suggestion.summaryPt}
            </p>
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
          <ScoreMark strong />
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
              Escolha o agrupamento à esquerda. A nota só unifica se for o mesmo
              SKU — use «Unificar com produto».
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
      <div>Produtos da nota</div>
    </div>
  );
}

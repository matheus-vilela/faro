import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  SearchSelect,
  type SearchSelectOption,
} from "@/components/ui/search-select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { setupItemSourceLabel } from "@/lib/productSetupListFilter";
import {
  formatTurnoverLine,
  maxTurnoverAmount,
  maxTurnoverQty,
  type ProductSetupItem,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import {
  patchProductValidationSession,
  samePickIds,
} from "@/lib/productValidation/session";
import {
  isInitialUnifyMatch,
  type ProductValidationResult,
  type SameItemSuggestion,
} from "@/lib/productValidation/types";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import { Loader2, Merge, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type ConfirmRow = {
  id: string;
  turnover: number;
  volume: number;
  suggestion: SameItemSuggestion;
};

type SortKey = "name" | "turnover";

async function fetchProductById(productId: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Product;
}

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

function resolvePurchases(
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

function compareRows(a: ConfirmRow, b: ConfirmRow, key: SortKey): number {
  if (key === "name") {
    return a.suggestion.sold.name.localeCompare(
      b.suggestion.sold.name,
      "pt-BR",
    );
  }
  return (
    a.turnover - b.turnover ||
    a.volume - b.volume ||
    a.id.localeCompare(b.id, "pt-BR")
  );
}

function ProductCell({
  item,
  tone,
}: {
  item: ProductSetupItem;
  tone: "sold" | "purchase";
}) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium" title={item.name}>
        {item.name}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            "font-normal",
            tone === "sold"
              ? "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-200"
              : "border-amber-500/35 bg-amber-500/15 text-amber-900 dark:text-amber-200",
          )}
        >
          {setupItemSourceLabel(item)}
        </Badge>
        {formatTurnoverLine(item) ? (
          <span className="text-xs text-muted-foreground">
            {formatTurnoverLine(item)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EqualsMark({ approx }: { approx: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold mt-3",
        approx
          ? "bg-muted text-muted-foreground"
          : "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30",
      )}
      aria-hidden
    >
      {approx ? "≈" : "="}
    </div>
  );
}

function PurchaseList({
  suggestion,
  selectedPurchaseIds,
  purchaseChoices,
  busy,
  onAddPurchase,
  onRemovePurchase,
}: {
  suggestion: SameItemSuggestion;
  selectedPurchaseIds: string[];
  purchaseChoices: ProductSetupItem[];
  busy: boolean;
  onAddPurchase: (id: string) => void;
  onRemovePurchase: (id: string) => void;
}) {
  const selected = resolvePurchases(
    selectedPurchaseIds,
    suggestion,
    purchaseChoices,
  );
  const addable = purchaseChoices.filter(
    (row) => !selectedPurchaseIds.includes(row.productId),
  );

  return (
    <div className="min-w-0 space-y-1.5">
      {selected.length === 0 ? (
        <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
          Nenhum produto da nota. Inclua um abaixo.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {selected.map((purchase) => (
            <li key={purchase.productId} className="flex items-center gap-2">
              <div className="min-w-0 flex-1 rounded-lg border border-amber-500/30 bg-background px-3 py-2">
                <ProductCell item={purchase} tone="purchase" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={() => onRemovePurchase(purchase.productId)}
                aria-label={`Remover ${purchase.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <SearchSelect
        value=""
        onValueChange={onAddPurchase}
        options={addable.map(itemOption)}
        placeholder="Incluir outro cadastro da nota"
        searchPlaceholder="Buscar compra da nota…"
        emptyMessage="Nenhuma compra disponível."
        disabled={busy || addable.length === 0}
        size="sm"
        triggerClassName="h-9 bg-background"
        contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
      />
    </div>
  );
}

function RowActions({
  busy,
  canUnify,
  unifyCount,
  onUnify,
  onDismiss,
}: {
  busy: boolean;
  canUnify: boolean;
  unifyCount: number;
  onUnify: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        size="sm"
        disabled={busy || !canUnify}
        onClick={onUnify}
        className="w-30"
      >
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Merge className="mr-1.5 h-3.5 w-3.5" />
        )}
        Unificar
        {unifyCount > 1 ? ` (${unifyCount})` : ""}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onDismiss}
        className="w-30"
      >
        <X className="mr-1.5 h-3.5 w-3.5" />
        Remover
      </Button>
    </div>
  );
}

export function CorrelationSameProductSection({
  companyId,
  result,
  queue,
  samePick,
  soldPick,
  onResolved,
}: {
  companyId: string;
  result: ProductValidationResult;
  queue: ProductSetupQueue | null;
  samePick: Record<string, string[]>;
  soldPick: Record<string, string>;
  onResolved: () => void;
}) {
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState(false);
  const [mergeProduct, setMergeProduct] = useState<Product | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePartnerIds, setMergePartnerIds] = useState<string[]>([]);

  const confirmRows = useMemo(() => {
    const rows = result.sameItem
      .filter(isInitialUnifyMatch)
      .map((suggestion) => ({
        id: suggestion.id,
        turnover: maxTurnoverAmount(
          suggestion.sold,
          ...suggestion.candidates.map((c) => c.purchase),
        ),
        volume: maxTurnoverQty(
          suggestion.sold,
          ...suggestion.candidates.map((c) => c.purchase),
        ),
        suggestion,
      }));
    rows.sort(
      (a, b) =>
        b.turnover - a.turnover ||
        b.volume - a.volume ||
        a.id.localeCompare(b.id, "pt-BR"),
    );
    return rows;
  }, [result]);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    ConfirmRow,
    SortKey
  >(confirmRows, "turnover", compareRows, false);

  const purchaseItems = useMemo(
    () =>
      (queue?.items ?? []).filter((item) => item.kind === "purchase_unlinked"),
    [queue],
  );

  const openUnify = async (soldId: string, partnerIds: string[]) => {
    if (partnerIds.length === 0 || !soldId) return;
    setBusy(true);
    const product = await fetchProductById(soldId);
    setBusy(false);
    if (!product) {
      toast.error("Não foi possível carregar o produto do PDV.");
      return;
    }
    setMergeProduct(product);
    setMergePartnerIds(partnerIds);
    setMergeOpen(true);
  };

  const confirmSameItem = async (suggestionId: string) => {
    const suggestion = result.sameItem.find((row) => row.id === suggestionId);
    if (!suggestion) return;
    const partnerIds = samePickIds(samePick, suggestionId);
    const soldId = soldPick[suggestionId] ?? suggestion.sold.productId;
    await openUnify(soldId, partnerIds);
  };

  const addSamePurchase = (suggestionId: string, purchaseId: string) => {
    if (!purchaseId) return;
    patchProductValidationSession(companyId, (current) => {
      const prev = samePickIds(current.samePick, suggestionId);
      if (prev.includes(purchaseId)) return {};
      return {
        samePick: {
          ...current.samePick,
          [suggestionId]: [...prev, purchaseId],
        },
      };
    });
  };

  const removeSamePurchase = (suggestionId: string, purchaseId: string) => {
    patchProductValidationSession(companyId, (current) => ({
      samePick: {
        ...current.samePick,
        [suggestionId]: samePickIds(current.samePick, suggestionId).filter(
          (id) => id !== purchaseId,
        ),
      },
    }));
  };

  const dismissUnify = (suggestionId: string) => {
    patchProductValidationSession(companyId, (current) => {
      if (!current.result) return {};
      const sameItem = current.result.sameItem.filter(
        (row) => row.id !== suggestionId,
      );
      return {
        result: {
          ...current.result,
          sameItem,
          stats: {
            ...current.result.stats,
            sameItem: sameItem.length,
          },
        },
      };
    });
  };

  if (confirmRows.length === 0) return null;

  const rowProps = (row: ConfirmRow) => {
    const currentPurchaseIds = samePickIds(samePick, row.id);
    const takenPurchases = new Set<string>();
    for (const other of confirmRows) {
      if (other.id === row.id) continue;
      for (const purchaseId of samePickIds(samePick, other.id)) {
        takenPurchases.add(purchaseId);
      }
    }
    const choices = [
      ...row.suggestion.candidates.map((candidate) => candidate.purchase),
      ...purchaseItems,
    ].filter(
      (item, index, list) =>
        list.findIndex((other) => other.productId === item.productId) ===
          index &&
        (currentPurchaseIds.includes(item.productId) ||
          !takenPurchases.has(item.productId)),
    );
    const aiIds = row.suggestion.candidates.map((c) => c.purchase.productId);
    const edited =
      currentPurchaseIds.length !== aiIds.length ||
      currentPurchaseIds.some((id) => !aiIds.includes(id));
    return { currentPurchaseIds, choices, edited };
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Mesmo produto (≥ 90%)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Só unificação de cadastros iguais. Se o vendido for ficha ou outro
          papel, use Não unificar — o item continua em Para corrigir.
        </p>
      </div>

      {isMobile ? (
        <ul className="space-y-2">
          {sorted.map((row) => {
            const { currentPurchaseIds, choices, edited } = rowProps(row);
            return (
              <li
                key={row.id}
                className="space-y-3 rounded-xl border border-border/80 bg-card p-3"
              >
                <div className="grid items-start gap-2 grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
                  <div className="min-w-0 rounded-lg border border-violet-500/30 bg-background px-3 py-2">
                    <ProductCell item={row.suggestion.sold} tone="sold" />
                  </div>
                  <EqualsMark approx={edited} />
                  <PurchaseList
                    suggestion={row.suggestion}
                    selectedPurchaseIds={currentPurchaseIds}
                    purchaseChoices={choices}
                    busy={busy}
                    onAddPurchase={(id) => addSamePurchase(row.id, id)}
                    onRemovePurchase={(id) => removeSamePurchase(row.id, id)}
                  />
                </div>
                <RowActions
                  busy={busy}
                  canUnify={currentPurchaseIds.length > 0}
                  unifyCount={currentPurchaseIds.length}
                  onUnify={() => void confirmSameItem(row.id)}
                  onDismiss={() => dismissUnify(row.id)}
                />
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
                  label="Vendido (PDV)"
                  column="name"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <th className="w-14 px-2 py-2.5" aria-hidden />
                <th className="px-3 py-2.5 font-medium">Produtos da nota</th>
                <th className="w-56 px-3 py-2.5 font-medium text-right">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const { currentPurchaseIds, choices, edited } = rowProps(row);
                return (
                  <tr key={row.id} className="border-b align-top last:border-0">
                    <td className="w-[28%] px-3 py-3">
                      <div className="rounded-lg border border-violet-500/30 bg-background px-3 py-2">
                        <ProductCell item={row.suggestion.sold} tone="sold" />
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <EqualsMark approx={edited} />
                    </td>
                    <td className="px-3 py-3">
                      <PurchaseList
                        suggestion={row.suggestion}
                        selectedPurchaseIds={currentPurchaseIds}
                        purchaseChoices={choices}
                        busy={busy}
                        onAddPurchase={(id) => addSamePurchase(row.id, id)}
                        onRemovePurchase={(id) =>
                          removeSamePurchase(row.id, id)
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <RowActions
                        busy={busy}
                        canUnify={currentPurchaseIds.length > 0}
                        unifyCount={currentPurchaseIds.length}
                        onUnify={() => void confirmSameItem(row.id)}
                        onDismiss={() => dismissUnify(row.id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mergeProduct ? (
        <ProductMergeDialog
          open={mergeOpen}
          onOpenChange={(open) => {
            setMergeOpen(open);
            if (!open) setMergePartnerIds([]);
          }}
          companyId={companyId}
          sourceProduct={mergeProduct}
          formatCurrency={formatCurrency}
          initialPartnerId={mergePartnerIds[0] ?? null}
          initialPartnerIds={mergePartnerIds}
          initialSurvivorIsSource
          onMerged={() => {
            setMergeOpen(false);
            setMergePartnerIds([]);
            onResolved();
          }}
        />
      ) : null}
    </section>
  );
}

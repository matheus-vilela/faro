import { ProductUnitPickerWithConversion } from "@/components/products/ProductUnitPickerWithConversion";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  productSearchOption,
  SearchSelect,
} from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getLockedSystemSecondaryQty } from "@/lib/companyUnits/convert";
import { getSystemProductUnitSelectOptions } from "@/lib/companyUnits/productUnitOptions";
import {
  SYSTEM_PRODUCT_UNITS,
  systemUnitLabel,
} from "@/lib/companyUnits/systemUnits";
import {
  expenseItemVinculoBadgeClassName,
  expenseItemVinculoKind,
  expenseItemVinculoLabel,
} from "@/lib/expenseItemVinculo";
import { stripPackSizeFromLabel } from "@/lib/productImport/packSizeFromLabel";
import { parseProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import { loadProductUnitConversions } from "@/lib/productUnitConversionsService";
import {
  initialDraftFromItem,
  isExpenseItemDraftDirty,
  saveExpenseItemLinkEdit,
  stockQuantityForDraft,
  type ExpenseItemLinkEditDraft,
} from "@/lib/saveExpenseItemLinkEdit";
import { cn } from "@/lib/utils";
import type { ExpenseItem } from "@/types/expense";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const CREATE_VALUE = "__new__";
const NONE_VALUE = "__none__";
const EDIT_ROW_GRID =
  "min-w-[68rem] grid-cols-[minmax(10rem,1.1fr)_minmax(14rem,1.4fr)_minmax(10rem,12rem)_5.5rem_7rem_6.5rem_auto] gap-x-3 px-3";

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function formatQty(v: number): string {
  return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function invoiceLineLabel(item: ExpenseItem): string {
  const raw = item.product_name || "";
  return stripPackSizeFromLabel(raw).trim() || raw || "—";
}

function allowedUnitsForDraft(
  draft: ExpenseItemLinkEditDraft,
  hubUnit: string,
  invoiceUnit: string | null | undefined,
): string[] {
  const systemUnitCodes = SYSTEM_PRODUCT_UNITS.map((u) => u.code);
  const allowed = new Set<string>([hubUnit, ...systemUnitCodes]);
  if (draft.invoiceUnit) allowed.add(draft.invoiceUnit);
  if (invoiceUnit) allowed.add(invoiceUnit);
  for (const c of draft.conversions) {
    if (
      c.primary_unit_code?.trim().toLowerCase() === hubUnit.trim().toLowerCase()
    ) {
      allowed.add(c.secondary_unit_code);
    }
  }
  for (const candidate of ["mg", "g", "kg", "ml", "l"]) {
    if (candidate.toLowerCase() === hubUnit.trim().toLowerCase()) continue;
    if (getLockedSystemSecondaryQty(1, hubUnit, candidate) != null) {
      allowed.add(candidate);
    }
  }
  return [...allowed];
}

type RowState = {
  draft: ExpenseItemLinkEditDraft;
  pristine: ExpenseItemLinkEditDraft;
};

function ExpenseItemReadOnlyTable({
  items,
  highlightMissingVinculo,
}: {
  items: ExpenseItem[];
  highlightMissingVinculo: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="p-2 text-left font-medium">Produto</th>
            <th className="p-2 text-left font-medium">Vínculo</th>
            <th className="p-2 text-right font-medium">Qtd</th>
            <th className="p-2 text-right font-medium">Valor un.</th>
            <th className="p-2 text-right font-medium">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const catalogName = it.products?.name?.trim();
            const stagedName =
              it.metadata_json?.pending_new_product?.name?.trim();
            const stripped = invoiceLineLabel(it);
            const primary =
              catalogName || stagedName || stripped || it.product_name || "—";
            const vinculoKind = expenseItemVinculoKind(it);
            const missingVinculo =
              highlightMissingVinculo && vinculoKind === "none";
            return (
              <tr key={it.id ?? i} className="border-t">
                <td className="p-2">
                  <span>{primary}</span>
                  {it.metadata_json?.product_merge ? (
                    <Badge
                      variant="outline"
                      className="mt-1.5 text-xs font-normal"
                    >
                      Unificado de{" "}
                      {it.metadata_json.product_merge.from_product_name}
                    </Badge>
                  ) : null}
                  {catalogName && stripped !== catalogName ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Nota: {stripped}
                    </p>
                  ) : null}
                  {!catalogName && stagedName && stagedName !== stripped ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Nota: {stripped}
                    </p>
                  ) : null}
                </td>
                <td className="p-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-normal",
                      expenseItemVinculoBadgeClassName(vinculoKind),
                      missingVinculo && "ring-1 ring-amber-500/60",
                    )}
                  >
                    {expenseItemVinculoLabel(vinculoKind)}
                  </Badge>
                </td>
                <td className="p-2 text-right tabular-nums">{it.quantity}</td>
                <td className="p-2 text-right tabular-nums">
                  {formatCurrency(Number(it.unit_value))}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatCurrency(
                    Number(it.quantity) * Number(it.unit_value),
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseItemInlineRow({
  item,
  itemId,
  draft,
  dirty,
  saving,
  companyId,
  productById,
  productSelectOptions,
  highlightMissingVinculo,
  onDraftChange,
  onConversionsLoaded,
  onRequestSave,
}: {
  item: ExpenseItem;
  itemId: string;
  draft: ExpenseItemLinkEditDraft;
  dirty: boolean;
  saving: boolean;
  companyId: string;
  productById: Map<string, Product>;
  productSelectOptions: ReturnType<typeof productSearchOption>[];
  highlightMissingVinculo: boolean;
  onDraftChange: (next: ExpenseItemLinkEditDraft) => void;
  onConversionsLoaded: (
    itemId: string,
    productId: string,
    rows: ProductUnitConversionDraft[],
  ) => void;
  onRequestSave: () => void;
}) {
  const unitOptions = useMemo(() => getSystemProductUnitSelectOptions(), []);
  const vinculoKind =
    draft.mode === "link"
      ? "linked"
      : draft.mode === "create"
        ? "new_product"
        : "none";
  const missingVinculo = highlightMissingVinculo && vinculoKind === "none";
  const linkedProduct =
    draft.mode === "link" && draft.productId
      ? productById.get(draft.productId)
      : undefined;
  const hubUnit =
    draft.mode === "create"
      ? draft.newProductUnit || "un"
      : (linkedProduct?.unit ?? "un");
  const allowedUnits = useMemo(
    () => allowedUnitsForDraft(draft, hubUnit, item.invoice_unit),
    [draft, hubUnit, item.invoice_unit],
  );
  const stockQtyPreview =
    draft.mode === "none"
      ? null
      : stockQuantityForDraft(
          draft.quantity,
          draft.invoiceUnit,
          hubUnit,
          draft.conversions,
        );
  const selectValue =
    draft.mode === "create"
      ? CREATE_VALUE
      : draft.mode === "link" && draft.productId
        ? draft.productId
        : NONE_VALUE;
  const canSubmit =
    draft.quantity > 0 &&
    draft.unitValue >= 0 &&
    (draft.mode !== "create" || !!draft.newProductName.trim()) &&
    (draft.mode !== "link" || !!draft.productId);

  useEffect(() => {
    if (draft.mode !== "link" || !draft.productId) return;
    const productId = draft.productId;
    let cancelled = false;
    void loadProductUnitConversions(companyId, productId).then((res) => {
      if (cancelled || res.error) return;
      onConversionsLoaded(itemId, productId, res.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, draft.mode, draft.productId, itemId, onConversionsLoaded]);

  const handleModeChange = (value: string) => {
    if (value === CREATE_VALUE) {
      onDraftChange({
        ...draft,
        mode: "create",
        productId: null,
        newProductName: draft.newProductName || item.product_name,
        newProductUnit:
          draft.newProductUnit ||
          (item.invoice_unit ?? "un").toLowerCase() ||
          "un",
        invoiceUnit: draft.invoiceUnit ?? item.invoice_unit ?? null,
        conversions: draft.mode === "create" ? draft.conversions : [],
      });
      return;
    }
    if (value === NONE_VALUE) {
      onDraftChange({
        ...draft,
        mode: "none",
        productId: null,
        conversions: [],
      });
      return;
    }
    const product = productById.get(value);
    onDraftChange({
      ...draft,
      mode: "link",
      productId: value,
      invoiceUnit:
        draft.invoiceUnit || item.invoice_unit || product?.unit || null,
      conversions: product
        ? parseProductUnitConversionsJson(
            product.unit_conversions,
            companyId,
            product.id,
          )
        : [],
    });
  };

  const fieldClass = "h-9";

  return (
    <div className={cn("grid items-start py-2.5", EDIT_ROW_GRID)}>
      <div className="min-w-0">
        <div className="flex min-h-9 min-w-0 items-center gap-2">
          <p className="truncate font-medium leading-snug">
            {invoiceLineLabel(item)}
          </p>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 font-normal",
              expenseItemVinculoBadgeClassName(vinculoKind),
              missingVinculo && "ring-1 ring-amber-500/60",
            )}
          >
            {expenseItemVinculoLabel(vinculoKind)}
          </Badge>
        </div>
        {item.metadata_json?.product_merge ? (
          <Badge variant="outline" className="mt-1 text-xs font-normal">
            Unificado de {item.metadata_json.product_merge.from_product_name}
          </Badge>
        ) : null}
      </div>

      <div className="min-w-0 space-y-1.5">
        <SearchSelect
          value={selectValue}
          onValueChange={handleModeChange}
          options={productSelectOptions}
          leadingOptions={[
            {
              value: CREATE_VALUE,
              label: "Criar novo produto no Faro",
              accent: true,
            },
            { value: NONE_VALUE, label: "Sem vínculo" },
          ]}
          placeholder="Escolher produto"
          searchPlaceholder="Buscar produto…"
          emptyMessage="Nenhum produto encontrado."
          listMaxHeightClassName="max-h-[min(40vh,260px)]"
          triggerClassName={fieldClass}
          disabled={saving}
        />
        {draft.mode === "create" ? (
          <div className="grid grid-cols-[1fr_7.5rem] gap-1.5">
            <Input
              value={draft.newProductName}
              disabled={saving}
              className={fieldClass}
              placeholder="Nome no Faro"
              onChange={(e) =>
                onDraftChange({ ...draft, newProductName: e.target.value })
              }
            />
            <Select
              value={draft.newProductUnit}
              disabled={saving}
              onValueChange={(v) =>
                onDraftChange({ ...draft, newProductUnit: v })
              }
            >
              <SelectTrigger className={cn("w-full", fieldClass)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unitOptions.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        {draft.mode !== "none" ? (
          <>
            <ProductUnitPickerWithConversion
              companyId={companyId}
              stockUnitCode={hubUnit}
              hubUnitCode={hubUnit}
              unitCodes={allowedUnits}
              value={draft.invoiceUnit ?? hubUnit}
              onValueChange={(code) =>
                onDraftChange({ ...draft, invoiceUnit: code })
              }
              conversions={draft.conversions}
              onConversionsChange={(next: ProductUnitConversionDraft[]) =>
                onDraftChange({ ...draft, conversions: next })
              }
              disabled={saving}
              placeholder="Unidade da NF"
              triggerClassName={fieldClass}
            />
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
              Estoque:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {stockQtyPreview != null
                  ? `${formatQty(stockQtyPreview)} ${hubUnit}`
                  : "— (defina conversão)"}
              </span>
            </p>
          </>
        ) : (
          <p className="pt-2 text-xs text-muted-foreground">—</p>
        )}
      </div>

      <Input
        type="number"
        min={0}
        step="any"
        className={cn(fieldClass, "text-right tabular-nums")}
        value={draft.quantity}
        disabled={saving}
        onChange={(e) =>
          onDraftChange({
            ...draft,
            quantity: parseFloat(e.target.value) || 0,
          })
        }
      />
      <Input
        type="number"
        min={0}
        step="0.01"
        className={cn(fieldClass, "text-right tabular-nums")}
        value={draft.unitValue}
        disabled={saving}
        onChange={(e) =>
          onDraftChange({
            ...draft,
            unitValue: parseFloat(e.target.value) || 0,
          })
        }
      />
      <p className="flex min-h-9 items-center justify-end text-sm font-medium tabular-nums">
        {formatCurrency(draft.quantity * draft.unitValue)}
      </p>
      <Button
        type="button"
        size="sm"
        className="h-9 shrink-0"
        disabled={!dirty || !canSubmit || saving}
        onClick={onRequestSave}
      >
        {saving ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}

export function ExpenseItemsInlineTable({
  items,
  canEdit,
  companyId,
  products,
  deferProductCreation,
  highlightMissingVinculo,
  onSaved,
}: {
  items: ExpenseItem[];
  canEdit: boolean;
  companyId: string;
  products: Product[];
  deferProductCreation: boolean;
  highlightMissingVinculo: boolean;
  onSaved: (created?: Product) => void;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const itemIdsKey = items.map((it) => it.id).join(",");
  const hydratedIdsRef = useRef<Set<string>>(new Set());

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const productSelectOptions = useMemo(
    () => products.filter((p) => p.is_active !== false).map(productSearchOption),
    [products],
  );

  useEffect(() => {
    hydratedIdsRef.current = new Set();
    setRows({});
    setConfirmId(null);
  }, [itemIdsKey, companyId]);

  useEffect(() => {
    if (!canEdit) return;
    const toHydrate = items.filter(
      (it): it is ExpenseItem & { id: string } =>
        !!it.id && !hydratedIdsRef.current.has(it.id),
    );
    if (toHydrate.length === 0) return;

    for (const it of toHydrate) {
      hydratedIdsRef.current.add(it.id);
      const initial = initialDraftFromItem(it, companyId);
      setRows((prev) => ({
        ...prev,
        [it.id]: { draft: initial, pristine: initial },
      }));
    }
  }, [canEdit, companyId, items]);

  const handleDraftChange = useCallback(
    (itemId: string, next: ExpenseItemLinkEditDraft) => {
      setRows((prev) => {
        const cur = prev[itemId];
        if (!cur) return prev;
        return { ...prev, [itemId]: { ...cur, draft: next } };
      });
    },
    [],
  );

  const handleConversionsLoaded = useCallback(
    (
      itemId: string,
      productId: string,
      conversionRows: ProductUnitConversionDraft[],
    ) => {
      setRows((prev) => {
        const cur = prev[itemId];
        if (!cur || cur.draft.productId !== productId) return prev;
        if (
          conversionRows.length === 0 &&
          cur.draft.conversions.length > 0
        ) {
          return prev;
        }
        const wasPristine = !isExpenseItemDraftDirty(cur.draft, cur.pristine);
        const nextDraft = { ...cur.draft, conversions: conversionRows };
        return {
          ...prev,
          [itemId]: {
            draft: nextDraft,
            pristine: wasPristine
              ? { ...cur.pristine, conversions: conversionRows }
              : cur.pristine,
          },
        };
      });
    },
    [],
  );

  const confirmItem = confirmId
    ? items.find((it) => it.id === confirmId)
    : undefined;
  const confirmRow = confirmId ? rows[confirmId] : undefined;
  const confirmProduct =
    confirmRow?.draft.mode === "link" && confirmRow.draft.productId
      ? productById.get(confirmRow.draft.productId)
      : undefined;
  const confirmHub =
    confirmRow?.draft.mode === "create"
      ? confirmRow.draft.newProductUnit || "un"
      : (confirmProduct?.unit ?? "un");

  const handleConfirm = async () => {
    if (!confirmItem?.id || !confirmRow) return;
    setSavingId(confirmItem.id);
    const result = await saveExpenseItemLinkEdit({
      companyId,
      item: confirmItem,
      draft: confirmRow.draft,
      deferProductCreation,
    });
    setSavingId(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Item atualizado.");
    hydratedIdsRef.current.delete(confirmItem.id);
    setRows((prev) => {
      const next = { ...prev };
      delete next[confirmItem.id!];
      return next;
    });
    setConfirmId(null);
    onSaved(result.createdProduct);
  };

  if (items.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Itens da nota fiscal
      </p>
      {canEdit ? (
        <div className="overflow-x-auto rounded-lg border">
          <div
            className={cn(
              "grid items-center bg-muted/50 py-2 text-xs font-medium text-muted-foreground",
              EDIT_ROW_GRID,
            )}
          >
            <span>Produto</span>
            <span>Vínculo</span>
            <span>Unidade NF → estoque</span>
            <span className="text-right">Qtd</span>
            <span className="text-right">Valor un.</span>
            <span className="text-right">Subtotal</span>
            <span className="sr-only">Ações</span>
          </div>
          <div className="divide-y border-t">
          {items.map((it, i) => {
            if (!it.id) return null;
            const row = rows[it.id];
            if (!row) {
              return (
                <div key={it.id ?? i} className="p-3">
                  <p className="text-sm text-muted-foreground">Carregando…</p>
                </div>
              );
            }
            return (
              <ExpenseItemInlineRow
                key={it.id}
                item={it}
                itemId={it.id}
                draft={row.draft}
                dirty={isExpenseItemDraftDirty(row.draft, row.pristine)}
                saving={savingId === it.id}
                companyId={companyId}
                productById={productById}
                productSelectOptions={productSelectOptions}
                highlightMissingVinculo={highlightMissingVinculo}
                onDraftChange={(next) => handleDraftChange(it.id!, next)}
                onConversionsLoaded={handleConversionsLoaded}
                onRequestSave={() => setConfirmId(it.id!)}
              />
            );
          })}
          </div>
        </div>
      ) : (
        <ExpenseItemReadOnlyTable
          items={items}
          highlightMissingVinculo={highlightMissingVinculo}
        />
      )}

      <AlertDialog
        open={!!confirmId}
        onOpenChange={(next) => {
          if (savingId) return;
          if (!next) setConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar alteração do item?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-pretty">
              {confirmItem && confirmRow ? (
                <>
                  <span className="block">
                    Vínculo:{" "}
                    <strong className="text-foreground">
                      {expenseItemVinculoLabel(
                        confirmRow.draft.mode === "link"
                          ? "linked"
                          : confirmRow.draft.mode === "create"
                            ? "new_product"
                            : "none",
                      )}{" "}
                      —{" "}
                      {confirmRow.draft.mode === "link"
                        ? (confirmProduct?.name ?? "produto existente")
                        : confirmRow.draft.mode === "create"
                          ? confirmRow.draft.newProductName.trim()
                          : "sem produto no Faro"}
                    </strong>
                  </span>
                  <span className="block">
                    Quantidade:{" "}
                    <strong className="text-foreground">
                      {formatQty(Number(confirmItem.quantity))} →{" "}
                      {formatQty(confirmRow.draft.quantity)}
                    </strong>
                  </span>
                  <span className="block">
                    Valor un.:{" "}
                    <strong className="text-foreground">
                      {formatCurrency(Number(confirmItem.unit_value))} →{" "}
                      {formatCurrency(confirmRow.draft.unitValue)}
                    </strong>
                  </span>
                  <span className="block">
                    Unidade:{" "}
                    <strong className="text-foreground">
                      {confirmRow.draft.invoiceUnit
                        ? `${systemUnitLabel(confirmRow.draft.invoiceUnit)} (nota) → ${systemUnitLabel(confirmHub)} (Faro)`
                        : systemUnitLabel(confirmHub)}
                    </strong>
                  </span>
                  {confirmRow.draft.mode === "create" &&
                  deferProductCreation ? (
                    <span className="block text-muted-foreground">
                      O produto só será criado no Faro depois da aprovação desta
                      nota.
                    </span>
                  ) : null}
                  {confirmRow.draft.mode === "create" &&
                  !deferProductCreation ? (
                    <span className="block text-muted-foreground">
                      O produto será criado agora no catálogo Faro.
                    </span>
                  ) : null}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!savingId}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={!!savingId}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirm();
              }}
            >
              {savingId ? "Salvando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

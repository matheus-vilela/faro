import { BoletoCategoryPicker } from "@/components/BoletoCategoryPicker";
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
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
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
import { expenseItemVinculoLabel } from "@/lib/expenseItemVinculo";
import { categoryPathLabel } from "@/lib/companyCategoryLabels";
import { resolvePrefillCompanyCategoryId } from "@/lib/dre/rateioBoletoByItems";
import { supabase } from "@/lib/supabase";
import { stripPackSizeFromLabel } from "@/lib/productImport/packSizeFromLabel";
import { parseProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import { loadProductUnitConversions } from "@/lib/productUnitConversionsService";
import {
  initialDraftFromItem,
  isExpenseItemDraftDirty,
  saveExpenseItemLinkEdit,
  type ExpenseItemLinkEditDraft,
} from "@/lib/saveExpenseItemLinkEdit";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { ExpenseItem } from "@/types/expense";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const CREATE_VALUE = "__new__";
const NONE_VALUE = "__none__";
const TH =
  "px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-2.5 align-top";

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function formatQty(v: number): string {
  return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function ReceiptStatusBadge({
  kind,
  receivedQty,
  orderedQty,
}: {
  kind: "received" | "partial" | "not_delivered" | "none";
  receivedQty?: number | null;
  orderedQty?: number;
}) {
  if (kind === "none") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (kind === "not_delivered") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-red-300 bg-red-100/80 text-[10px] font-normal text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
      >
        Não entregue
      </Badge>
    );
  }
  if (kind === "partial") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-amber-400/50 bg-amber-100/80 text-[10px] font-normal text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
      >
        Parcial
        {receivedQty != null && orderedQty != null
          ? ` · ${formatQty(receivedQty)} de ${formatQty(orderedQty)}`
          : ""}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-emerald-600/35 bg-emerald-500/10 text-[10px] font-normal text-emerald-900 dark:text-emerald-100"
    >
      Recebido
    </Badge>
  );
}

function receiptKindForItem(
  itemId: string | undefined,
  notDeliveredIds: Set<string>,
  partialQtyByItemId: Record<string, number | null>,
  receivedItemIds: Set<string>,
): "received" | "partial" | "not_delivered" | "none" {
  if (!itemId) return "none";
  if (notDeliveredIds.has(itemId)) return "not_delivered";
  if (itemId in partialQtyByItemId) return "partial";
  if (receivedItemIds.has(itemId)) return "received";
  return "none";
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
  notDeliveredIds,
  partialQtyByItemId,
  receivedItemIds,
  categoriesById,
}: {
  items: ExpenseItem[];
  notDeliveredIds: Set<string>;
  partialQtyByItemId: Record<string, number | null>;
  receivedItemIds: Set<string>;
  categoriesById: Map<string, CompanyCategory>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className={TH}>Produto</th>
            <th className={TH}>Produto no estoque</th>
            <th className={TH}>Recebimento</th>
            <th className={TH}>NCM</th>
            <th className={TH}>Categoria</th>
            <th className={cn(TH, "text-right")}>Qtd</th>
            <th className={cn(TH, "text-right")}>Valor un.</th>
            <th className={cn(TH, "text-right")}>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const catalogName = it.products?.name?.trim();
            const stagedName =
              it.metadata_json?.pending_new_product?.name?.trim();
            const stripped = invoiceLineLabel(it);
            const stockName = catalogName || stagedName || "—";
            const notDelivered = !!it.id && notDeliveredIds.has(it.id);
            const isPartial = !!it.id && it.id in partialQtyByItemId;
            const partialQty = it.id
              ? (partialQtyByItemId[it.id] ?? null)
              : null;
            const kind = receiptKindForItem(
              it.id,
              notDeliveredIds,
              partialQtyByItemId,
              receivedItemIds,
            );
            return (
              <tr
                key={it.id ?? i}
                className={cn(
                  "border-t",
                  notDelivered && "bg-red-50 dark:bg-red-950/35",
                  !notDelivered &&
                    isPartial &&
                    "bg-amber-50 dark:bg-amber-950/30",
                )}
              >
                <td className="p-2">
                  <span className={cn(notDelivered && "text-muted-foreground")}>
                    {stripped || it.product_name || "—"}
                  </span>
                  {it.metadata_json?.product_merge ? (
                    <Badge
                      variant="outline"
                      className="mt-1.5 text-xs font-normal"
                    >
                      Unificado de{" "}
                      {it.metadata_json.product_merge.from_product_name}
                    </Badge>
                  ) : null}
                </td>
                <td className="p-2">{stockName}</td>
                <td className="p-2">
                  <ReceiptStatusBadge
                    kind={kind}
                    receivedQty={partialQty}
                    orderedQty={Number(it.quantity)}
                  />
                </td>
                <td className="p-2 tabular-nums text-muted-foreground">
                  {it.ncm?.trim() || "—"}
                </td>
                <td className="p-2">
                  {it.company_category_id
                    ? categoryPathLabel(it.company_category_id, categoriesById)
                    : "—"}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatQty(Number(it.quantity))}
                  {it.invoice_unit?.trim() ? ` ${it.invoice_unit.trim()}` : ""}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatCurrency(Number(it.unit_value))}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatCurrency(Number(it.quantity) * Number(it.unit_value))}
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
  notDelivered,
  partialQty,
  received,
  companyCategories,
  categoriesLoading,
  onReloadCategories,
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
  notDelivered: boolean;
  partialQty: number | null | undefined;
  received: boolean;
  companyCategories: CompanyCategory[];
  categoriesLoading: boolean;
  onReloadCategories: () => void | Promise<void>;
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
      companyCategoryId: resolvePrefillCompanyCategoryId({
        itemCategoryId: draft.companyCategoryId,
        productDefaultCategoryId: product?.default_expense_category_id,
        productCmvCategoryId: product?.cmv_category_id,
      }),
    });
  };

  const fieldClass = "h-9";
  const locked = saving || notDelivered;
  const isPartial = !notDelivered && partialQty !== undefined;
  const receiptKind: "received" | "partial" | "not_delivered" | "none" =
    notDelivered
      ? "not_delivered"
      : isPartial
        ? "partial"
        : received
          ? "received"
          : "none";
  const rowTone = cn(
    "border-t",
    notDelivered && "bg-red-50 dark:bg-red-950/35",
    isPartial && "bg-amber-50 dark:bg-amber-950/30",
  );

  return (
    <tr className={rowTone}>
      <td className={cn(TD, "min-w-40")}>
        <p
          className={cn(
            "min-h-9 truncate font-medium leading-snug",
            notDelivered && "text-muted-foreground",
          )}
        >
          {invoiceLineLabel(item)}
        </p>
        {item.metadata_json?.product_merge ? (
          <Badge variant="outline" className="mt-1 text-xs font-normal">
            Unificado de {item.metadata_json.product_merge.from_product_name}
          </Badge>
        ) : null}
      </td>
      <td className={cn(TD, "whitespace-nowrap")}>
        <ReceiptStatusBadge
          kind={receiptKind}
          receivedQty={isPartial ? (partialQty ?? null) : null}
          orderedQty={Number(item.quantity)}
        />
      </td>

      <td className={cn(TD, "min-w-[14rem]")}>
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
          triggerClassName={cn(
            fieldClass,
            missingVinculo && "ring-1 ring-amber-500/60",
          )}
          contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
          disabled={locked}
        />
        {draft.mode === "create" ? (
          <div className="mt-1.5 grid grid-cols-[1fr_7.5rem] gap-1.5">
            <Input
              value={draft.newProductName}
              disabled={locked}
              className={fieldClass}
              placeholder="Nome no Faro"
              onChange={(e) =>
                onDraftChange({ ...draft, newProductName: e.target.value })
              }
            />
            <Select
              value={draft.newProductUnit}
              disabled={locked}
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
      </td>

      <td className={cn(TD, "min-w-[12rem]")}>
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
              disabled={locked}
              placeholder="Unidade da NF"
              triggerClassName={fieldClass}
            />
          </>
        ) : (
          <p className="pt-1.5 text-xs text-muted-foreground">—</p>
        )}
      </td>

      <td className={cn(TD, "w-24 tabular-nums text-xs text-muted-foreground")}>
        <span className="inline-flex min-h-9 items-center">
          {item.ncm?.trim() || "—"}
        </span>
      </td>
      <td className={cn(TD, "min-w-[12rem]")}>
        <BoletoCategoryPicker
          companyId={companyId}
          value={draft.companyCategoryId ?? ""}
          onValueChange={(id) =>
            onDraftChange({ ...draft, companyCategoryId: id || null })
          }
          categories={companyCategories}
          loading={categoriesLoading}
          onReload={onReloadCategories}
          disabled={locked}
          categoryNatureza="DESPESA"
          compact
          allowClear
          placeholder="Categoria"
        />
      </td>

      <td className={cn(TD, "w-24")}>
        <Input
          type="number"
          min={0}
          step="any"
          className={cn(fieldClass, "text-right tabular-nums")}
          value={draft.quantity}
          disabled={locked}
          onChange={(e) =>
            onDraftChange({
              ...draft,
              quantity: parseFloat(e.target.value) || 0,
            })
          }
        />
      </td>
      <td className={cn(TD, "w-28")}>
        <Input
          type="number"
          min={0}
          step="0.01"
          className={cn(fieldClass, "text-right tabular-nums")}
          value={draft.unitValue}
          disabled={locked}
          onChange={(e) =>
            onDraftChange({
              ...draft,
              unitValue: parseFloat(e.target.value) || 0,
            })
          }
        />
      </td>
      <td
        className={cn(TD, "w-28 text-right text-sm font-medium tabular-nums")}
      >
        <span className="inline-flex min-h-9 items-center">
          {formatCurrency(draft.quantity * draft.unitValue)}
        </span>
      </td>
      <td className={cn(TD, "w-24")}>
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0"
          disabled={notDelivered || !dirty || !canSubmit || saving}
          onClick={onRequestSave}
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </td>
    </tr>
  );
}

export function ExpenseItemsInlineTable({
  items,
  canEdit,
  companyId,
  products,
  deferProductCreation,
  highlightMissingVinculo,
  notDeliveredItemIds = [],
  partialQtyByItemId = {},
  receivedItemIds = [],
  onSaved,
}: {
  items: ExpenseItem[];
  canEdit: boolean;
  companyId: string;
  products: Product[];
  deferProductCreation: boolean;
  highlightMissingVinculo: boolean;
  notDeliveredItemIds?: string[];
  partialQtyByItemId?: Record<string, number | null>;
  receivedItemIds?: string[];
  onSaved: (created?: Product) => void;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [classifReady, setClassifReady] = useState(false);
  const itemIdsKey = items.map((it) => it.id).join(",");
  const hydratedIdsRef = useRef<Set<string>>(new Set());

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const productSelectOptions = useMemo(
    () =>
      products.filter((p) => p.is_active !== false).map(productSearchOption),
    [products],
  );
  const notDeliveredIds = useMemo(
    () => new Set(notDeliveredItemIds),
    [notDeliveredItemIds],
  );
  const receivedIds = useMemo(
    () => new Set(receivedItemIds),
    [receivedItemIds],
  );

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const loadCompanyCategories = useCallback(async () => {
    const { data } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", companyId)
      .order("ordem", { ascending: true })
      .order("name", { ascending: true });
    setCompanyCategories((data as CompanyCategory[]) ?? []);
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    setClassifReady(false);
    setCategoriesLoading(true);
    void (async () => {
      await loadCompanyCategories();
      if (!cancelled) {
        setCategoriesLoading(false);
        setClassifReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, loadCompanyCategories]);

  useEffect(() => {
    hydratedIdsRef.current = new Set();
    setRows({});
    setConfirmId(null);
  }, [itemIdsKey, companyId]);

  useEffect(() => {
    if (!canEdit || !classifReady) return;
    const toHydrate = items.filter(
      (it): it is ExpenseItem & { id: string } =>
        !!it.id && !hydratedIdsRef.current.has(it.id),
    );
    if (toHydrate.length === 0) return;

    for (const it of toHydrate) {
      hydratedIdsRef.current.add(it.id);
      const product = it.product_id ? productById.get(it.product_id) : undefined;
      const initial = initialDraftFromItem(it, companyId, {
        productDefaultCategoryId: product?.default_expense_category_id,
        productCmvCategoryId: product?.cmv_category_id,
      });
      setRows((prev) => ({
        ...prev,
        [it.id]: { draft: initial, pristine: initial },
      }));
    }
  }, [
    canEdit,
    classifReady,
    companyId,
    items,
    productById,
  ]);

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
        if (conversionRows.length === 0 && cur.draft.conversions.length > 0) {
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
          <table className="w-full min-w-[80rem] text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className={TH}>Produto</th>
                <th className={TH}>Recebimento</th>
                <th className={TH}>Produto no estoque</th>
                <th className={TH}>Unidade da NF × estoque</th>
                <th className={TH}>NCM</th>
                <th className={TH}>Categoria</th>
                <th className={cn(TH, "text-center")}>Qtd</th>
                <th className={cn(TH, "text-center")}>Valor un.</th>
                <th className={cn(TH, "text-right")}>Subtotal</th>
                <th className={cn(TH, "text-center")}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                if (!it.id) return null;
                const row = rows[it.id];
                if (!row) {
                  return (
                    <tr key={it.id ?? i} className="border-t">
                      <td
                        colSpan={10}
                        className="px-3 py-3 text-muted-foreground"
                      >
                        Carregando…
                      </td>
                    </tr>
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
                    notDelivered={notDeliveredIds.has(it.id)}
                    received={receivedIds.has(it.id)}
                    partialQty={
                      it.id in partialQtyByItemId
                        ? (partialQtyByItemId[it.id] ?? null)
                        : undefined
                    }
                    onDraftChange={(next) => handleDraftChange(it.id!, next)}
                    onConversionsLoaded={handleConversionsLoaded}
                    onRequestSave={() => {
                      if (notDeliveredIds.has(it.id!)) return;
                      setConfirmId(it.id!);
                    }}
                    companyCategories={companyCategories}
                    categoriesLoading={categoriesLoading}
                    onReloadCategories={() => void loadCompanyCategories()}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ExpenseItemReadOnlyTable
          items={items}
          notDeliveredIds={notDeliveredIds}
          partialQtyByItemId={partialQtyByItemId}
          receivedItemIds={receivedIds}
          categoriesById={categoriesById}
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

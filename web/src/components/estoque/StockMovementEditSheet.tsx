import { StockMovementDetailSummary } from "@/components/estoque/StockMovementDetailSummary";
import { StockMovementTypeBadge } from "@/components/estoque/StockMovementTypeBadge";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { ProductMergeMovementUndoButton } from "@/components/products/ProductMergeAuditSection";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
import { ProductUnitPickerWithConversion } from "@/components/products/ProductUnitPickerWithConversion";
import { RevenueDetailSheet } from "@/components/revenue/RevenueDetailSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  productSearchOption,
  SearchSelect,
} from "@/components/ui/search-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ENTRY_CLASSIFICATION_OPTIONS,
  EXIT_CLASSIFICATION_OPTIONS,
  MANUAL_MOVEMENT_KIND_OPTIONS,
  isManuallyRegisteredStockMovement,
  manualStockMovementRegisteredByLabel,
  type EntryClassification,
  type ExitClassification,
  type ManualMovementKind,
} from "@/lib/manualStockMovement";
import {
  allowedUnitsForProduct,
  formatCurrencyInput,
} from "@/lib/manualStockMovementUnits";
import { flattenProductUnitConversionsDrafts } from "@/lib/productUnitConversionsJson";
import { persistProductUnitConversions } from "@/lib/productUnitConversionsService";
import {
  fetchStockMovementDetailContext,
  type StockMovementDetailContext,
} from "@/lib/stockMovementDetailContext";
import { isExpenseStockMovementReference } from "@/lib/stockMovementExpenseLink";
import {
  movementDateInputFromIso,
  stockMovementEditMode,
  stockMovementIsEditable,
  stockMovementOriginLabel,
  type StockMovementEditRow,
} from "@/lib/stockMovementEdit";
import { formatStockMovementListDate } from "@/lib/stockMovementSaleDate";
import { stockMovementTypeDisplay } from "@/lib/stockMovementMergeDisplay";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { updateStockMovement } from "@/lib/updateStockMovement";
import {
  stockMovementMergeUndoProps,
} from "@/types/productMergeAudit";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { ArrowRightLeft, CircleDollarSign, FileText, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  companyId: string;
  movement: StockMovementEditRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  formatCurrency?: (v: number) => string;
  elevated?: boolean;
};

function defaultFormatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function unitPriceRawFromStock(
  unitCost: number | null,
  inputQty: number | null,
  stockQty: number,
): string {
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost < 0) return "";
  if (
    inputQty != null &&
    Number.isFinite(inputQty) &&
    Math.abs(inputQty) > 0 &&
    stockQty > 0 &&
    Math.abs(inputQty) !== stockQty
  ) {
    const pricePerInput = (unitCost * stockQty) / Math.abs(inputQty);
    return formatCurrencyInput(
      String(Math.round(pricePerInput * 100)),
    );
  }
  return formatCurrencyInput(String(Math.round(unitCost * 100)));
}

export function StockMovementEditSheet({
  companyId,
  movement,
  open,
  onOpenChange,
  onSaved,
  formatCurrency = defaultFormatCurrency,
  elevated = false,
}: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);

  const [productId, setProductId] = useState("");
  const [movementKind, setMovementKind] =
    useState<ManualMovementKind>("entry");
  const [entryClassification, setEntryClassification] =
    useState<EntryClassification>("purchase");
  const [exitClassification, setExitClassification] =
    useState<ExitClassification>("sale");
  const [unitCode, setUnitCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [movementDate, setMovementDate] = useState("");

  const [mergeOpen, setMergeOpen] = useState(false);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);
  const [revenueDetailId, setRevenueDetailId] = useState<string | null>(null);
  const [detailContext, setDetailContext] =
    useState<StockMovementDetailContext | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const mode = movement ? stockMovementEditMode(movement) : "readonly";
  const editable = movement ? stockMovementIsEditable(movement) : false;

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const selectedProduct = productId ? productById.get(productId) : undefined;
  const conversionsForSelected = useMemo(
    () => productConversions.filter((r) => r.product_id === productId),
    [productConversions, productId],
  );

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .or("is_active.is.null,is_active.eq.true")
      .order("name");
    setLoadingProducts(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível carregar os produtos.");
      return;
    }
    let list = (data ?? []) as Product[];
    const currentId = movement?.product_id;
    if (currentId && !list.some((p) => p.id === currentId)) {
      const { data: current } = await supabase
        .from("products")
        .select("*")
        .eq("id", currentId)
        .maybeSingle();
      if (current) list = [current as Product, ...list];
    }
    setProducts(list);
    setProductConversions(
      flattenProductUnitConversionsDrafts(companyId, list),
    );
  }, [companyId, movement?.product_id]);

  const hydrateFromMovement = useCallback(
    (row: StockMovementEditRow, productList: Product[]) => {
      setProductId(row.product_id);
      const meta = row.metadata_json;
      const kind = (meta?.movement_kind as ManualMovementKind | undefined) ??
        (row.type === "in"
          ? "entry"
          : row.reference_type === "inventory_count"
            ? "inventory"
            : "exit");
      setMovementKind(kind);
      const cls = meta?.classification ?? "";
      if (kind === "entry") {
        setEntryClassification(
          (cls as EntryClassification) || "purchase",
        );
      } else if (kind === "exit") {
        setExitClassification((cls as ExitClassification) || "sale");
      }
      const inputUnit =
        meta?.input_unit_code?.trim() ||
        meta?.quantity_unit?.trim() ||
        row.products?.unit?.trim() ||
        productList.find((p) => p.id === row.product_id)?.unit ||
        "";
      setUnitCode(inputUnit);
      const inputQty = meta?.input_quantity;
      if (inputQty != null && Number.isFinite(Number(inputQty))) {
        setQuantity(String(inputQty));
      } else {
        const signed =
          kind === "inventory" && row.type !== "in"
            ? -Math.abs(Number(row.quantity))
            : Math.abs(Number(row.quantity));
        setQuantity(String(signed));
      }
      setUnitPrice(
        unitPriceRawFromStock(
          row.unit_cost,
          inputQty != null ? Number(inputQty) : null,
          Math.abs(Number(row.quantity)),
        ),
      );
      setMovementDate(movementDateInputFromIso(row.created_at));
    },
    [],
  );

  useEffect(() => {
    if (!open || !movement) return;
    queueMicrotask(() => {
      void loadProducts();
    });
  }, [open, movement?.id, loadProducts]);

  useEffect(() => {
    if (!open || !movement) {
      setDetailContext(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetchStockMovementDetailContext({
      companyId,
      productId: movement.product_id,
      type: movement.type,
      referenceType: movement.reference_type,
      referenceId: movement.reference_id,
      createdAt: movement.created_at,
      unitCost: movement.unit_cost,
    }).then((ctx) => {
      if (cancelled) return;
      setDetailLoading(false);
      setDetailContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    companyId,
    movement?.id,
    movement?.product_id,
    movement?.type,
    movement?.reference_type,
    movement?.reference_id,
    movement?.created_at,
    movement?.unit_cost,
  ]);

  useEffect(() => {
    if (!open || !movement) return;
    hydrateFromMovement(movement, products);
    // Só reidrata ao abrir outra movimentação — não ao recarregar a lista de produtos.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- products only as initial lookup
  }, [open, movement?.id, hydrateFromMovement]);

  useEffect(() => {
    if (!productId || !selectedProduct) return;
    const allowed = allowedUnitsForProduct(
      selectedProduct,
      conversionsForSelected,
    );
    if (
      unitCode &&
      !allowed.some(
        (u) => u.trim().toLowerCase() === unitCode.trim().toLowerCase(),
      )
    ) {
      setUnitCode(selectedProduct.unit);
    }
  }, [productId, selectedProduct, conversionsForSelected, unitCode]);

  const classification =
    movementKind === "entry"
      ? entryClassification
      : movementKind === "exit"
        ? exitClassification
        : null;

  const mergeUndo = movement ? stockMovementMergeUndoProps(movement) : null;
  const typeDisplay = movement ? stockMovementTypeDisplay(movement) : null;
  const registeredBy = movement
    ? manualStockMovementRegisteredByLabel(movement.metadata_json)
    : null;
  const isManualMeta = movement
    ? isManuallyRegisteredStockMovement(movement.metadata_json)
    : false;

  const linkedExpenseId =
    movement?.expense_id ?? detailContext?.invoice?.expenseId ?? null;
  const hasExpense =
    linkedExpenseId != null &&
    (isExpenseStockMovementReference(movement?.reference_type ?? null) ||
      detailContext?.invoice?.expenseId != null);
  const showExpenseFallback =
    hasExpense &&
    linkedExpenseId != null &&
    !detailContext?.invoice?.expenseId;

  const revenueEntryId =
    movement?.reference_type === "revenue_entry" ||
    movement?.reference_type === "revenue_entry_update"
      ? movement.reference_id
      : null;
  const showRevenueFallback =
    Boolean(revenueEntryId) && !detailContext?.revenue;

  const mergeSourceProduct =
    (movement ? productById.get(movement.product_id) : undefined) ??
    selectedProduct;

  const mergePartnerId =
    productId &&
    movement &&
    productId !== movement.product_id
      ? productId
      : null;

  const handleConversionsChange = async (
    next: ProductUnitConversionDraft[],
  ) => {
    if (!selectedProduct) return;
    const forOthers = productConversions.filter(
      (r) => r.product_id !== selectedProduct.id,
    );
    const forThis = next.map((r) => ({
      ...r,
      product_id: selectedProduct.id,
      company_id: companyId,
    }));
    setProductConversions([...forOthers, ...forThis]);
    const result = await persistProductUnitConversions(
      companyId,
      selectedProduct.id,
      forThis,
    );
    if (!result.ok) {
      toast.error(result.error ?? "Não foi possível salvar a conversão.");
      return;
    }
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("id", selectedProduct.id)
      .maybeSingle();
    if (data) {
      setProducts((prev) =>
        prev.map((p) => (p.id === data.id ? (data as Product) : p)),
      );
    }
  };

  const handleSave = async () => {
    if (!movement || !selectedProduct) {
      toast.error("Selecione o produto.");
      return;
    }
    setSaving(true);
    const result = await updateStockMovement({
      movement,
      product: selectedProduct,
      conversions: conversionsForSelected,
      movementKind: mode === "manual" ? movementKind : undefined,
      classification: mode === "manual" ? classification : null,
      unitCode,
      quantityRaw: quantity,
      unitPriceRaw: unitPrice,
      movementDate: mode === "manual" ? movementDate : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Movimentação atualizada.");
    onOpenChange(false);
    onSaved?.();
  };

  const zSheet = elevated ? "z-[60]" : undefined;
  const overlayClass = elevated ? "z-[60]" : undefined;

  return (
    <>
      <ExpenseDetailSheet
        expenseId={expenseDetailId}
        onClose={() => setExpenseDetailId(null)}
        onRefresh={() => onSaved?.()}
        elevated
      />
      <RevenueDetailSheet
        revenueEntryId={revenueDetailId}
        onClose={() => setRevenueDetailId(null)}
        onRefresh={() => onSaved?.()}
      />
      {mergeSourceProduct ? (
        <ProductMergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          companyId={companyId}
          sourceProduct={mergeSourceProduct}
          formatCurrency={formatCurrency}
          initialPartnerId={mergePartnerId}
          onMerged={() => {
            setMergeOpen(false);
            onOpenChange(false);
            onSaved?.();
          }}
        />
      ) : null}

      <Sheet open={open && movement != null} onOpenChange={onOpenChange}>
        <SheetContent
          className={cn("flex w-full flex-col gap-0 overflow-hidden p-0", zSheet)}
          overlayClassName={overlayClass}
        >
          {movement ? (
            <>
              <SheetHeader className="border-b border-border px-6 py-5 text-left">
                <div className="flex flex-wrap items-center gap-2 pr-10">
                  <StockMovementTypeBadge row={movement} />
                  <Badge variant="outline" className="font-normal">
                    {stockMovementOriginLabel(movement)}
                  </Badge>
                </div>
                <SheetTitle className="text-xl">
                  {typeDisplay?.label ?? "Movimentação de estoque"}
                </SheetTitle>
                <SheetDescription>
                  {formatStockMovementListDate(movement, { withYear: true })}
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <StockMovementDetailSummary
                  movement={movement}
                  context={detailContext}
                  loading={detailLoading}
                  formatCurrency={formatCurrency}
                  onOpenExpense={setExpenseDetailId}
                  onOpenRevenue={setRevenueDetailId}
                  productDisplayName={
                    movement.products?.name ??
                    detailContext?.product?.name ??
                    selectedProduct?.name ??
                    "—"
                  }
                />

                {editable ? (
                  <section className="space-y-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Alterar
                    </p>
                    <div className="space-y-2">
                      <Label>Produto (vínculo)</Label>
                      <SearchSelect
                        value={productId || "__none__"}
                        onValueChange={(v) =>
                          setProductId(v === "__none__" ? "" : v)
                        }
                        disabled={loadingProducts || saving}
                        options={products.map(productSearchOption)}
                        leadingOptions={[
                          { value: "__none__", label: "Selecionar" },
                        ]}
                        placeholder="Selecionar produto"
                        searchPlaceholder="Buscar produto…"
                        emptyMessage="Nenhum produto encontrado."
                      />
                      <p className="text-xs text-muted-foreground">
                        Se for o mesmo item com outro cadastro, unifique em vez
                        de só trocar nesta linha.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={!mergeSourceProduct || saving}
                        onClick={() => setMergeOpen(true)}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        Unificar com outro produto…
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Unidade</Label>
                        {selectedProduct ? (
                          <ProductUnitPickerWithConversion
                            companyId={companyId}
                            stockUnitCode={selectedProduct.unit}
                            hubUnitCode={selectedProduct.unit}
                            unitCodes={allowedUnitsForProduct(
                              selectedProduct,
                              conversionsForSelected,
                            )}
                            value={unitCode}
                            onValueChange={setUnitCode}
                            conversions={conversionsForSelected}
                            onConversionsChange={handleConversionsChange}
                            disabled={saving}
                          />
                        ) : (
                          <Input disabled placeholder="Selecione o produto" />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>
                          Quantidade
                          {mode === "manual" && movementKind === "inventory" ? (
                            <span className="ml-1 font-normal text-muted-foreground">
                              (+ / −)
                            </span>
                          ) : null}
                        </Label>
                        <Input
                          type="number"
                          step="0.0001"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    </div>

                    {mode === "manual" ? (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Entrada / saída</Label>
                            <SearchSelect
                              value={movementKind}
                              onValueChange={(v) =>
                                setMovementKind(v as ManualMovementKind)
                              }
                              options={MANUAL_MOVEMENT_KIND_OPTIONS}
                              disabled={saving}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Classificação</Label>
                            <SearchSelect
                              value={
                                movementKind === "entry"
                                  ? entryClassification
                                  : movementKind === "exit"
                                    ? exitClassification
                                    : "__blocked__"
                              }
                              onValueChange={(v) => {
                                if (movementKind === "entry") {
                                  setEntryClassification(
                                    v as EntryClassification,
                                  );
                                } else if (movementKind === "exit") {
                                  setExitClassification(
                                    v as ExitClassification,
                                  );
                                }
                              }}
                              options={
                                movementKind === "inventory"
                                  ? [
                                      {
                                        value: "__blocked__",
                                        label: "Não se aplica",
                                      },
                                    ]
                                  : movementKind === "entry"
                                    ? ENTRY_CLASSIFICATION_OPTIONS
                                    : EXIT_CLASSIFICATION_OPTIONS
                              }
                              placeholder={
                                movementKind === "inventory"
                                  ? "Não se aplica"
                                  : "Selecionar"
                              }
                              disabled={
                                movementKind === "inventory" || saving
                              }
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Preço por unidade</Label>
                          <Input
                            value={unitPrice}
                            onChange={(e) =>
                              setUnitPrice(formatCurrencyInput(e.target.value))
                            }
                            placeholder="R$ 0,00"
                            disabled={saving || !unitCode.trim()}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="edit-movement-date">
                            Data da movimentação
                          </Label>
                          <Input
                            id="edit-movement-date"
                            type="date"
                            value={movementDate}
                            onChange={(e) => setMovementDate(e.target.value)}
                            disabled={saving}
                          />
                        </div>
                      </>
                    ) : null}

                    {mode === "expense" ? (
                      <div className="space-y-2">
                        <Label>Custo unitário (estoque)</Label>
                        <Input
                          value={unitPrice}
                          onChange={(e) =>
                            setUnitPrice(formatCurrencyInput(e.target.value))
                          }
                          placeholder="R$ 0,00"
                          disabled={saving}
                        />
                        <p className="text-xs text-muted-foreground">
                          Impostos e demais dados da nota continuam na despesa.
                        </p>
                      </div>
                    ) : null}
                  </section>
                ) : mode === "revenue" ? (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Movimentações de venda não são editadas aqui. Abra a venda
                    para alterar produto ou quantidade.
                  </p>
                ) : mode === "readonly" ? (
                  <p className="text-sm text-muted-foreground">
                    Esta origem não permite edição direta nesta tela.
                  </p>
                ) : null}

                {isManualMeta && registeredBy ? (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Registrado por
                    </p>
                    <p className="mt-1 text-sm font-medium">{registeredBy}</p>
                  </div>
                ) : null}

                {showExpenseFallback && linkedExpenseId ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2 sm:w-auto"
                    onClick={() => setExpenseDetailId(linkedExpenseId)}
                  >
                    <FileText className="h-4 w-4" />
                    Visualizar nota
                  </Button>
                ) : null}

                {showRevenueFallback && revenueEntryId ? (
                  <Button
                    type="button"
                    className="w-full gap-2 sm:w-auto"
                    onClick={() => setRevenueDetailId(revenueEntryId)}
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    Abrir venda
                  </Button>
                ) : null}

                {mergeUndo?.eventId ? (
                  <div className="flex justify-end">
                    <ProductMergeMovementUndoButton
                      companyId={companyId}
                      eventId={mergeUndo.eventId}
                      loserName={mergeUndo.loserName}
                      undoneAt={mergeUndo.undoneAt}
                      onUndone={() => {
                        onOpenChange(false);
                        onSaved?.();
                      }}
                    />
                  </div>
                ) : null}
              </div>

              {editable ? (
                <SheetFooter className="shrink-0 gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => onOpenChange(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    className="gap-2"
                    disabled={saving || !productId}
                    onClick={() => void handleSave()}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Salvar alterações
                  </Button>
                </SheetFooter>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

import { ProductMergeMovementPair } from "@/components/estoque/ProductMergeMovementPair";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { maskCpfCnpj } from "@/lib/masks";
import {
  isExpenseStockMovementReference,
} from "@/lib/stockMovementExpenseLink";
import {
  fetchStockMovementInvoiceContext,
  formatInvoiceLabel,
  type StockMovementInvoiceContext,
} from "@/lib/stockMovementInvoiceContext";
import {
  movementDateInputFromIso,
  stockMovementEditMode,
  stockMovementIsEditable,
  stockMovementOriginLabel,
  type StockMovementEditRow,
} from "@/lib/stockMovementEdit";
import { movementClassificationDisplayLabel } from "@/lib/stockMovementClassification";
import { stockMovementMergePairDisplay } from "@/lib/stockMovementMergeDisplay";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { updateStockMovement } from "@/lib/updateStockMovement";
import {
  stockMovementMergeUndoProps,
} from "@/types/productMergeAudit";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { ArrowRightLeft, FileText, Loader2, Save } from "lucide-react";
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [invoiceContext, setInvoiceContext] =
    useState<StockMovementInvoiceContext | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

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
      setInvoiceContext(null);
      return;
    }
    let cancelled = false;
    setInvoiceLoading(true);
    void fetchStockMovementInvoiceContext({
      companyId,
      productId: movement.product_id,
      referenceType: movement.reference_type,
      referenceId: movement.reference_id,
      createdAt: movement.created_at,
      unitCost: movement.unit_cost,
    }).then((ctx) => {
      if (cancelled) return;
      setInvoiceLoading(false);
      setInvoiceContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    companyId,
    movement?.id,
    movement?.product_id,
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

  const mergePair = movement
    ? stockMovementMergePairDisplay(
        movement,
        movement.products?.name ?? selectedProduct?.name ?? "—",
      )
    : null;
  const mergeUndo = movement ? stockMovementMergeUndoProps(movement) : null;
  const registeredBy = movement
    ? manualStockMovementRegisteredByLabel(movement.metadata_json)
    : null;
  const isManualMeta = movement
    ? isManuallyRegisteredStockMovement(movement.metadata_json)
    : false;

  const linkedExpenseId =
    movement?.expense_id ?? invoiceContext?.expenseId ?? null;
  const hasExpense =
    linkedExpenseId != null &&
    (isExpenseStockMovementReference(movement?.reference_type ?? null) ||
      invoiceContext?.expenseId != null);

  const revenueEntryId =
    movement?.reference_type === "revenue_entry" ||
    movement?.reference_type === "revenue_entry_update"
      ? movement.reference_id
      : null;

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
          className={cn(
            "flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md",
            zSheet,
          )}
          overlayClassName={overlayClass}
        >
          {movement ? (
            <>
              <SheetHeader className="border-b border-border px-6 py-5 text-left">
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <SheetTitle>Movimentação de estoque</SheetTitle>
                  <Badge variant="outline" className="font-normal">
                    {stockMovementOriginLabel(movement)}
                  </Badge>
                </div>
                <SheetDescription>
                  {formatDateTime(movement.created_at)}
                </SheetDescription>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div>
                  <p className="text-xs text-muted-foreground">Tipo</p>
                  <div className="mt-1">
                    <StockMovementTypeBadge row={movement} />
                  </div>
                </div>

                {invoiceLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando dados da nota…
                  </p>
                ) : invoiceContext ? (
                  <div className="rounded-xl border border-border bg-muted/30 p-3">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Nota fiscal
                    </p>
                    <dl className="mt-2 grid gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Documento
                        </dt>
                        <dd className="mt-0.5 font-medium">
                          {formatInvoiceLabel(
                            invoiceContext.invoiceNumber,
                            invoiceContext.invoiceSeries,
                          ) ?? "Cadastro pela NF-e"}
                        </dd>
                      </div>
                      {invoiceContext.supplierName ? (
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Fornecedor
                          </dt>
                          <dd className="mt-0.5 font-medium">
                            {invoiceContext.supplierName}
                            {invoiceContext.supplierDocument ? (
                              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                {maskCpfCnpj(invoiceContext.supplierDocument)}
                              </span>
                            ) : null}
                          </dd>
                        </div>
                      ) : null}
                      {invoiceContext.originalItemName ? (
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Item original na nota
                          </dt>
                          <dd className="mt-0.5 font-medium leading-snug">
                            {invoiceContext.originalItemName}
                          </dd>
                        </div>
                      ) : null}
                      {invoiceContext.invoiceQuantity != null ? (
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Quantidade na nota
                          </dt>
                          <dd className="mt-0.5 font-medium tabular-nums">
                            {invoiceContext.invoiceQuantity.toLocaleString(
                              "pt-BR",
                            )}
                            {invoiceContext.invoiceUnit
                              ? ` ${invoiceContext.invoiceUnit}`
                              : ""}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : null}

                {mergePair ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Produtos</p>
                    <div className="mt-1">
                      <ProductMergeMovementPair {...mergePair} />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {movementClassificationDisplayLabel(movement)}
                    </p>
                  </div>
                ) : null}

                {editable ? (
                  <>
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
                            <Select
                              value={movementKind}
                              onValueChange={(v) =>
                                setMovementKind(v as ManualMovementKind)
                              }
                              disabled={saving}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MANUAL_MOVEMENT_KIND_OPTIONS.map((opt) => (
                                  <SelectItem
                                    key={opt.value}
                                    value={opt.value}
                                  >
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Classificação</Label>
                            <Select
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
                              disabled={
                                movementKind === "inventory" || saving
                              }
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={
                                    movementKind === "inventory"
                                      ? "Não se aplica"
                                      : "Selecionar"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {movementKind === "inventory" ? (
                                  <SelectItem value="__blocked__" disabled>
                                    Não se aplica
                                  </SelectItem>
                                ) : movementKind === "entry" ? (
                                  ENTRY_CLASSIFICATION_OPTIONS.map((opt) => (
                                    <SelectItem
                                      key={opt.value}
                                      value={opt.value}
                                    >
                                      {opt.label}
                                    </SelectItem>
                                  ))
                                ) : (
                                  EXIT_CLASSIFICATION_OPTIONS.map((opt) => (
                                    <SelectItem
                                      key={opt.value}
                                      value={opt.value}
                                    >
                                      {opt.label}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
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
                  </>
                ) : (
                  <dl className="grid gap-3 text-sm">
                    {!mergePair ? (
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Produto
                        </dt>
                        <dd className="mt-1 font-medium">
                          {movement.products?.name ??
                            selectedProduct?.name ??
                            "—"}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Quantidade
                      </dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {Number(movement.quantity).toLocaleString("pt-BR")}{" "}
                        {movement.metadata_json?.quantity_unit?.trim() ||
                          movement.products?.unit ||
                          "un"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Classificação
                      </dt>
                      <dd className="mt-1 text-muted-foreground">
                        {movementClassificationDisplayLabel(movement)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Custo unitário
                      </dt>
                      <dd className="mt-1 tabular-nums">
                        {movement.unit_cost != null
                          ? formatCurrency(Number(movement.unit_cost))
                          : "—"}
                      </dd>
                    </div>
                    {mode === "revenue" ? (
                      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        Movimentações de venda não são editadas aqui. Abra a
                        venda para alterar produto ou quantidade.
                      </p>
                    ) : null}
                    {mode === "readonly" ? (
                      <p className="text-sm text-muted-foreground">
                        Esta origem não permite edição direta nesta tela.
                      </p>
                    ) : null}
                  </dl>
                )}

                {isManualMeta && registeredBy ? (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Registrado por
                    </p>
                    <p className="mt-1 text-sm font-medium">{registeredBy}</p>
                  </div>
                ) : null}

                {hasExpense && linkedExpenseId ? (
                  <Button
                    type="button"
                    variant={editable ? "outline" : "default"}
                    className="w-full gap-2"
                    onClick={() => setExpenseDetailId(linkedExpenseId)}
                  >
                    <FileText className="h-4 w-4" />
                    Visualizar despesa / nota
                  </Button>
                ) : null}

                {mode === "revenue" && revenueEntryId ? (
                  <Button
                    type="button"
                    className="w-full gap-2"
                    onClick={() => setRevenueDetailId(revenueEntryId)}
                  >
                    <FileText className="h-4 w-4" />
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

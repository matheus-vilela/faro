import {
  BatchManualStockMovementPanel,
  type BatchManualStockMovementHandle,
} from "@/components/estoque/BatchManualStockMovementPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ENTRY_CLASSIFICATION_OPTIONS,
  EXIT_CLASSIFICATION_OPTIONS,
  MANUAL_MOVEMENT_KIND_OPTIONS,
  todayDateInputValue,
  type EntryClassification,
  type ExitClassification,
  type ManualMovementKind,
  type ManualRegistrationMode,
} from "@/lib/manualStockMovement";
import {
  allowedUnitsForProduct,
  formatCurrencyInput,
} from "@/lib/manualStockMovementUnits";
import { submitManualStockMovement } from "@/lib/manualStockMovementSubmit";
import { flattenProductUnitConversionsDrafts } from "@/lib/productUnitConversionsJson";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Loader2, PackagePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Props = {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

const REGISTRATION_MODES: {
  value: ManualRegistrationMode;
  label: string;
  disabled?: boolean;
}[] = [
  { value: "single", label: "Única" },
  { value: "batch", label: "Em lote" },
  { value: "technical_sheet", label: "Por ficha técnica", disabled: true },
];

export function RegisterManualStockMovementSheet({
  companyId,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const batchRef = useRef<BatchManualStockMovementHandle>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);

  const [registrationMode, setRegistrationMode] =
    useState<ManualRegistrationMode>("single");
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
  const [movementDate, setMovementDate] = useState(todayDateInputValue());
  const [expiryDate, setExpiryDate] = useState("");

  const productById = useCallback(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const conversionsForProduct = useCallback(
    (pid: string) =>
      productConversions.filter((r) => r.product_id === pid),
    [productConversions],
  );

  const resetForm = useCallback(() => {
    setRegistrationMode("single");
    setProductId("");
    setMovementKind("entry");
    setEntryClassification("purchase");
    setExitClassification("sale");
    setUnitCode("");
    setQuantity("");
    setUnitPrice("");
    setMovementDate(todayDateInputValue());
    setExpiryDate("");
  }, []);

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
    const list = (data ?? []) as Product[];
    setProducts(list);
    setProductConversions(
      flattenProductUnitConversionsDrafts(companyId, list),
    );
  }, [companyId]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void loadProducts());
  }, [open, loadProducts]);

  useEffect(() => {
    if (!productId) {
      setUnitCode("");
      return;
    }
    const product = productById().get(productId);
    if (!product) {
      setUnitCode("");
      return;
    }
    const allowed = allowedUnitsForProduct(
      product,
      conversionsForProduct(productId),
    );
    if (
      !allowed.some(
        (u) => u.trim().toLowerCase() === unitCode.trim().toLowerCase(),
      )
    ) {
      setUnitCode(product.unit);
    }
    setExpiryDate("");
  }, [conversionsForProduct, productById, productId, unitCode]);

  const classification =
    movementKind === "entry"
      ? entryClassification
      : movementKind === "exit"
        ? exitClassification
        : null;

  const handleSingleSubmit = async () => {
    const product = productById().get(productId);
    if (!product) {
      toast.error("Selecione o produto.");
      return;
    }
    setSaving(true);
    const result = await submitManualStockMovement({
      product,
      conversions: conversionsForProduct(productId),
      movementKind,
      classification,
      unitCode,
      quantityRaw: quantity,
      unitPriceRaw: unitPrice,
      movementDate,
      expiryDate,
      registrationMode: "single",
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Movimentação registrada.");
    resetForm();
    onOpenChange(false);
    onSaved?.();
  };

  const handleFooterSubmit = async () => {
    if (registrationMode === "batch") {
      const ok = await batchRef.current?.submit();
      if (ok) {
        resetForm();
        onOpenChange(false);
        onSaved?.();
      }
      return;
    }
    await handleSingleSubmit();
  };

  const isBatch = registrationMode === "batch";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) resetForm();
        onOpenChange(next);
      }}
    >
      <SheetContent
        className={cn(
          "flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl",
          isBatch ? "sm:max-w-6xl lg:max-w-7xl" : "sm:max-w-lg lg:max-w-xl",
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
              <PackagePlus className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 pr-6">
              <SheetTitle className="text-xl font-semibold sm:text-2xl">
                Registrar movimentação
              </SheetTitle>
              <p className="text-sm text-muted-foreground">
                Lançamento manual de estoque
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted">
          <div className={cn("shrink-0 p-4 pb-0", isBatch && "border-b border-border bg-card/30")}>
            <div className="space-y-2">
              <Label>Tipo de movimentação</Label>
              <div className="flex flex-wrap gap-2">
                {REGISTRATION_MODES.map((mode) => (
                  <Button
                    key={mode.value}
                    type="button"
                    size="sm"
                    variant={
                      registrationMode === mode.value ? "default" : "outline"
                    }
                    disabled={mode.disabled}
                    onClick={() => setRegistrationMode(mode.value)}
                  >
                    {mode.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {isBatch ? (
            <BatchManualStockMovementPanel
              ref={batchRef}
              companyId={companyId}
              products={products}
              productConversions={productConversions}
              loadingProducts={loadingProducts}
              onSavingChange={setSaving}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 p-6">
                <div className="space-y-2">
                  <Label>Produto</Label>
                  <SearchSelect
                    value={productId || "__none__"}
                    onValueChange={(v) =>
                      setProductId(v === "__none__" ? "" : v)
                    }
                    disabled={loadingProducts}
                    options={products.map(productSearchOption)}
                    leadingOptions={[
                      { value: "__none__", label: "Selecionar" },
                    ]}
                    placeholder="Selecionar produto"
                    searchPlaceholder="Buscar produto…"
                    emptyMessage="Nenhum produto encontrado."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Entrada / saída</Label>
                    <Select
                      value={movementKind}
                      onValueChange={(v) =>
                        setMovementKind(v as ManualMovementKind)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MANUAL_MOVEMENT_KIND_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
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
                          setEntryClassification(v as EntryClassification);
                        } else if (movementKind === "exit") {
                          setExitClassification(v as ExitClassification);
                        }
                      }}
                      disabled={movementKind === "inventory"}
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
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))
                        ) : (
                          EXIT_CLASSIFICATION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Unidade de medida</Label>
                    <Select
                      value={unitCode || "__none__"}
                      onValueChange={(v) =>
                        setUnitCode(v === "__none__" ? "" : v)
                      }
                      disabled={!productId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Selecionar</SelectItem>
                        {(productById().get(productId)
                          ? allowedUnitsForProduct(
                              productById().get(productId),
                              conversionsForProduct(productId),
                            )
                          : []
                        ).map((u) => (
                          <SelectItem key={`${productId}-${u}`} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>
                      Quantidade
                      {movementKind === "inventory" ? (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (+ entrada / − saída)
                        </span>
                      ) : null}
                    </Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder={
                        movementKind === "inventory" ? "Ex.: -2 ou 5" : "0"
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
                    disabled={!unitCode.trim()}
                  />
                  {!unitCode.trim() ? (
                    <p className="text-xs text-muted-foreground">
                      Selecione a unidade de medida para informar o preço.
                    </p>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "grid gap-4",
                    movementKind === "entry" ? "sm:grid-cols-2" : "grid-cols-1",
                  )}
                >
                  <div className="space-y-2">
                    <Label htmlFor="manual-movement-date">
                      Data da movimentação
                    </Label>
                    <Input
                      id="manual-movement-date"
                      type="date"
                      value={movementDate}
                      onChange={(e) => setMovementDate(e.target.value)}
                    />
                  </div>
                  {movementKind === "entry" ? (
                    <div className="space-y-2">
                      <Label htmlFor="manual-expiry-date">
                        Data de validade (lote)
                      </Label>
                      <Input
                        id="manual-expiry-date"
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Opcional. Cria um lote com essa validade vinculado à
                        entrada.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="shrink-0 gap-2 border-t border-border bg-card px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void handleFooterSubmit()}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : isBatch ? (
              "Registrar movimentações"
            ) : (
              "Registrar"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

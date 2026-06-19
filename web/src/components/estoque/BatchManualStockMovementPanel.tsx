import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultBatchLineDraft,
  filterProductsForBatchPicker,
  type BatchPickerProduct,
} from "@/lib/batchStockMovementPicker";
import {
  ENTRY_CLASSIFICATION_OPTIONS,
  EXIT_CLASSIFICATION_OPTIONS,
  MANUAL_MOVEMENT_KIND_OPTIONS,
  todayDateInputValue,
  type EntryClassification,
  type ExitClassification,
  type ManualMovementKind,
} from "@/lib/manualStockMovement";
import {
  formatCurrencyInput,
  allowedUnitsForProduct,
} from "@/lib/manualStockMovementUnits";
import {
  submitManualStockMovementBatch,
  validateManualStockMovementInput,
  type SubmitManualStockMovementInput,
} from "@/lib/manualStockMovementSubmit";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { Check, ChevronsUpDown, Loader2, Search, Trash2 } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

export type BatchLineDraft = {
  unitCode: string;
  quantity: string;
  unitPrice: string;
  expiryDate: string;
};

export type BatchManualStockMovementHandle = {
  submit: () => Promise<boolean>;
};

type Props = {
  companyId: string;
  products: Product[];
  productConversions: ProductUnitConversionDraft[];
  loadingProducts: boolean;
  onSavingChange: (saving: boolean) => void;
};

function MultiFilterPopover({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.length === 0
      ? `Todos`
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.name ?? "1 selecionado"
        : `${selected.length} selecionados`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            <span className="text-muted-foreground">{label}: </span>
            {summary}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Nenhum item cadastrado.
            </p>
          ) : (
            options.map((opt) => {
              const checked = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    checked && "bg-accent/80",
                  )}
                  onClick={() => {
                    onChange(
                      checked
                        ? selected.filter((id) => id !== opt.id)
                        : [...selected, opt.id],
                    );
                  }}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{opt.name}</span>
                </button>
              );
            })
          )}
        </div>
        {selected.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => onChange([])}
          >
            Limpar
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export const BatchManualStockMovementPanel = forwardRef<
  BatchManualStockMovementHandle,
  Props
>(function BatchManualStockMovementPanel(
  { companyId, products, productConversions, loadingProducts, onSavingChange },
  ref,
) {
  const [categories, setCategories] = useState<CompanyProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [productSupplierIds, setProductSupplierIds] = useState<
    Map<string, string[]>
  >(new Map());
  const [categoryByProduct, setCategoryByProduct] = useState<
    Map<string, string[]>
  >(new Map());
  const [search, setSearch] = useState("");
  const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([]);
  const [filterSupplierIds, setFilterSupplierIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lineByProduct, setLineByProduct] = useState<
    Record<string, BatchLineDraft>
  >({});
  const [movementKind, setMovementKind] = useState<ManualMovementKind | "">(
    "",
  );
  const [entryClassification, setEntryClassification] =
    useState<EntryClassification>("purchase");
  const [exitClassification, setExitClassification] =
    useState<ExitClassification>("sale");
  const [movementDate, setMovementDate] = useState(todayDateInputValue());
  const [saveProgress, setSaveProgress] = useState<string | null>(null);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const conversionsByProduct = useMemo(() => {
    const out = new Map<string, ProductUnitConversionDraft[]>();
    for (const row of productConversions) {
      if (!row.product_id) continue;
      const prev = out.get(row.product_id) ?? [];
      prev.push(row);
      out.set(row.product_id, prev);
    }
    return out;
  }, [productConversions]);

  const pickerProducts = useMemo((): BatchPickerProduct[] => {
    return products.map((p) => ({
      ...p,
      categoryIds: categoryByProduct.get(p.id) ?? [],
    }));
  }, [products, categoryByProduct]);

  const filteredProducts = useMemo(
    () =>
      filterProductsForBatchPicker(pickerProducts, {
        search,
        categoryIds: filterCategoryIds,
        supplierIds: filterSupplierIds,
        productSupplierIds,
      }),
    [
      pickerProducts,
      search,
      filterCategoryIds,
      filterSupplierIds,
      productSupplierIds,
    ],
  );

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const loadMeta = useCallback(async () => {
    const [catRes, supRes, assignRes, expRes] = await Promise.all([
      supabase
        .from("company_product_categories")
        .select("id, name, sort_order")
        .eq("company_id", companyId)
        .order("sort_order"),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("product_category_assignments")
        .select("product_id, category_id")
        .eq("company_id", companyId),
      supabase
        .from("expense_items")
        .select("product_id, expenses!inner(company_id, supplier_id)")
        .eq("expenses.company_id", companyId)
        .not("product_id", "is", null),
    ]);

    setCategories((catRes.data ?? []) as CompanyProductCategory[]);
    setSuppliers((supRes.data ?? []) as { id: string; name: string }[]);

    const catMap = new Map<string, string[]>();
    for (const row of assignRes.data ?? []) {
      const pid = String(row.product_id);
      const cid = String(row.category_id);
      const prev = catMap.get(pid) ?? [];
      prev.push(cid);
      catMap.set(pid, prev);
    }
    setCategoryByProduct(catMap);

    const supMap = new Map<string, Set<string>>();
    for (const row of expRes.data ?? []) {
      const pid = String(row.product_id);
      const exp = row.expenses as
        | { supplier_id: string | null }
        | { supplier_id: string | null }[];
      const supplierId = Array.isArray(exp)
        ? exp[0]?.supplier_id
        : exp?.supplier_id;
      if (!supplierId) continue;
      const set = supMap.get(pid) ?? new Set();
      set.add(String(supplierId));
      supMap.set(pid, set);
    }
    const out = new Map<string, string[]>();
    for (const [pid, set] of supMap) {
      out.set(pid, [...set]);
    }
    setProductSupplierIds(out);
  }, [companyId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        const product = productById.get(id);
        if (product) {
          setLineByProduct((lines) =>
            lines[id]
              ? lines
              : { ...lines, [id]: defaultBatchLineDraft(product) },
          );
        }
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of filteredProducts) {
        next.add(p.id);
      }
      return next;
    });
    setLineByProduct((lines) => {
      const next = { ...lines };
      for (const p of filteredProducts) {
        if (!next[p.id]) {
          next[p.id] = defaultBatchLineDraft(p);
        }
      }
      return next;
    });
  };

  const removeSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateLine = (id: string, patch: Partial<BatchLineDraft>) => {
    setLineByProduct((prev) => ({
      ...prev,
      [id]: { ...prev[id]!, ...patch },
    }));
  };

  const classification =
    movementKind === "entry"
      ? entryClassification
      : movementKind === "exit"
        ? exitClassification
        : null;

  const submit = useCallback(async (): Promise<boolean> => {
    if (!movementKind) {
      toast.error("Selecione o tipo da movimentação.");
      return false;
    }
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos um produto.");
      return false;
    }
    if (!movementDate.trim()) {
      toast.error("Informe a data das movimentações.");
      return false;
    }

    const items: SubmitManualStockMovementInput[] = [];
    for (const id of selectedIds) {
      const product = productById.get(id);
      if (!product) continue;
      const line = lineByProduct[id] ?? defaultBatchLineDraft(product);
      items.push({
        product,
        conversions: conversionsByProduct.get(id) ?? [],
        movementKind,
        classification,
        unitCode: line.unitCode,
        quantityRaw: line.quantity,
        unitPriceRaw: line.unitPrice,
        movementDate,
        expiryDate:
          movementKind === "entry" ? line.expiryDate : undefined,
        registrationMode: "batch",
      });
    }

    for (const item of items) {
      const v = validateManualStockMovementInput(item);
      if (!v.ok) {
        toast.error(`${item.product.name}: ${v.message}`);
        return false;
      }
    }

    onSavingChange(true);
    setSaveProgress(`0/${items.length}`);
    const result = await submitManualStockMovementBatch(
      items,
      (done, total) => setSaveProgress(`${done}/${total}`),
    );
    onSavingChange(false);
    setSaveProgress(null);

    if (result.failed === 0) {
      toast.success(
        `${result.ok} movimentação${result.ok === 1 ? "" : "ões"} registrada${result.ok === 1 ? "" : "s"}.`,
      );
      return true;
    }
    if (result.ok > 0) {
      toast.warning(
        `${result.ok} de ${items.length} registradas. ${result.lastError ?? ""}`,
      );
      return true;
    }
    toast.error(result.lastError ?? "Não foi possível registrar o lote.");
    return false;
  }, [
    movementKind,
    selectedIds,
    movementDate,
    productById,
    lineByProduct,
    conversionsByProduct,
    classification,
    onSavingChange,
  ]);

  useImperativeHandle(ref, () => ({ submit }), [submit]);

  const selectedList = [...selectedIds]
    .map((id) => productById.get(id))
    .filter((p): p is Product => p != null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-2 lg:divide-x lg:divide-border">
      <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0">
        <div className="shrink-0 space-y-3 border-b border-border bg-card/50 p-4">
          <p className="text-sm font-semibold">Selecionar produtos</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <MultiFilterPopover
              label="Categoria"
              options={categories.map((c) => ({ id: c.id, name: c.name }))}
              selected={filterCategoryIds}
              onChange={setFilterCategoryIds}
            />
            <MultiFilterPopover
              label="Fornecedor"
              options={suppliers}
              selected={filterSupplierIds}
              onChange={setFilterSupplierIds}
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto por nome…"
              className="h-9 pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {loadingProducts
                ? "Carregando…"
                : `${filteredProducts.length} produto(s) encontrado(s)`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filteredProducts.length === 0}
              onClick={selectAllVisible}
            >
              Selecionar todos
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loadingProducts ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando produtos…
            </div>
          ) : filteredProducts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum produto encontrado.
            </p>
          ) : (
            <ul className="space-y-2">
              {filteredProducts.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const catIds = p.categoryIds;
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-border/80 bg-background px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{p.name}</p>
                        {catIds.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {catIds.slice(0, 2).map((cid) => (
                              <Badge
                                key={cid}
                                variant="secondary"
                                className="text-[0.65rem] font-normal"
                              >
                                {categoryNameById.get(cid) ?? "—"}
                              </Badge>
                            ))}
                            {catIds.length > 2 ? (
                              <Badge
                                variant="outline"
                                className="text-[0.65rem] font-normal"
                              >
                                +{catIds.length - 2}
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={isSelected ? "secondary" : "default"}
                        className="shrink-0"
                        onClick={() => toggleSelect(p.id)}
                      >
                        {isSelected ? (
                          <>
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Selecionado
                          </>
                        ) : (
                          "Selecionar"
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="shrink-0 space-y-3 border-b border-border bg-card/50 p-4">
          <p className="text-sm font-semibold">
            Produtos selecionados ({selectedIds.size})
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Tipo <span className="text-destructive">*</span>
              </Label>
              <Select
                value={movementKind || "__none__"}
                onValueChange={(v) =>
                  setMovementKind(
                    v === "__none__" ? "" : (v as ManualMovementKind),
                  )
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Entrada, saída ou inventário" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Selecionar</SelectItem>
                  {MANUAL_MOVEMENT_KIND_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Classificação</Label>
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
                disabled={!movementKind || movementKind === "inventory"}
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={
                      movementKind === "inventory"
                        ? "Não se aplica"
                        : "Selecionar"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {movementKind === "entry"
                    ? ENTRY_CLASSIFICATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))
                    : movementKind === "exit"
                      ? EXIT_CLASSIFICATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))
                      : null}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data das movimentações</Label>
              <Input
                type="date"
                className="h-9"
                value={movementDate}
                onChange={(e) => setMovementDate(e.target.value)}
              />
            </div>
          </div>
          {!movementKind ? (
            <p className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
              Selecione um tipo para liberar o preenchimento das movimentações.
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selectedList.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nenhum produto selecionado.
            </p>
          ) : (
            <ul className="space-y-3">
              {selectedList.map((p) => {
                const line =
                  lineByProduct[p.id] ?? defaultBatchLineDraft(p);
                const units = allowedUnitsForProduct(
                  p,
                  conversionsByProduct.get(p.id) ?? [],
                );
                const fieldsEnabled = Boolean(movementKind);
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-border bg-background p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="font-medium leading-snug">{p.name}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive"
                        onClick={() => removeSelected(p.id)}
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {fieldsEnabled ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Unidade
                          </Label>
                          <Select
                            value={line.unitCode || "__u__"}
                            onValueChange={(v) =>
                              updateLine(p.id, {
                                unitCode: v === "__u__" ? "" : v,
                              })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {units.map((u) => (
                                <SelectItem key={u} value={u}>
                                  {u}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Quantidade
                            {movementKind === "inventory" ? " (+/−)" : ""}
                          </Label>
                          <Input
                            className="h-8"
                            type="number"
                            step="0.0001"
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(p.id, { quantity: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Preço / unidade
                          </Label>
                          <Input
                            className="h-8"
                            value={line.unitPrice}
                            disabled={!line.unitCode.trim()}
                            placeholder="R$ 0,00"
                            onChange={(e) =>
                              updateLine(p.id, {
                                unitPrice: formatCurrencyInput(e.target.value),
                              })
                            }
                          />
                        </div>
                        {movementKind === "entry" ? (
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              Validade (opcional)
                            </Label>
                            <Input
                              className="h-8"
                              type="date"
                              value={line.expiryDate}
                              onChange={(e) =>
                                updateLine(p.id, {
                                  expiryDate: e.target.value,
                                })
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {saveProgress ? (
          <p className="shrink-0 border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
            Salvando {saveProgress}…
          </p>
        ) : null}
      </div>
    </div>
  );
});

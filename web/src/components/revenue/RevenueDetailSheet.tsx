import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useCompany } from "@/contexts/CompanyContext";
import {
  buildChildrenMap,
  categoryPathLabel,
  isLeafCategory,
  tipoBadge,
} from "@/lib/companyCategoryLabels";
import {
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import {
  parseSaleQuantity,
  quantityInputPropsForSaleUnit,
  roundHubQuantityForStock,
} from "@/lib/productQuantityInput";
import { flattenProductUnitConversionsDrafts } from "@/lib/productUnitConversionsJson";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import type { RecipeListItem } from "@/types/recipe";
import {
  computeRevenueTaxDeduction,
  type RevenueEntry,
  type RevenueTaxType,
} from "@/types/revenue";
import { parseRevenueCmvLines } from "@/types/revenueCmv";
import type { CompanyRevenueCategoryTaxSetting } from "@/types/revenueCategoryTax";
import { CircleDollarSign, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const REVENUE_TYPE_LABEL: Record<string, string> = {
  operational: "Operacional",
  non_operational: "Não operacional",
};

const ENTRY_MODE_LABEL: Record<string, string> = {
  manual: "Manual",
  product_sale: "Venda de produto",
  recipe_sale: "Venda por receita (ficha)",
};

export interface RevenueDetailSheetProps {
  revenueEntryId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
}

export function RevenueDetailSheet({
  revenueEntryId,
  onClose,
  onRefresh,
}: RevenueDetailSheetProps) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [detail, setDetail] = useState<RevenueEntry | null>(null);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loading, setLoading] = useState(false);

  const [detailEditMode, setDetailEditMode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [entryMode, setEntryMode] = useState<
    "manual" | "product_sale" | "recipe_sale"
  >("manual");
  const [revenueType, setRevenueType] = useState<
    "operational" | "non_operational"
  >("operational");
  const [entryDate, setEntryDate] = useState("");
  const [title, setTitle] = useState("");
  const [categoryLeafId, setCategoryLeafId] = useState("");
  const [productId, setProductId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [saleUnitCode, setSaleUnitCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [pricingMode, setPricingMode] = useState<"unit" | "total">("unit");
  const [unitValue, setUnitValue] = useState("");
  const [grossInput, setGrossInput] = useState("");
  const [taxType, setTaxType] = useState<RevenueTaxType>("percentage");
  const [taxValue, setTaxValue] = useState("0");
  const [categoryTaxSettings, setCategoryTaxSettings] = useState<
    Pick<
      CompanyRevenueCategoryTaxSetting,
      "category_id" | "tax_type" | "tax_value"
    >[]
  >([]);

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const childrenMap = useMemo(
    () => buildChildrenMap(companyCategories),
    [companyCategories],
  );

  const tipoFilter = useMemo((): "OPERACIONAL" | "NAO_OPERACIONAL" => {
    if (entryMode === "product_sale" || entryMode === "recipe_sale") {
      return "OPERACIONAL";
    }
    return revenueType === "operational" ? "OPERACIONAL" : "NAO_OPERACIONAL";
  }, [entryMode, revenueType]);

  const receitaCategories = useMemo(
    () =>
      companyCategories.filter(
        (c) =>
          c.natureza === "RECEITA" &&
          c.tipo === tipoFilter &&
          c.ativo !== false,
      ),
    [companyCategories, tipoFilter],
  );

  const leafCategoryOptions = useMemo(() => {
    return receitaCategories
      .filter((c) => isLeafCategory(c.id, childrenMap))
      .filter((c) => c.papel_receita_dre !== "DEDUCAO")
      .sort((a, b) =>
        categoryPathLabel(a.id, categoriesById).localeCompare(
          categoryPathLabel(b.id, categoriesById),
          "pt-BR",
        ),
      );
  }, [receitaCategories, childrenMap, categoriesById]);

  const categorySelectOptions = useMemo(
    () =>
      leafCategoryOptions.map((c) => ({
        value: c.id,
        label: categoryPathLabel(c.id, categoriesById),
      })),
    [leafCategoryOptions, categoriesById],
  );

  const productSelectOptions = useMemo(
    () =>
      products
        .filter((p) => p.is_active !== false)
        .map(productSearchOption),
    [products],
  );

  const recipeSelectOptions = useMemo(
    () =>
      recipes
        .filter((r) => r.active !== false)
        .map((r) => ({
          value: r.id,
          label: r.name,
          description:
            r.batch_yield != null ? `Rendimento ${r.batch_yield}` : undefined,
        })),
    [recipes],
  );

  const taxPresetByCategory = useMemo(() => {
    const m = new Map<
      string,
      { tax_type: RevenueTaxType; tax_value: number }
    >();
    for (const row of categoryTaxSettings) {
      m.set(row.category_id, {
        tax_type: row.tax_type,
        tax_value: Number(row.tax_value),
      });
    }
    return m;
  }, [categoryTaxSettings]);

  const grossNum = parseFloat(grossInput.replace(",", ".")) || 0;
  const taxValNum = parseFloat(taxValue.replace(",", ".")) || 0;
  const { taxAmount, netAmount } = computeRevenueTaxDeduction({
    gross: grossNum,
    taxType,
    taxValue: taxValNum,
  });

  const unitNum = parseFloat(unitValue.replace(",", ".")) || 0;
  const selectedProduct = productId
    ? products.find((p) => p.id === productId)
    : undefined;

  const selectedRecipe = recipeId
    ? recipes.find((r) => r.id === recipeId)
    : undefined;

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
  const allowedUnitsForProduct = useCallback(
    (pid: string): string[] => {
      const product = productById.get(pid);
      if (!product) return [];
      const base = product.unit;
      const allowed = new Set<string>([base]);
      const convs = conversionsByProduct.get(pid) ?? [];
      for (const c of convs) {
        if (
          c.primary_unit_code?.trim().toLowerCase() ===
          base.trim().toLowerCase()
        ) {
          allowed.add(c.secondary_unit_code);
        }
      }
      for (const candidate of ["mg", "g", "kg", "ml", "l"]) {
        if (candidate.toLowerCase() === base.trim().toLowerCase()) continue;
        if (getLockedSystemSecondaryQty(1, base, candidate) != null) {
          allowed.add(candidate);
        }
      }
      return [...allowed];
    },
    [conversionsByProduct, productById],
  );
  const toStockQty = useCallback(
    (pid: string, qty: number, fromUnit: string): number | null => {
      const product = productById.get(pid);
      if (!product) return null;
      const convs = (conversionsByProduct.get(pid) ?? []).map((r) => ({
        primary_unit_code: r.primary_unit_code,
        secondary_unit_code: r.secondary_unit_code,
        primary_qty: Number(r.primary_qty),
        secondary_qty: Number(r.secondary_qty),
      }));
      const raw = convertQuantityForProduct(
        qty,
        fromUnit,
        product.unit,
        product.unit,
        convs,
      );
      return raw == null ? null : roundHubQuantityForStock(raw);
    },
    [conversionsByProduct, productById],
  );

  const qtyNum = useMemo(() => {
    if (entryMode === "recipe_sale") return 1;
    if (entryMode === "product_sale" && selectedProduct && saleUnitCode) {
      return parseSaleQuantity(quantity, saleUnitCode, selectedProduct.unit);
    }
    return parseFloat(quantity.replace(",", ".")) || 0;
  }, [entryMode, quantity, selectedProduct, saleUnitCode]);

  const computedGrossProduct = useMemo(() => {
    if (entryMode !== "product_sale" && entryMode !== "recipe_sale") {
      return grossNum;
    }
    if (pricingMode === "unit") return Math.round(qtyNum * unitNum * 100) / 100;
    return grossNum;
  }, [entryMode, pricingMode, qtyNum, unitNum, grossNum]);

  const effectiveGross =
    (entryMode === "product_sale" || entryMode === "recipe_sale") &&
    pricingMode === "unit"
      ? computedGrossProduct
      : grossNum;

  const productTaxNet = computeRevenueTaxDeduction({
    gross: effectiveGross,
    taxType,
    taxValue: taxValNum,
  });

  const quantityFieldProps = quantityInputPropsForSaleUnit(
    entryMode === "product_sale"
      ? saleUnitCode || selectedProduct?.unit
      : undefined,
    selectedProduct?.unit,
  );

  const load = useCallback(async () => {
    if (!revenueEntryId || !companyId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    const [entryRes, catRes, prodRes, recipeRes, taxRes] = await Promise.all([
      supabase
        .from("revenue_entries")
        .select("*")
        .eq("id", revenueEntryId)
        .single(),
      supabase
        .from("company_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("ordem", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("recipes")
        .select("id, name, batch_yield, active")
        .eq("company_id", companyId)
        .order("name"),
      supabase
        .from("company_revenue_category_tax_settings")
        .select("category_id, tax_type, tax_value")
        .eq("company_id", companyId),
    ]);
    setLoading(false);

    if (entryRes.error || !entryRes.data) {
      console.error(entryRes.error);
      toast.error("Não foi possível carregar a venda.");
      setDetail(null);
      return;
    }

    const productsList = (prodRes.data as Product[]) ?? [];
    setDetail(entryRes.data as RevenueEntry);
    setCompanyCategories((catRes.data as CompanyCategory[]) ?? []);
    setProducts(productsList);
    setRecipes((recipeRes.data as RecipeListItem[]) ?? []);
    setProductConversions(
      flattenProductUnitConversionsDrafts(companyId, productsList),
    );
    setCategoryTaxSettings(
      (taxRes.data ?? []) as Pick<
        CompanyRevenueCategoryTaxSetting,
        "category_id" | "tax_type" | "tax_value"
      >[],
    );
  }, [revenueEntryId, companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!revenueEntryId) {
      queueMicrotask(() => {
        setDetail(null);
        setDetailEditMode(false);
      });
    }
  }, [revenueEntryId]);

  useEffect(() => {
    if (entryMode === "product_sale" || entryMode === "recipe_sale") {
      queueMicrotask(() => setRevenueType("operational"));
    }
  }, [entryMode]);

  useEffect(() => {
    if (!detailEditMode || entryMode !== "product_sale") return;
    if (!selectedProduct) {
      queueMicrotask(() => setSaleUnitCode(""));
      return;
    }
    queueMicrotask(() =>
      setSaleUnitCode((prev) => prev || selectedProduct.unit),
    );
  }, [detailEditMode, entryMode, selectedProduct]);

  useEffect(() => {
    if (!detailEditMode) return;
    if (!categoryLeafId) {
      queueMicrotask(() => setTaxType("percentage"));
      queueMicrotask(() => setTaxValue("0"));
      return;
    }
    const p = taxPresetByCategory.get(categoryLeafId);
    if (p) {
      queueMicrotask(() => setTaxType(p.tax_type));
      queueMicrotask(() => setTaxValue(String(p.tax_value)));
    } else {
      queueMicrotask(() => setTaxType("percentage"));
      queueMicrotask(() => setTaxValue("0"));
    }
  }, [detailEditMode, categoryLeafId, taxPresetByCategory]);

  const startEdit = () => {
    if (!detail) return;
    setEntryMode(detail.entry_mode);
    setRevenueType(detail.revenue_type);
    setEntryDate(detail.entry_date.slice(0, 10));
    setTitle(detail.title);
    setCategoryLeafId(detail.subcategory_id);
    setProductId(detail.product_id ?? "");
    const saleProd = detail.product_id
      ? products.find((p) => p.id === detail.product_id)
      : undefined;
    setSaleUnitCode(saleProd?.unit ?? "");
    setRecipeId(detail.recipe_id ?? "");
    setQuantity(
      detail.entry_mode === "recipe_sale"
        ? "1"
        : detail.quantity != null
          ? String(detail.quantity)
          : "1",
    );
    setPricingMode(detail.pricing_mode ?? "unit");
    setUnitValue(detail.unit_value != null ? String(detail.unit_value) : "");
    setGrossInput(String(detail.gross_amount));
    setDetailEditMode(true);
  };

  const cancelEdit = () => {
    setDetailEditMode(false);
  };

  const canSubmit = useMemo(() => {
    if (!companyId || !detail) return false;
    if (!entryDate) return false;
    if (!title.trim()) return false;
    if (entryMode === "manual" && !categoryLeafId) return false;
    if (
      (entryMode === "product_sale" || entryMode === "recipe_sale") &&
      !categoryLeafId
    ) {
      return false;
    }
    if (effectiveGross <= 0) return false;
    if (entryMode === "product_sale") {
      if (!productId || qtyNum <= 0 || !saleUnitCode) return false;
      if (toStockQty(productId, qtyNum, saleUnitCode) == null) return false;
      if (pricingMode === "unit" && unitNum < 0) return false;
      if (pricingMode === "total" && grossNum <= 0) return false;
    }
    if (entryMode === "recipe_sale") {
      if (!recipeId) return false;
      if (pricingMode === "unit" && unitNum < 0) return false;
      if (pricingMode === "total" && grossNum <= 0) return false;
    }
    return true;
  }, [
    companyId,
    detail,
    entryDate,
    title,
    entryMode,
    categoryLeafId,
    effectiveGross,
    productId,
    recipeId,
    saleUnitCode,
    qtyNum,
    pricingMode,
    unitNum,
    grossNum,
    toStockQty,
  ]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !detail || !canSubmit || editSaving) return;

    const grossPayload =
      (entryMode === "product_sale" || entryMode === "recipe_sale") &&
      pricingMode === "unit"
        ? computedGrossProduct
        : effectiveGross;

    const revenueLeaf = categoriesById.get(categoryLeafId);
    const payload: Record<string, unknown> = {
      entry_id: detail.id,
      company_id: companyId,
      entry_date: entryDate,
      title: title.trim(),
      entry_mode: entryMode,
      revenue_type:
        entryMode === "product_sale" || entryMode === "recipe_sale"
          ? "operational"
          : revenueType,
      category_id: revenueLeaf?.parent_id ?? null,
      subcategory_id: categoryLeafId,
      gross_amount: grossPayload,
    };

    if (entryMode === "manual") {
      payload.product_id = null;
      payload.recipe_id = null;
      payload.quantity = null;
      payload.pricing_mode = null;
      payload.unit_value = null;
    } else if (entryMode === "product_sale") {
      if (toStockQty(productId, qtyNum, saleUnitCode) == null) return;
      payload.product_id = productId;
      payload.recipe_id = null;
      payload.quantity = qtyNum;
      payload.sale_unit_code = saleUnitCode || productById.get(productId)?.unit || "un";
      payload.pricing_mode = pricingMode;
      payload.unit_value = pricingMode === "unit" ? unitNum : null;
    } else {
      payload.product_id = null;
      payload.recipe_id = recipeId;
      payload.quantity = qtyNum > 0 ? qtyNum : 1;
      payload.pricing_mode = pricingMode;
      payload.unit_value = pricingMode === "unit" ? unitNum : null;
    }

    setEditSaving(true);
    const { data, error } = await supabase.rpc("update_revenue_entry", {
      p_payload: payload,
    });
    setEditSaving(false);

    if (error) {
      console.error(error);
      toast.error(error.message || "Não foi possível salvar.");
      return;
    }

    if (!data) {
      toast.error("Resposta inválida ao atualizar.");
      return;
    }

    toast.success("Venda atualizada.");
    setDetailEditMode(false);
    await load();
    onRefresh?.();
  };

  const handleDelete = async () => {
    if (!detail?.id) return;
    setDeleting(true);
    const { error } = await supabase.rpc("delete_revenue_entry", {
      p_entry_id: detail.id,
    });
    setDeleting(false);
    if (error) {
      console.error(error);
      toast.error(error.message || "Não foi possível excluir.");
      return;
    }
    setDeleteDialogOpen(false);
    toast.success("Venda excluída.");
    onClose();
    onRefresh?.();
  };

  const handleSheetOpenChange = (o: boolean) => {
    if (!o) {
      onClose();
      setDetailEditMode(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const formatDate = (s: string) =>
    new Date(s + "T12:00:00").toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const taxSummaryLabel =
    taxType === "percentage"
      ? `Taxa (${taxValNum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`
      : "Taxa (R$)";

  const displayTax =
    (entryMode === "product_sale" || entryMode === "recipe_sale") &&
    pricingMode === "unit"
      ? productTaxNet.taxAmount
      : taxAmount;
  const displayNet =
    (entryMode === "product_sale" || entryMode === "recipe_sale") &&
    pricingMode === "unit"
      ? productTaxNet.netAmount
      : netAmount;

  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );

  const recipeNameById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r.name])),
    [recipes],
  );

  if (!companyId) return null;

  return (
    <>
      <Sheet open={!!revenueEntryId} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          className="z-[70] overflow-y-auto sm:max-w-lg"
          overlayClassName="z-[70]"
        >
          {loading && (
            <p className="text-sm text-muted-foreground py-8">Carregando…</p>
          )}
          {!loading && detail && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between pr-8">
                  <SheetTitle>
                    {detailEditMode ? "Editar venda" : "Dados da venda"}
                  </SheetTitle>
                  {!detailEditMode && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={startEdit}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Editar
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir
                      </Button>
                    </div>
                  )}
                </div>
                <SheetDescription className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {detail.title}
                  </span>
                  <Badge variant="secondary">
                    {ENTRY_MODE_LABEL[detail.entry_mode] ?? detail.entry_mode}
                  </Badge>
                </SheetDescription>
              </SheetHeader>

              {detailEditMode ? (
                <form onSubmit={handleUpdate} className="space-y-5 py-4">
                  <div>
                    <Label>Modo de lançamento</Label>
                    <Select
                      value={entryMode}
                      onValueChange={(v) => {
                        const m = v as
                          | "manual"
                          | "product_sale"
                          | "recipe_sale";
                        setEntryMode(m);
                        if (m === "manual") {
                          setProductId("");
                          setRecipeId("");
                          setSaleUnitCode("");
                        } else if (m === "product_sale") {
                          setRecipeId("");
                        } else {
                          setProductId("");
                          setSaleUnitCode("");
                          setQuantity("1");
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">
                          Lançamento por período
                        </SelectItem>
                        <SelectItem value="product_sale">
                          Venda de produto
                        </SelectItem>
                        <SelectItem value="recipe_sale">
                          Venda por receita (ficha)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {entryMode === "manual" && (
                    <div>
                      <Label>Tipo da receita</Label>
                      <Select
                        value={revenueType}
                        onValueChange={(v) =>
                          setRevenueType(v as "operational" | "non_operational")
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="operational">
                            Operacional
                          </SelectItem>
                          <SelectItem value="non_operational">
                            Não operacional
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {(entryMode === "product_sale" ||
                    entryMode === "recipe_sale") && (
                    <p className="text-sm text-muted-foreground rounded-md border border-border/80 bg-muted/40 px-3 py-2">
                      Este lançamento é receita{" "}
                      <span className="font-medium text-foreground">
                        operacional
                      </span>
                      . A{" "}
                      <span className="font-medium text-foreground">
                        categoria da venda
                      </span>{" "}
                      classifica no DRE.{" "}
                      {entryMode === "product_sale" ? (
                        <>O produto define estoque e CMV.</>
                      ) : (
                        <>
                          A receita (ficha) baixa os ingredientes; quantidade
                          fixa em 1 unidade.
                        </>
                      )}
                    </p>
                  )}

                  <div>
                    <Label>Data da receita</Label>
                    <Input
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      required
                    />
                  </div>

                  {entryMode === "manual" && (
                    <>
                      <div>
                        <Label>Título</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Ex.: Vendas do fim de semana"
                          required
                        />
                      </div>
                      <div>
                        <Label>Categoria</Label>
                        <SearchSelect
                          value={categoryLeafId || "__none__"}
                          onValueChange={(v) =>
                            setCategoryLeafId(v === "__none__" ? "" : v)
                          }
                          options={categorySelectOptions}
                          leadingOptions={[
                            { value: "__none__", label: "Selecione" },
                          ]}
                          placeholder="Selecione a categoria"
                          searchPlaceholder="Buscar categoria…"
                          emptyMessage="Nenhuma categoria encontrada."
                        />
                      </div>
                    </>
                  )}

                  {entryMode === "product_sale" && (
                    <>
                      <div>
                        <Label>Produto</Label>
                        <SearchSelect
                          value={productId || "__none__"}
                          onValueChange={(v) => {
                            const id = v === "__none__" ? "" : v;
                            setProductId(id);
                            const p = products.find((x) => x.id === id);
                            setSaleUnitCode(p?.unit ?? "");
                            setTitle(p ? `Venda — ${p.name}` : "");
                          }}
                          options={productSelectOptions}
                          leadingOptions={[
                            { value: "__none__", label: "Selecione" },
                          ]}
                          placeholder="Selecione o produto"
                          searchPlaceholder="Buscar produto…"
                          emptyMessage="Nenhum produto encontrado."
                        />
                      </div>
                      <div>
                        <Label>Categoria da venda *</Label>
                        <SearchSelect
                          value={categoryLeafId || "__none__"}
                          onValueChange={(v) =>
                            setCategoryLeafId(v === "__none__" ? "" : v)
                          }
                          options={categorySelectOptions}
                          leadingOptions={[
                            { value: "__none__", label: "Selecione" },
                          ]}
                          placeholder="Selecione a categoria da receita"
                          searchPlaceholder="Buscar categoria…"
                          emptyMessage="Nenhuma categoria encontrada."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Quantidade</Label>
                          <Input
                            type="number"
                            step={quantityFieldProps.step}
                            min={quantityFieldProps.min}
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            onBlur={() => {
                              if (!quantityFieldProps.integerOnly) return;
                              const n = Math.max(
                                1,
                                Math.round(parseFloat(quantity) || 0),
                              );
                              setQuantity(String(n));
                            }}
                          />
                        </div>
                        <div>
                          <Label>Unidade</Label>
                          <Select
                            value={saleUnitCode || "__none__"}
                            onValueChange={(v) =>
                              setSaleUnitCode(v === "__none__" ? "" : v)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Unidade" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                Selecione
                              </SelectItem>
                              {productId
                                ? allowedUnitsForProduct(productId).map((u) => (
                                    <SelectItem
                                      key={`${productId}-${u}`}
                                      value={u}
                                    >
                                      {u}
                                    </SelectItem>
                                  ))
                                : null}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Preço</Label>
                          <Select
                            value={pricingMode}
                            onValueChange={(v) =>
                              setPricingMode(v as "unit" | "total")
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unit">
                                Valor unitário
                              </SelectItem>
                              <SelectItem value="total">Valor total</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {pricingMode === "unit" ? (
                        <div>
                          <Label>Valor unitário (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={unitValue}
                            onChange={(e) => setUnitValue(e.target.value)}
                          />
                        </div>
                      ) : (
                        <div>
                          <Label>Valor total da venda (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={grossInput}
                            onChange={(e) => setGrossInput(e.target.value)}
                          />
                        </div>
                      )}
                      <div>
                        <Label>Título do lançamento</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {entryMode === "recipe_sale" && (
                    <>
                      <div>
                        <Label>Receita (ficha)</Label>
                        <SearchSelect
                          value={recipeId || "__none__"}
                          onValueChange={(v) => {
                            const id = v === "__none__" ? "" : v;
                            setRecipeId(id);
                            const r = recipes.find((x) => x.id === id);
                            setTitle(r ? `Venda — ${r.name}` : "");
                          }}
                          options={recipeSelectOptions}
                          leadingOptions={[
                            { value: "__none__", label: "Selecione" },
                          ]}
                          placeholder="Selecione a receita"
                          searchPlaceholder="Buscar ficha…"
                          emptyMessage="Nenhuma receita encontrada."
                        />
                      </div>
                      <div>
                        <Label>Categoria da venda *</Label>
                        <SearchSelect
                          value={categoryLeafId || "__none__"}
                          onValueChange={(v) =>
                            setCategoryLeafId(v === "__none__" ? "" : v)
                          }
                          options={categorySelectOptions}
                          leadingOptions={[
                            { value: "__none__", label: "Selecione" },
                          ]}
                          placeholder="Selecione a categoria da receita"
                          searchPlaceholder="Buscar categoria…"
                          emptyMessage="Nenhuma categoria encontrada."
                        />
                      </div>
                      <p className="text-sm rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          1 unidade
                        </span>{" "}
                        — produtos conforme a ficha
                        {selectedRecipe?.batch_yield != null
                          ? ` (rendimento ${selectedRecipe.batch_yield}).`
                          : "."}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Preço</Label>
                          <Select
                            value={pricingMode}
                            onValueChange={(v) =>
                              setPricingMode(v as "unit" | "total")
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unit">
                                Valor por porção
                              </SelectItem>
                              <SelectItem value="total">Valor total</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {pricingMode === "unit" ? (
                        <div>
                          <Label>Valor por porção (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={unitValue}
                            onChange={(e) => setUnitValue(e.target.value)}
                          />
                        </div>
                      ) : (
                        <div>
                          <Label>Valor total da venda (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={grossInput}
                            onChange={(e) => setGrossInput(e.target.value)}
                          />
                        </div>
                      )}
                      <div>
                        <Label>Título do lançamento</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </div>
                    </>
                  )}

                  {entryMode === "manual" && (
                    <div>
                      <Label>Valor bruto (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={grossInput}
                        onChange={(e) => setGrossInput(e.target.value)}
                        required
                      />
                    </div>
                  )}

                  <div className="rounded-lg border border-border/80 bg-muted/30 px-3 py-3 text-sm space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        Taxa / imposto (por categoria)
                      </span>
                      <Link
                        to="/app/configuracoes/impostos-receita"
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        Configurar
                      </Link>
                    </div>
                    {categoryLeafId ? (
                      <p className="text-muted-foreground">
                        {taxSummaryLabel}
                        {taxPresetByCategory.has(categoryLeafId)
                          ? " — definido para esta categoria."
                          : " — sem configuração específica; será usado 0% até você definir em Configurações."}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        Selecione a categoria de receita para exibir a taxa
                        aplicável.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm space-y-1.5">
                    <p className="font-medium text-foreground">
                      Resumo financeiro
                    </p>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Valor bruto</span>
                      <span>{formatCurrency(effectiveGross)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {taxSummaryLabel}
                      </span>
                      <span>- {formatCurrency(displayTax)}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-medium">
                      <span>Valor líquido</span>
                      <span>{formatCurrency(displayNet)}</span>
                    </div>
                    <div className="flex justify-between gap-2 pt-1 border-t border-border/60">
                      <span className="text-muted-foreground">Faturamento</span>
                      <span>{formatCurrency(effectiveGross)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {ptBrUi.receitas.deducoesFaturamento}
                      </span>
                      <span>{formatCurrency(displayTax)}</span>
                    </div>
                  </div>

                  <SheetFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={cancelEdit}
                      disabled={editSaving}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      className="w-full sm:w-auto"
                      disabled={!canSubmit || editSaving}
                    >
                      {editSaving ? "Salvando..." : "Salvar"}
                    </Button>
                  </SheetFooter>
                </form>
              ) : (
                <div className="space-y-6 py-6">
                  <div className="grid gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Data:</span>{" "}
                      {formatDate(detail.entry_date)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>{" "}
                      {REVENUE_TYPE_LABEL[detail.revenue_type] ??
                        detail.revenue_type}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Categoria:</span>{" "}
                      <span className="break-words">
                        {categoryPathLabel(
                          detail.subcategory_id,
                          categoriesById,
                        )}
                      </span>
                    </div>
                    {detail.entry_mode === "product_sale" &&
                    detail.product_id ? (
                      <div>
                        <span className="text-muted-foreground">Produto:</span>{" "}
                        {productNameById.get(detail.product_id) ??
                          detail.product_id}
                        {detail.quantity != null ? (
                          <>
                            {" "}
                            ·{" "}
                            {Number(detail.quantity).toLocaleString("pt-BR", {
                              maximumFractionDigits: 4,
                            })}{" "}
                            {products.find((p) => p.id === detail.product_id)
                              ?.unit ?? ""}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {detail.entry_mode === "recipe_sale" && detail.recipe_id ? (
                      <div>
                        <span className="text-muted-foreground">
                          Receita (ficha):
                        </span>{" "}
                        {recipeNameById.get(detail.recipe_id) ??
                          detail.recipe_id}
                        <span className="text-muted-foreground">
                          {" "}
                          · 1 unidade
                        </span>
                      </div>
                    ) : null}
                    {categoriesById.get(detail.subcategory_id) ? (
                      <div>
                        <Badge variant="outline">
                          {tipoBadge(
                            categoriesById.get(detail.subcategory_id)!,
                          )}
                        </Badge>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm space-y-2">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Valor bruto</span>
                      <span>{formatCurrency(Number(detail.gross_amount))}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        Taxas / deduções
                      </span>
                      <span>- {formatCurrency(Number(detail.tax_amount))}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-medium border-t border-border/60 pt-2">
                      <span>Valor líquido</span>
                      <span>{formatCurrency(Number(detail.net_amount))}</span>
                    </div>
                    {(detail.entry_mode === "product_sale" ||
                      detail.entry_mode === "recipe_sale") && (
                      <>
                        <div className="flex justify-between gap-2 border-t border-border/60 pt-2">
                          <span className="text-muted-foreground">CMV (na venda)</span>
                          <span>
                            {formatCurrency(Number(detail.cmv_amount ?? 0))}
                            {detail.cmv_needs_backfill ? (
                              <span className="ml-1 text-xs text-orange-600 dark:text-orange-400">
                                (custo pendente)
                              </span>
                            ) : null}
                          </span>
                        </div>
                        {parseRevenueCmvLines(detail.cmv_lines).length > 0 ? (
                          <ul className="space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                            {parseRevenueCmvLines(detail.cmv_lines).map((line) => (
                              <li
                                key={`${line.product_id}-${line.quantity}-${line.unit_code}`}
                                className="flex justify-between gap-2"
                              >
                                <span className="truncate">
                                  {line.product_name ?? "Produto"}{" "}
                                  · {line.quantity.toLocaleString("pt-BR")}{" "}
                                  {line.unit_code}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {formatCurrency(line.amount)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleDollarSign className="h-4 w-4 shrink-0" />
                    <span>
                      Receita e CMV entram no DRE pela data da venda (
                      {formatDate(detail.entry_date)}).
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir venda</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta venda? Os boletos a receber
              vinculados serão removidos. Em venda de produto, a quantidade
              voltará ao estoque; em venda por receita (ficha), os ingredientes
              são estornados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { type MonthYear } from "@/components/MonthSelector";
import { RevenueDetailSheet } from "@/components/revenue/RevenueDetailSheet";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import {
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import {
  buildChildrenMap,
  categoryPathLabel,
  isLeafCategory,
  tipoBadge,
} from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { RecipeListItem } from "@/types/recipe";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  computeRevenueTaxDeduction,
  type RevenueEntry,
  type RevenueTaxType,
} from "@/types/revenue";
import {
  parseSaleQuantity,
  quantityInputPropsForSaleUnit,
  roundHubQuantityForStock,
} from "@/lib/productQuantityInput";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import type { CompanyRevenueCategoryTaxSetting } from "@/types/revenueCategoryTax";
import {
  ChevronsUpDown,
  CircleDollarSign,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type LaunchMode = "manual" | "pontual";
type PontualSaleDraft = {
  id: string;
  ref: string;
  saleUnitCode: string;
  quantity: string;
  pricingMode: "unit" | "total";
  unitValue: string;
  grossInput: string;
};

function createPontualSaleDraft(): PontualSaleDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ref: "",
    saleUnitCode: "",
    quantity: "1",
    pricingMode: "unit",
    unitValue: "",
    grossInput: "",
  };
}

function parsePontualRef(
  ref: string,
): { kind: "product" | "recipe"; id: string } | null {
  if (ref.startsWith("p:")) return { kind: "product", id: ref.slice(2) };
  if (ref.startsWith("r:")) return { kind: "recipe", id: ref.slice(2) };
  return null;
}

function endOfMonthDate(month: number, year: number): string {
  const d = new Date(year, month, 0);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function startOfMonthDate(month: number, year: number): string {
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}-01`;
}

function PontualProductRecipePicker({
  products,
  recipes,
  value,
  onChange,
}: {
  products: Product[];
  recipes: RecipeListItem[];
  value: string;
  onChange: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"products" | "recipes">("products");
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);

  const parsed = useMemo(() => parsePontualRef(value), [value]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.is_active !== false),
    [products],
  );
  const activeRecipes = useMemo(
    () => recipes.filter((r) => r.active !== false),
    [recipes],
  );

  const selectedProduct =
    parsed?.kind === "product"
      ? products.find((p) => p.id === parsed.id)
      : null;
  const selectedRecipe =
    parsed?.kind === "recipe"
      ? recipes.find((r) => r.id === parsed.id)
      : null;

  const triggerLabel = !parsed
    ? "Selecione produto ou receita"
    : parsed.kind === "product" && selectedProduct
      ? `${selectedProduct.name}${selectedProduct.sku ? ` (${selectedProduct.sku})` : ""}`
      : parsed.kind === "recipe" && selectedRecipe
        ? selectedRecipe.name
        : "Selecione produto ou receita";

  const filteredProducts = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return activeProducts;
    return activeProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        !!(p.sku && p.sku.toLowerCase().includes(t)),
    );
  }, [activeProducts, q]);

  const filteredRecipes = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return activeRecipes;
    return activeRecipes.filter((r) => r.name.toLowerCase().includes(t));
  }, [activeRecipes, q]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQ("");
          setTab(parsed?.kind === "recipe" ? "recipes" : "products");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex border-b border-border">
          <button
            type="button"
            className={cn(
              "flex-1 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === "products"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab("products")}
          >
            Produtos
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === "recipes"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab("recipes")}
          >
            Receitas (ficha)
          </button>
        </div>
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                tab === "products" ? "Buscar produto…" : "Buscar receita…"
              }
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div
          ref={listRef}
          className="max-h-64 overflow-y-auto p-1"
        >
          <button
            type="button"
            className="w-full rounded-sm px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Limpar seleção
          </button>
          {tab === "products" ? (
            filteredProducts.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Nenhum produto encontrado.
              </p>
            ) : (
              filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cn(
                    "w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                    parsed?.kind === "product" &&
                      parsed.id === p.id &&
                      "bg-accent/80",
                  )}
                  onClick={() => {
                    onChange(`p:${p.id}`);
                    setOpen(false);
                  }}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.sku ? `${p.sku} · ` : ""}
                    Est.:{" "}
                    {Number(p.current_quantity).toLocaleString("pt-BR", {
                      maximumFractionDigits: 4,
                    })}{" "}
                    {p.unit}
                  </div>
                </button>
              ))
            )
          ) : filteredRecipes.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {activeRecipes.length === 0
                ? "Nenhuma receita ativa."
                : "Nenhuma receita encontrada."}
            </p>
          ) : (
            filteredRecipes.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cn(
                  "w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                  parsed?.kind === "recipe" &&
                    parsed.id === r.id &&
                    "bg-accent/80",
                )}
                onClick={() => {
                  onChange(`r:${r.id}`);
                  setOpen(false);
                }}
              >
                <div className="font-medium">{r.name}</div>
                {r.batch_yield != null ? (
                  <div className="text-xs text-muted-foreground">
                    Rend. {r.batch_yield}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Receitas() {
  const { currentCompany } = useCompany();
  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [rows, setRows] = useState<RevenueEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailRevenueId, setDetailRevenueId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [baseMode, setBaseMode] = useState<LaunchMode>("manual");
  const [pontualItems, setPontualItems] = useState<PontualSaleDraft[]>([
    createPontualSaleDraft(),
  ]);
  const [revenueType, setRevenueType] = useState<
    "operational" | "non_operational"
  >("operational");
  const [entryDate, setEntryDate] = useState(() => {
    const t = new Date();
    return t.toISOString().slice(0, 10);
  });
  const [title, setTitle] = useState("");
  /** Folha de receita (ex.: "Receita Operacional › Vendas de produtos") */
  const [categoryLeafId, setCategoryLeafId] = useState<string>("");
  const [grossInput, setGrossInput] = useState<string>("");
  const [taxType, setTaxType] = useState<RevenueTaxType>("percentage");
  const [taxValue, setTaxValue] = useState<string>("0");
  /** Taxas salvas em Configurações (por folha de receita). */
  const [categoryTaxSettings, setCategoryTaxSettings] = useState<
    Pick<CompanyRevenueCategoryTaxSetting, "category_id" | "tax_type" | "tax_value">[]
  >([]);

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const childrenMap = useMemo(
    () => buildChildrenMap(companyCategories),
    [companyCategories],
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

  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const isPontual = baseMode === "pontual";

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
        if (c.primary_unit_code?.trim().toLowerCase() === base.trim().toLowerCase()) {
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

  const tipoFilter = useMemo((): "OPERACIONAL" | "NAO_OPERACIONAL" => {
    if (isPontual) return "OPERACIONAL";
    return revenueType === "operational" ? "OPERACIONAL" : "NAO_OPERACIONAL";
  }, [isPontual, revenueType]);

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

  /** Folhas de receita classificáveis (exclui linha exclusiva de dedução DRE) */
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

  const grossNum = parseFloat(grossInput.replace(",", ".")) || 0;
  const taxValNum = parseFloat(taxValue.replace(",", ".")) || 0;
  const { taxAmount, netAmount } = computeRevenueTaxDeduction({
    gross: grossNum,
    taxType,
    taxValue: taxValNum,
  });

  const pontualItemStates = useMemo(
    () =>
      pontualItems.map((item) => {
        const parsed = parsePontualRef(item.ref);
        const isProductSale = parsed?.kind === "product";
        const isRecipeSale = parsed?.kind === "recipe";
        const productId = isProductSale ? parsed.id : "";
        const recipeId = isRecipeSale ? parsed.id : "";
        const selectedProduct = productId ? productById.get(productId) : undefined;
        const selectedRecipe = recipeId
          ? recipes.find((r) => r.id === recipeId)
          : undefined;
        const quantityFieldProps = quantityInputPropsForSaleUnit(
          isProductSale ? item.saleUnitCode || selectedProduct?.unit : undefined,
          selectedProduct?.unit,
        );
        const qtyNum = isRecipeSale
          ? 1
          : isProductSale && item.saleUnitCode && selectedProduct
            ? parseSaleQuantity(
                item.quantity,
                item.saleUnitCode,
                selectedProduct.unit,
              )
            : parseFloat(item.quantity.replace(",", ".")) || 0;
        const stockQtyNum =
          isProductSale && selectedProduct && item.saleUnitCode
            ? (toStockQty(selectedProduct.id, qtyNum, item.saleUnitCode) ?? 0)
            : 0;
        const stockOk =
          !isProductSale ||
          !selectedProduct ||
          qtyNum <= 0 ||
          Number(selectedProduct.current_quantity) >= stockQtyNum;
        const unitNum = parseFloat(item.unitValue.replace(",", ".")) || 0;
        const grossNumItem = parseFloat(item.grossInput.replace(",", ".")) || 0;
        const computedGross =
          item.pricingMode === "unit" ? Math.round(qtyNum * unitNum * 100) / 100 : 0;
        const effectiveGross =
          item.pricingMode === "unit" ? computedGross : grossNumItem;
        const title =
          isRecipeSale && selectedRecipe
            ? `Venda — ${selectedRecipe.name}`
            : isProductSale && selectedProduct
              ? `Venda — ${selectedProduct.name}`
              : "Venda pontual";
        return {
          ...item,
          parsed,
          isProductSale,
          isRecipeSale,
          productId,
          recipeId,
          selectedProduct,
          selectedRecipe,
          quantityFieldProps,
          qtyNum,
          stockQtyNum,
          stockOk,
          unitNum,
          grossNumItem,
          effectiveGross,
          title,
        };
      }),
    [pontualItems, productById, recipes, toStockQty],
  );

  const pontualGrossTotal = useMemo(
    () => pontualItemStates.reduce((sum, item) => sum + item.effectiveGross, 0),
    [pontualItemStates],
  );

  const recipeNameById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r.name])),
    [recipes],
  );

  const effectiveGross = isPontual ? pontualGrossTotal : grossNum;

  const summaryTaxNet = computeRevenueTaxDeduction({
    gross: effectiveGross,
    taxType,
    taxValue: taxValNum,
  });

  const fetchData = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const startD = startOfMonthDate(period.month, period.year);
    const endD = endOfMonthDate(period.month, period.year);

    let q = supabase
      .from("revenue_entries")
      .select("*", { count: "exact" })
      .eq("company_id", currentCompany.id)
      .gte("entry_date", startD)
      .lte("entry_date", endD)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      q = q.ilike("title", term);
    }

    const { data, count, error } = await q.range(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE - 1,
    );

    const { data: catRows } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("ordem", { ascending: true })
      .order("name", { ascending: true });

    const { data: prodRows } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("name");
    const { data: convRows } = await supabase
      .from("product_unit_conversions")
      .select("*")
      .eq("company_id", currentCompany.id);

    const { data: recipeRows } = await supabase
      .from("recipes")
      .select("id, name, batch_yield, active")
      .eq("company_id", currentCompany.id)
      .order("name");

    const { data: taxRows } = await supabase
      .from("company_revenue_category_tax_settings")
      .select("category_id, tax_type, tax_value")
      .eq("company_id", currentCompany.id);

    setCompanyCategories((catRows as CompanyCategory[]) ?? []);
    setProducts((prodRows as Product[]) ?? []);
    setRecipes((recipeRows as RecipeListItem[]) ?? []);
    setProductConversions((convRows as ProductUnitConversionDraft[]) ?? []);
    setCategoryTaxSettings(
      (taxRows ?? []) as Pick<
        CompanyRevenueCategoryTaxSetting,
        "category_id" | "tax_type" | "tax_value"
      >[],
    );
    setLoading(false);

    if (error) {
      console.error(error);
      toast.error("Não foi possível carregar as receitas.");
      setRows([]);
      setTotalCount(0);
      return;
    }

    setRows((data as RevenueEntry[]) ?? []);
    setTotalCount(count ?? 0);
  }, [currentCompany, period.month, period.year, debouncedSearch, page]);

  useEffect(() => {
    queueMicrotask(() => setPage(1));
  }, [debouncedSearch, period.month, period.year]);

  useEffect(() => {
    queueMicrotask(() => void fetchData());
  }, [fetchData]);

  useEffect(() => {
    if (!sheetOpen) return;
    setCategoryLeafId("");
  }, [tipoFilter, sheetOpen, baseMode]);

  useEffect(() => {
    if (isPontual) {
      setRevenueType("operational");
    }
  }, [isPontual]);

  useEffect(() => {
    if (!categoryLeafId) {
      setTaxType("percentage");
      setTaxValue("0");
      return;
    }
    const p = taxPresetByCategory.get(categoryLeafId);
    if (p) {
      setTaxType(p.tax_type);
      setTaxValue(String(p.tax_value));
    } else {
      setTaxType("percentage");
      setTaxValue("0");
    }
  }, [categoryLeafId, taxPresetByCategory]);

  const resetForm = () => {
    const t = new Date();
    setEntryDate(t.toISOString().slice(0, 10));
    setTitle("");
    setBaseMode("manual");
    setPontualItems([createPontualSaleDraft()]);
    setRevenueType("operational");
    setCategoryLeafId("");
    setGrossInput("");
    setTaxType("percentage");
    setTaxValue("0");
  };

  const handleOpenSheet = (open: boolean) => {
    setSheetOpen(open);
    if (open) resetForm();
  };

  const canSubmit = useMemo(() => {
    if (!currentCompany?.id) return false;
    if (!entryDate) return false;
    if (!isPontual && !title.trim()) return false;
    if (baseMode === "manual" && !categoryLeafId) return false;
    if (isPontual) {
      if (!categoryLeafId) return false;
      if (pontualItemStates.length === 0) return false;
      for (const item of pontualItemStates) {
        if (!item.parsed) return false;
        if (item.effectiveGross <= 0) return false;
        if (item.isProductSale) {
          if (!item.productId || item.qtyNum <= 0 || !item.saleUnitCode) return false;
          if (toStockQty(item.productId, item.qtyNum, item.saleUnitCode) == null) {
            return false;
          }
          if (item.pricingMode === "unit" && item.unitNum < 0) return false;
          if (item.pricingMode === "total" && item.grossNumItem <= 0) return false;
          if (!item.stockOk) return false;
        }
        if (item.isRecipeSale) {
          if (!item.recipeId) return false;
          if (item.pricingMode === "unit" && item.unitNum < 0) return false;
          if (item.pricingMode === "total" && item.grossNumItem <= 0) return false;
        }
      }
      return true;
    }
    if (effectiveGross <= 0) return false;
    return true;
  }, [
    currentCompany?.id,
    entryDate,
    title,
    baseMode,
    isPontual,
    pontualItemStates,
    categoryLeafId,
    effectiveGross,
    toStockQty,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany?.id || !canSubmit || saving) return;

    const revenueLeaf = categoriesById.get(categoryLeafId);
    setSaving(true);
    if (baseMode === "manual") {
      const payload: Record<string, unknown> = {
        company_id: currentCompany.id,
        entry_date: entryDate,
        title: title.trim(),
        entry_mode: "manual",
        revenue_type: revenueType,
        category_id: revenueLeaf?.parent_id ?? null,
        subcategory_id: categoryLeafId,
        gross_amount: effectiveGross,
        product_id: null,
        recipe_id: null,
        quantity: null,
        pricing_mode: null,
        unit_value: null,
      };
      const { data, error } = await supabase.rpc("create_revenue_entry", {
        p_payload: payload,
      });
      setSaving(false);

      if (error) {
        console.error(error);
        toast.error(error.message || "Não foi possível criar a receita.");
        return;
      }
      if (!data) {
        toast.error("Resposta inválida ao criar receita.");
        return;
      }
      toast.success("Receita criada.");
    } else {
      let createdCount = 0;
      for (const item of pontualItemStates) {
        const payload: Record<string, unknown> = {
          company_id: currentCompany.id,
          entry_date: entryDate,
          title: item.title,
          entry_mode: item.isRecipeSale ? "recipe_sale" : "product_sale",
          revenue_type: "operational",
          category_id: revenueLeaf?.parent_id ?? null,
          subcategory_id: categoryLeafId,
          gross_amount: item.effectiveGross,
          product_id: item.isProductSale ? item.productId : null,
          recipe_id: item.isRecipeSale ? item.recipeId : null,
          quantity: item.isProductSale
            ? (toStockQty(item.productId, item.qtyNum, item.saleUnitCode) ??
              item.qtyNum)
            : 1,
          pricing_mode: item.pricingMode,
          unit_value: item.pricingMode === "unit" ? item.unitNum : null,
        };
        const { data, error } = await supabase.rpc("create_revenue_entry", {
          p_payload: payload,
        });
        if (error) {
          setSaving(false);
          console.error(error);
          toast.error(error.message || "Não foi possível criar a receita.");
          return;
        }
        if (!data) {
          setSaving(false);
          toast.error("Resposta inválida ao criar receita.");
          return;
        }
        createdCount += 1;
      }
      setSaving(false);
      toast.success(
        createdCount > 1
          ? `${createdCount} receitas criadas.`
          : "Receita criada.",
      );
    }
    setSheetOpen(false);
    resetForm();
    fetchData();
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

  const displayTax = isPontual ? summaryTaxNet.taxAmount : taxAmount;
  const displayNet = isPontual ? summaryTaxNet.netAmount : netAmount;

  return (
    <PageShell className="space-y-8 pb-0" narrow>
      <PageHeader
        title="Receitas"
        description="Receitas manuais e vendas de produto: a taxa sobre o bruto vem de Configurações › Impostos na receita (por categoria). O CMV segue o grupo cadastrado no produto."
        icon={CircleDollarSign}
        action={
          <Button
            type="button"
            onClick={() => handleOpenSheet(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nova receita
          </Button>
        }
      />

      <ReferencePeriodCard
        value={period}
        onChange={setPeriod}
        description="Lista filtrada pela data da receita (competência)"
      />

      <Sheet open={sheetOpen} onOpenChange={handleOpenSheet}>
        <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
                <CircleDollarSign className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1 space-y-1 pr-6">
                <SheetTitle className="text-xl font-semibold sm:text-2xl">
                  Nova receita
                </SheetTitle>
                <SheetDescription>
                  Lançamento por período ou venda pontual com estoque, impostos e
                  DRE.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
              <div className="space-y-4 p-6">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-4">
              <div>
              <Label>Modo de lançamento</Label>
              <Select
                value={baseMode}
                onValueChange={(v) => {
                  const m = v as LaunchMode;
                  setBaseMode(m);
                  if (m === "manual") setPontualItems([createPontualSaleDraft()]);
                  if (m === "pontual" && pontualItems.length === 0) {
                    setPontualItems([createPontualSaleDraft()]);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Lançamento por período</SelectItem>
                  <SelectItem value="pontual">Venda pontual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {baseMode === "manual" && (
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
                    <SelectItem value="operational">Operacional</SelectItem>
                    <SelectItem value="non_operational">
                      Não operacional
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
            </div>

            {baseMode === "manual" && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-4">
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
                  <Select
                    value={categoryLeafId || "__none__"}
                    onValueChange={(v) =>
                      setCategoryLeafId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Selecione</SelectItem>
                      {leafCategoryOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {categoryPathLabel(c.id, categoriesById)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {leafCategoryOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Cadastre categorias de receita em Configurações ›
                      Categorias.
                    </p>
                  )}
                </div>
              </div>
            )}

            {isPontual && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-4">
                <div>
                  <Label>Categoria da venda *</Label>
                  <Select
                    value={categoryLeafId || "__none__"}
                    onValueChange={(v) =>
                      setCategoryLeafId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a categoria da receita" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Selecione</SelectItem>
                      {leafCategoryOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {categoryPathLabel(c.id, categoriesById)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {leafCategoryOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Cadastre categorias de receita operacional em Configurações ›
                      Categorias.
                    </p>
                  )}
                </div>

                {pontualItemStates.map((item, index) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Label>Produto ou receita (ficha) #{index + 1}</Label>
                      {pontualItems.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setPontualItems((prev) =>
                              prev.filter((x) => x.id !== item.id),
                            )
                          }
                        >
                          Remover
                        </Button>
                      ) : null}
                    </div>
                    <PontualProductRecipePicker
                      products={products}
                      recipes={recipes}
                      value={item.ref}
                      onChange={(ref) => {
                        const parsedRef = parsePontualRef(ref);
                        const defaultUnit =
                          parsedRef?.kind === "product"
                            ? (productById.get(parsedRef.id)?.unit ?? "")
                            : "";
                        setPontualItems((prev) =>
                          prev.map((x) =>
                            x.id === item.id
                              ? {
                                  ...x,
                                  ref,
                                  quantity: "1",
                                  saleUnitCode: defaultUnit,
                                }
                              : x,
                          ),
                        );
                      }}
                    />

                    {item.isRecipeSale && (
                      <p className="text-sm rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-muted-foreground">
                        <span className="font-medium text-foreground">1 porção</span>{" "}
                        neste lançamento. Os ingredientes são baixados conforme as
                        quantidades da ficha
                        {item.selectedRecipe?.batch_yield != null
                          ? ` (rendimento ${item.selectedRecipe.batch_yield}).`
                          : "."}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      {item.isProductSale ? (
                        <>
                          <div>
                            <Label>Quantidade</Label>
                            <Input
                              type="number"
                              step={item.quantityFieldProps.step}
                              min={item.quantityFieldProps.min}
                              value={item.quantity}
                              onChange={(e) =>
                                setPontualItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id
                                      ? { ...x, quantity: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              onBlur={() => {
                                if (!item.quantityFieldProps.integerOnly) return;
                                const n = Math.max(
                                  1,
                                  Math.round(parseFloat(item.quantity) || 0),
                                );
                                setPontualItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id
                                      ? { ...x, quantity: String(n) }
                                      : x,
                                  ),
                                );
                              }}
                            />
                          </div>
                          <div>
                            <Label>Unidade</Label>
                            <Select
                              value={item.saleUnitCode || "__none__"}
                              onValueChange={(v) =>
                                setPontualItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id
                                      ? {
                                          ...x,
                                          saleUnitCode: v === "__none__" ? "" : v,
                                        }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Unidade" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Selecione</SelectItem>
                                {item.productId
                                  ? allowedUnitsForProduct(item.productId).map((u) => (
                                      <SelectItem
                                        key={`${item.productId}-${u}`}
                                        value={u}
                                      >
                                        {u}
                                      </SelectItem>
                                    ))
                                  : null}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : item.isRecipeSale ? (
                        <div className="col-span-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2 sm:col-span-1">
                          <p className="text-xs text-muted-foreground">Quantidade</p>
                          <p className="text-sm font-medium text-foreground">
                            1 porção
                          </p>
                        </div>
                      ) : null}
                      <div className={item.isRecipeSale ? "col-span-2 sm:col-span-1" : undefined}>
                        <Label>Preço</Label>
                        <Select
                          value={item.pricingMode}
                          onValueChange={(v) =>
                            setPontualItems((prev) =>
                              prev.map((x) =>
                                x.id === item.id
                                  ? { ...x, pricingMode: v as "unit" | "total" }
                                  : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unit">
                              {item.isRecipeSale ? "Valor por porção" : "Valor unitário"}
                            </SelectItem>
                            <SelectItem value="total">Valor total</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {item.pricingMode === "unit" ? (
                      <div>
                        <Label>
                          {item.isRecipeSale
                            ? "Valor por porção (R$)"
                            : "Valor unitário (R$)"}
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitValue}
                          onChange={(e) =>
                            setPontualItems((prev) =>
                              prev.map((x) =>
                                x.id === item.id
                                  ? { ...x, unitValue: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          placeholder="0,00"
                        />
                      </div>
                    ) : (
                      <div>
                        <Label>Valor total da venda (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.grossInput}
                          onChange={(e) =>
                            setPontualItems((prev) =>
                              prev.map((x) =>
                                x.id === item.id
                                  ? { ...x, grossInput: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          placeholder="0,00"
                        />
                      </div>
                    )}

                    {item.selectedProduct && !item.stockOk && (
                      <div
                        role="alert"
                        className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                      >
                        Estoque insuficiente. Disponível:{" "}
                        {Number(item.selectedProduct.current_quantity).toLocaleString(
                          "pt-BR",
                          { maximumFractionDigits: 4 },
                        )}{" "}
                        {item.selectedProduct.unit}.
                      </div>
                    )}
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setPontualItems((prev) => [...prev, createPontualSaleDraft()])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar produto ou receita
                </Button>
              </div>
            )}

            {baseMode === "manual" && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <Label>Valor bruto (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={grossInput}
                  onChange={(e) => setGrossInput(e.target.value)}
                  placeholder="0,00"
                  required
                />
              </div>
            )}

            <div className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm space-y-2">
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
                  Selecione a categoria de receita para exibir a taxa aplicável.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm space-y-1.5">
              <p className="font-medium text-foreground">Resumo financeiro</p>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Valor bruto</span>
                <span>{formatCurrency(effectiveGross)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{taxSummaryLabel}</span>
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
              </div>
            </div>
            <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => handleOpenSheet(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={!canSubmit || saving}
              >
                {saving ? "Salvando..." : "Criar receita"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Receitas no período
            </CardTitle>
            <CardDescription>
              Data da receita, classificação, valores e origem do lançamento
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Filtrar por título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhuma receita neste período.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const catLabel = categoryPathLabel(
                  r.subcategory_id,
                  categoriesById,
                );
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailRevenueId(r.id)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setDetailRevenueId(r.id)
                    }
                    className="flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/50 cursor-pointer sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium truncate">{r.title}</p>
                      {r.entry_mode === "product_sale" && r.product_id ? (
                        <p className="text-xs text-muted-foreground truncate">
                          Produto:{" "}
                          {productNameById.get(r.product_id) ?? r.product_id}
                        </p>
                      ) : null}
                      {r.entry_mode === "recipe_sale" && r.recipe_id ? (
                        <p className="text-xs text-muted-foreground truncate">
                          Receita (ficha):{" "}
                          {recipeNameById.get(r.recipe_id) ?? r.recipe_id}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{formatDate(r.entry_date)}</span>
                        <span>
                          {REVENUE_TYPE_LABEL[r.revenue_type] ?? r.revenue_type}
                        </span>
                        <span className="truncate max-w-[220px]">{catLabel}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Badge variant="secondary">
                          {ENTRY_MODE_LABEL[r.entry_mode] ?? r.entry_mode}
                        </Badge>
                        {categoriesById.get(r.subcategory_id) ? (
                          <Badge variant="outline">
                            {tipoBadge(categoriesById.get(r.subcategory_id)!)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm space-y-0.5 sm:pl-4">
                      <p>
                        <span className="text-muted-foreground">Bruto: </span>
                        {formatCurrency(Number(r.gross_amount))}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Taxa: </span>
                        {formatCurrency(Number(r.tax_amount))}
                      </p>
                      <p className="font-medium">
                        Líquido: {formatCurrency(Number(r.net_amount))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && (
            <Pagination
              page={page}
              totalCount={totalCount}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>

      <RevenueDetailSheet
        revenueEntryId={detailRevenueId}
        onClose={() => setDetailRevenueId(null)}
        onRefresh={fetchData}
      />
    </PageShell>
  );
}

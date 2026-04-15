import { CreateProductSheet } from "@/components/CreateProductSheet";
import { ProductUnitConversionsSection } from "@/components/products/ProductUnitConversionsSection";
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SECTION,
  PRODUCT_SHEET_SELECT,
  PRODUCT_SHEET_TILE,
} from "@/components/products/productSheetStyles";
import { ProductCategoryTagsField } from "@/components/products/ProductCategoryTagsField";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { EstoqueCmvPanel } from "@/components/estoque/EstoqueCmvPanel";
import { EstoqueComprasPanel } from "@/components/estoque/EstoqueComprasPanel";
import { EstoqueContagemPanel } from "@/components/estoque/EstoqueContagemPanel";
import { EstoqueEtiquetasPanel } from "@/components/estoque/EstoqueEtiquetasPanel";
import { EstoqueMovimentacoesPanel } from "@/components/estoque/EstoqueMovimentacoesPanel";
import { EstoquePerdasPanel } from "@/components/estoque/EstoquePerdasPanel";
import { EstoqueReceitasPanel } from "@/components/estoque/EstoqueReceitasPanel";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { ProductImportSheet } from "@/components/ProductImportSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import {
  getLockedSystemSecondaryQty,
  convertUnitPriceForProduct,
  convertQuantityForProduct,
  rebaseProductConversionsToHub,
} from "@/lib/companyUnits/convert";
import { getSystemProductUnitSelectOptionsWithLegacy } from "@/lib/companyUnits/productUnitOptions";
import { runStockExportDownload } from "@/lib/exportProductStockExcel";
import { updatedAtFilterBounds } from "@/lib/productCatalogFilters";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Loader2,
  Coins,
  Download,
  FileSpreadsheet,
  LayoutGrid,
  Package,
  Pencil,
  Plus,
  PowerOff,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

/** Estilos rotativos para tags de categoria de catálogo / CMV. */
const CMV_CATEGORY_TAG_STYLES = [
  "border-sky-300/70 bg-sky-500/10 text-sky-950 dark:border-sky-600/50 dark:bg-sky-500/[0.14] dark:text-sky-50",
  "border-violet-300/70 bg-violet-500/10 text-violet-950 dark:border-violet-600/50 dark:bg-violet-500/[0.14] dark:text-violet-50",
  "border-emerald-300/70 bg-emerald-500/10 text-emerald-950 dark:border-emerald-600/50 dark:bg-emerald-500/[0.14] dark:text-emerald-50",
  "border-amber-300/80 bg-amber-500/12 text-amber-950 dark:border-amber-600/50 dark:bg-amber-500/[0.15] dark:text-amber-50",
  "border-rose-300/70 bg-rose-500/10 text-rose-950 dark:border-rose-600/50 dark:bg-rose-500/[0.14] dark:text-rose-50",
  "border-cyan-300/70 bg-cyan-500/10 text-cyan-950 dark:border-cyan-600/50 dark:bg-cyan-500/[0.14] dark:text-cyan-50",
] as const;

function cmvCategoryTagClass(index: number) {
  return CMV_CATEGORY_TAG_STYLES[index % CMV_CATEGORY_TAG_STYLES.length];
}

function productComposesCmv(p: Pick<Product, "composes_cmv">): boolean {
  return p.composes_cmv !== false;
}

/** Médio e último a partir do cadastro do produto (compras atualizam ambos via estoque). */
function productPriceFields(p: Product | null): {
  average: number | null;
  last: number | null;
  lastUnitCode: string | null;
  lineUnit: number | null;
} {
  if (!p) {
    return { average: null, last: null, lastUnitCode: null, lineUnit: null };
  }
  const average =
    p.average_cost != null && p.average_cost > 0
      ? Number(p.average_cost)
      : null;
  const last =
    p.last_unit_value != null && p.last_unit_value > 0
      ? Number(p.last_unit_value)
      : null;
  const lastStock =
    p.last_unit_value_stock != null && p.last_unit_value_stock > 0
      ? Number(p.last_unit_value_stock)
      : last;
  const lineUnit = average ?? lastStock ?? null;
  return {
    average,
    last,
    lastUnitCode: p.last_unit_value_unit_code ?? p.unit ?? null,
    lineUnit,
  };
}

const SHEET_SECTION = PRODUCT_SHEET_SECTION;
const SHEET_TILE = PRODUCT_SHEET_TILE;
const SHEET_INPUT = PRODUCT_SHEET_INPUT;
const SHEET_SELECT = PRODUCT_SHEET_SELECT;

function sameCategorySelection(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((id) => sb.has(id));
}

function sameProductConversions(
  a: ProductUnitConversionDraft[],
  b: ProductUnitConversionDraft[],
) {
  if (a.length !== b.length) return false;
  const norm = (rows: ProductUnitConversionDraft[]) =>
    [...rows]
      .map((r) => ({
        primary_qty: Number(r.primary_qty),
        primary_unit_code: r.primary_unit_code,
        secondary_qty: Number(r.secondary_qty),
        secondary_unit_code: r.secondary_unit_code,
      }))
      .sort((p, q) =>
        p.secondary_unit_code.localeCompare(q.secondary_unit_code),
      );
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

type StockMovementRow = {
  id: string;
  quantity: number;
  type: string;
  reference_type: string | null;
  created_at: string;
  unit_cost: number | null;
};

const STOCK_REF_LABEL: Record<string, string> = {
  inventory_count: "Contagem",
  expense: "Despesa",
  expense_item: "Despesa",
  recebimento: "Recebimento",
  recipe: "Receita",
  revenue_entry: "Venda",
  waste: "Perda",
  adjustment: "Ajuste",
  purchase_order: "Compra",
};

function stockRefLabel(type: string | null): string {
  if (!type) return "—";
  return STOCK_REF_LABEL[type] ?? type;
}

async function fetchProductCatalogMap(
  companyId: string,
  productIds: string[],
): Promise<Record<string, { id: string; name: string }[]>> {
  const out: Record<string, { id: string; name: string }[]> = {};
  if (productIds.length === 0) return out;
  const { data: links, error } = await supabase
    .from("product_category_assignments")
    .select("product_id, category_id")
    .in("product_id", productIds);
  if (error || !links?.length) return out;
  const catIds = [...new Set(links.map((l) => l.category_id))];
  const { data: cats } = await supabase
    .from("company_product_categories")
    .select("id, name")
    .eq("company_id", companyId)
    .in("id", catIds);
  const catById = new Map((cats ?? []).map((c) => [c.id, c]));
  for (const row of links) {
    const c = catById.get(row.category_id);
    if (!c) continue;
    const list = out[row.product_id] ?? [];
    list.push({ id: c.id, name: c.name });
    out[row.product_id] = list;
  }
  return out;
}

/** Quantidades em unidade de estoque somadas nos pedidos draft/ordered. */
async function loadPendingPurchaseQuantities(
  companyId: string,
): Promise<Record<string, number>> {
  const { data: orders, error: oErr } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("company_id", companyId)
    .in("status", ["draft", "ordered"]);
  if (oErr) {
    console.error(oErr);
    return {};
  }
  const orderIds = (orders ?? []).map((o) => o.id as string);
  if (orderIds.length === 0) return {};
  const { data: items, error: iErr } = await supabase
    .from("purchase_order_items")
    .select("product_id, quantity")
    .in("order_id", orderIds);
  if (iErr) {
    console.error(iErr);
    return {};
  }
  const acc: Record<string, number> = {};
  for (const row of items ?? []) {
    const pid = row.product_id as string;
    acc[pid] = (acc[pid] ?? 0) + Number(row.quantity);
  }
  return acc;
}

export function Produtos() {
  const roundUnitPrice = (value: number) =>
    Math.round((value + Number.EPSILON) * 1e8) / 1e8;
  const formatCurrencyInput = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    const cents = Number(digits) / 100;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents);
  };
  const parseCurrencyInput = (raw: string): number | null => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    return Number(digits) / 100;
  };

  const { currentCompany } = useCompany();
  const [searchParams] = useSearchParams();
  const lowStockOnly = searchParams.get("estoque") === "baixo";

  const [products, setProducts] = useState<Product[]>([]);
  const [productsCount, setProductsCount] = useState(0);
  const [productsPage, setProductsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterActive, setFilterActive] = useState<
    "all" | "active" | "inactive"
  >("active");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("all");
  const [filterStockAlert, setFilterStockAlert] = useState<
    "all" | "zero" | "below_min" | "any"
  >("all");
  const [filterComposesCmv, setFilterComposesCmv] = useState<
    "all" | "yes" | "no"
  >("all");
  const [filterUpdatedPreset, setFilterUpdatedPreset] = useState<
    "all" | "today" | "7d" | "30d" | "custom"
  >("all");
  const [filterUpdatedFrom, setFilterUpdatedFrom] = useState("");
  const [filterUpdatedTo, setFilterUpdatedTo] = useState("");
  const [stockExportLoading, setStockExportLoading] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  /** Resumo ao abrir; edição após "Editar". */
  const [productSheetView, setProductSheetView] = useState<"summary" | "edit">(
    "summary",
  );
  const [stockName, setStockName] = useState("");
  const [stockSku, setStockSku] = useState("");
  const [stockUnit, setStockUnit] = useState("un");
  const [stockBarcode, setStockBarcode] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockMinQuantity, setStockMinQuantity] = useState("");
  const [stockLastUnitValue, setStockLastUnitValue] = useState("");
  const [stockLastUnitValueUnitCode, setStockLastUnitValueUnitCode] = useState("un");
  const [stockIsActive, setStockIsActive] = useState(true);
  const [stockComposesCmv, setStockComposesCmv] = useState(true);
  const [companyProductCategories, setCompanyProductCategories] = useState<
    CompanyProductCategory[]
  >([]);
  const [stockProductCategoryIds, setStockProductCategoryIds] = useState<
    string[]
  >([]);
  const [initialStockProductCategoryIds, setInitialStockProductCategoryIds] =
    useState<string[]>([]);
  /** Última seleção de categorias (evita estado defasado no Salvar). */
  const stockProductCategoryIdsRef = useRef<string[]>([]);
  /** Invalida loads assíncronos ao trocar/fechar produto. */
  const assignmentLoadGenRef = useRef(0);
  /** Evita recarregar conversões ao voltar do resumo para edição sem salvar. */
  const productConversionsLoadedIdRef = useRef<string | null>(null);
  const productSheetViewRef = useRef<"summary" | "edit">("summary");
  /** Nomes das categorias de catálogo por produto (listagem). */
  const [productCatalogMap, setProductCatalogMap] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  const [pendingPurchaseByProduct, setPendingPurchaseByProduct] = useState<
    Record<string, number>
  >({});
  const [stockSaving, setStockSaving] = useState(false);
  const [stockProductConversions, setStockProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [stockMovementRows, setStockMovementRows] = useState<StockMovementRow[]>(
    [],
  );
  const [stockMovementLoading, setStockMovementLoading] = useState(false);
  const [initialStockProductConversions, setInitialStockProductConversions] =
    useState<ProductUnitConversionDraft[]>([]);
  type EstoqueTab =
    | "catalogo"
    | "movimentos"
    | "cmv"
    | "contagem"
    | "compras"
    | "etiquetas"
    | "perdas"
    | "receitas";

  const [estoqueTab, setEstoqueTab] = useState<EstoqueTab>("catalogo");

  const unitSelectOptions = useMemo(
    () => getSystemProductUnitSelectOptionsWithLegacy(stockUnit),
    [stockUnit],
  );
  const lastUnitValueUnitOptions = useMemo(() => {
    const allowed = new Set<string>([stockUnit]);
    for (const r of stockProductConversions) {
      if (
        r.primary_unit_code.trim().toLowerCase() === stockUnit.trim().toLowerCase()
      ) {
        allowed.add(r.secondary_unit_code);
      }
    }
    for (const candidate of ["mg", "g", "kg", "ml", "l"]) {
      if (candidate.toLowerCase() === stockUnit.trim().toLowerCase()) continue;
      if (getLockedSystemSecondaryQty(1, stockUnit, candidate) != null) {
        allowed.add(candidate);
      }
    }
    const base = getSystemProductUnitSelectOptionsWithLegacy(
      stockLastUnitValueUnitCode,
    );
    return base.filter((o) => allowed.has(o.value));
  }, [stockLastUnitValueUnitCode, stockProductConversions, stockUnit]);

  const handleStockUnitChange = (next: string) => {
    const prev = stockUnit;
    if (prev === next) return;
    const q = parseFloat(stockQuantity.replace(/\s/g, "").replace(",", "."));
    const m = parseFloat(stockMinQuantity.replace(/\s/g, "").replace(",", "."));
    const qOk = Number.isFinite(q);
    const mOk = Number.isFinite(m);
    const convRows = stockProductConversions.map((r) => ({
      primary_unit_code: r.primary_unit_code,
      secondary_unit_code: r.secondary_unit_code,
      primary_qty: Number(r.primary_qty),
      secondary_qty: Number(r.secondary_qty),
    }));
    const cq = qOk
      ? convertQuantityForProduct(q, prev, next, prev, convRows)
      : null;
    const cm = mOk
      ? convertQuantityForProduct(m, prev, next, prev, convRows)
      : null;
    const rebasedConversions = rebaseProductConversionsToHub(
      convRows,
      prev,
      next,
    );
    setStockUnit(next);
    setStockProductConversions(
      rebasedConversions.map((r) => ({
        ...r,
        company_id: currentCompany?.id ?? "",
      })),
    );
    if (cq != null) {
      setStockQuantity(String(cq));
    } else if (qOk) {
      toast.message(
        "Sem conversão entre essas unidades; ajuste o estoque manualmente se necessário.",
      );
    }
    if (cm != null) {
      setStockMinQuantity(String(cm));
    }
    if (stockProductConversions.length > 0 && rebasedConversions.length === 0) {
      toast.message(
        "Não foi possível reaproveitar as conversões com a nova unidade.",
      );
    }
  };

  const loadCompanyProductCategories = useCallback(async () => {
    if (!currentCompany?.id) return;
    const { data, error } = await supabase
      .from("company_product_categories")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      setCompanyProductCategories([]);
      return;
    }
    setCompanyProductCategories((data ?? []) as CompanyProductCategory[]);
  }, [currentCompany?.id]);

  useEffect(() => {
    if (!currentCompany?.id) return;
    void loadCompanyProductCategories();
  }, [currentCompany?.id, loadCompanyProductCategories]);

  useEffect(() => {
    if (!currentCompany?.id) return;
    if (estoqueTab !== "catalogo") return;
    void loadPendingPurchaseQuantities(currentCompany.id).then(
      setPendingPurchaseByProduct,
    );
  }, [currentCompany?.id, estoqueTab]);

  const loadAssignmentsForProduct = useCallback(async (productId: string) => {
    const { data } = await supabase
      .from("product_category_assignments")
      .select("category_id")
      .eq("product_id", productId);
    return (data ?? []).map((r) => r.category_id);
  }, []);

  useEffect(() => {
    stockProductCategoryIdsRef.current = stockProductCategoryIds;
  }, [stockProductCategoryIds]);

  useEffect(() => {
    productSheetViewRef.current = productSheetView;
  }, [productSheetView]);

  const fetchProducts = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    try {
      let categoryProductIds: string[] | null = null;
      if (filterCategoryId !== "all") {
        const { data: links, error: linkErr } = await supabase
          .from("product_category_assignments")
          .select("product_id")
          .eq("category_id", filterCategoryId);
        if (linkErr) console.error(linkErr);
        categoryProductIds = [
          ...new Set((links ?? []).map((l) => l.product_id)),
        ];
        if (categoryProductIds.length === 0) {
          setProducts([]);
          setProductsCount(0);
          setProductCatalogMap({});
          setPendingPurchaseByProduct({});
          return;
        }
      }

      const bounds = updatedAtFilterBounds(
        filterUpdatedPreset,
        filterUpdatedFrom,
        filterUpdatedTo,
      );

      const buildBase = () => {
        let q = supabase
          .from("products")
          .select("*", { count: "exact" })
          .eq("company_id", currentCompany.id)
          .order("name");
        if (categoryProductIds) {
          q = q.in("id", categoryProductIds);
        }
        if (debouncedSearch.trim()) {
          const term = `%${debouncedSearch.trim()}%`;
          q = q.or(`name.ilike.${term},sku.ilike.${term}`);
        }
        if (filterActive === "active") {
          q = q.or("is_active.is.null,is_active.eq.true");
        } else if (filterActive === "inactive") {
          q = q.eq("is_active", false);
        }
        if (filterComposesCmv === "yes") {
          q = q.or("composes_cmv.is.null,composes_cmv.eq.true");
        } else if (filterComposesCmv === "no") {
          q = q.eq("composes_cmv", false);
        }
        if (bounds?.gte) {
          q = q.gte("updated_at", bounds.gte);
        }
        if (bounds?.lte) {
          q = q.lte("updated_at", bounds.lte);
        }

        if (lowStockOnly) {
          q = q.eq("stock_below_min_inclusive", true);
        } else if (filterStockAlert === "zero") {
          q = q.eq("stock_is_zero", true);
        } else if (filterStockAlert === "below_min") {
          q = q.eq("stock_below_min_positive", true);
        } else if (filterStockAlert === "any") {
          q = q.eq("stock_has_alert", true);
        }

        return q;
      };

      const { data, count, error } = await buildBase().range(
        (productsPage - 1) * PAGE_SIZE,
        productsPage * PAGE_SIZE - 1,
      );
      if (error) console.error(error);
      const rows = (data ?? []) as Product[];
      setProducts(rows);
      setProductsCount(count ?? 0);
      const [catalogMap, pendingMap] = await Promise.all([
        fetchProductCatalogMap(
          currentCompany.id,
          rows.map((p) => p.id),
        ),
        loadPendingPurchaseQuantities(currentCompany.id),
      ]);
      setProductCatalogMap(catalogMap);
      setPendingPurchaseByProduct(pendingMap);
    } finally {
      setLoading(false);
    }
  }, [
    currentCompany,
    debouncedSearch,
    filterActive,
    filterCategoryId,
    filterStockAlert,
    filterComposesCmv,
    filterUpdatedPreset,
    filterUpdatedFrom,
    filterUpdatedTo,
    productsPage,
    lowStockOnly,
  ]);

  const fetchLowStockCount = useCallback(async () => {
    if (!currentCompany?.id) return;
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", currentCompany.id)
      .eq("stock_below_min_inclusive", true)
      .or("is_active.is.null,is_active.eq.true");
    if (error) {
      console.error(error);
      setLowStockCount(0);
      return;
    }
    setLowStockCount(count ?? 0);
  }, [currentCompany]);

  const handleStockExport = useCallback(
    async (mode: "filtered" | "all") => {
      if (!currentCompany?.id) return;
      setStockExportLoading(true);
      try {
        const n = await runStockExportDownload(
          currentCompany.id,
          (currentCompany.name ?? "empresa").replace(/\s+/g, "_"),
          {
            search: debouncedSearch,
            filterCategoryId,
            filterActive,
            filterComposesCmv,
            filterUpdatedPreset,
            filterUpdatedFrom,
            filterUpdatedTo,
            filterStockAlert,
            lowStockOnly,
          },
          mode,
        );
        if (n === 0) {
          toast.message("Nenhum produto encontrado para exportar.");
        } else {
          toast.success(
            n === 1
              ? "Planilha exportada (1 produto)."
              : `Planilha exportada (${n} produtos).`,
          );
        }
      } catch (e) {
        console.error(e);
        toast.error("Não foi possível exportar o estoque.");
      } finally {
        setStockExportLoading(false);
      }
    },
    [
      currentCompany,
      debouncedSearch,
      filterCategoryId,
      filterActive,
      filterComposesCmv,
      filterUpdatedPreset,
      filterUpdatedFrom,
      filterUpdatedTo,
      filterStockAlert,
      lowStockOnly,
    ],
  );

  useEffect(() => {
    queueMicrotask(() => setProductsPage(1));
  }, [
    debouncedSearch,
    filterActive,
    lowStockOnly,
    filterCategoryId,
    filterStockAlert,
    filterComposesCmv,
    filterUpdatedPreset,
    filterUpdatedFrom,
    filterUpdatedTo,
  ]);

  useEffect(() => {
    if (searchParams.get("estoque") === "baixo") {
      setEstoqueTab("catalogo");
    }
  }, [searchParams]);

  useEffect(() => {
    queueMicrotask(() => void fetchProducts());
  }, [fetchProducts]);

  useEffect(() => {
    queueMicrotask(() => void fetchLowStockCount());
  }, [fetchLowStockCount]);

  useEffect(() => {
    if (
      !stockProduct?.id ||
      productSheetView !== "edit" ||
      !currentCompany?.id
    ) {
      return;
    }
    if (productConversionsLoadedIdRef.current === stockProduct.id) {
      return;
    }
    const loadPid = stockProduct.id;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("product_unit_conversions")
        .select("*")
        .eq("product_id", loadPid);
      if (cancelled) return;
      if (error) {
        console.error(error);
        setStockProductConversions([]);
        setInitialStockProductConversions([]);
        return;
      }
      const rows = (data ?? []) as ProductUnitConversionDraft[];
      setStockProductConversions(rows);
      setInitialStockProductConversions(rows);
      productConversionsLoadedIdRef.current = loadPid;
    })();
    return () => {
      cancelled = true;
    };
  }, [stockProduct?.id, productSheetView, currentCompany?.id]);

  useEffect(() => {
    const productId = stockProduct?.id;
    if (!productId) {
      setStockMovementRows([]);
      setStockMovementLoading(false);
      return;
    }
    let cancelled = false;
    setStockMovementLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, quantity, type, reference_type, created_at, unit_cost")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      setStockMovementLoading(false);
      if (error) {
        console.error(error);
        setStockMovementRows([]);
        return;
      }
      setStockMovementRows((data ?? []) as StockMovementRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [stockProduct?.id]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  /** CMV se houver; senão último preço — alinhado ao painel CMV e ao valor em estoque. */
  const unitCostParts = (p: Product) => {
    const cmv =
      p.average_cost != null && p.average_cost > 0
        ? Number(p.average_cost)
        : null;
    const last =
      p.last_unit_value != null && p.last_unit_value > 0
        ? Number(p.last_unit_value)
        : null;
    const lastStock =
      p.last_unit_value_stock != null && p.last_unit_value_stock > 0
        ? Number(p.last_unit_value_stock)
        : last;
    const unit = cmv ?? lastStock ?? null;
    return { cmv, last, unit, lastUnitCode: p.last_unit_value_unit_code ?? p.unit };
  };

  const stockPricePresentation = useMemo(
    () => productPriceFields(stockProduct),
    [stockProduct],
  );

  const stockSummaryLineValue = useMemo(() => {
    const u = stockPricePresentation.lineUnit;
    if (!stockProduct || u == null) return null;
    return Number(stockProduct.current_quantity) * u;
  }, [stockProduct, stockPricePresentation.lineUnit]);

  const syncStockFormFromProduct = useCallback((p: Product) => {
    setStockName(p.name);
    setStockSku(p.sku ?? "");
    setStockUnit(p.unit || "un");
    setStockBarcode(p.barcode ?? "");
    setStockQuantity(String(p.current_quantity));
    setStockMinQuantity(String(p.min_quantity ?? 0));
    setStockLastUnitValue(
      p.last_unit_value != null && !Number.isNaN(Number(p.last_unit_value))
        ? new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(Number(p.last_unit_value))
        : "",
    );
    setStockLastUnitValueUnitCode(
      p.last_unit_value_unit_code?.trim() || p.unit || "un",
    );
    setStockIsActive(p.is_active !== false);
    setStockComposesCmv(productComposesCmv(p));
  }, []);

  const openStockSheet = (p: Product) => {
    const gen = ++assignmentLoadGenRef.current;
    productSheetViewRef.current = "summary";
    setStockProduct(p);
    syncStockFormFromProduct(p);
    setProductSheetView("summary");
    setStockProductCategoryIds([]);
    setInitialStockProductCategoryIds([]);
    stockProductCategoryIdsRef.current = [];
    void (async () => {
      const ids = await loadAssignmentsForProduct(p.id);
      if (assignmentLoadGenRef.current !== gen) return;
      setInitialStockProductCategoryIds(ids);
      if (productSheetViewRef.current === "summary") {
        setStockProductCategoryIds(ids);
        stockProductCategoryIdsRef.current = ids;
        return;
      }
      if (stockProductCategoryIdsRef.current.length === 0) {
        setStockProductCategoryIds(ids);
        stockProductCategoryIdsRef.current = ids;
      }
    })();
  };

  const closeStockSheet = () => {
    assignmentLoadGenRef.current += 1;
    productSheetViewRef.current = "summary";
    productConversionsLoadedIdRef.current = null;
    setStockProduct(null);
    setProductSheetView("summary");
    setStockProductCategoryIds([]);
    setInitialStockProductCategoryIds([]);
    stockProductCategoryIdsRef.current = [];
    setStockProductConversions([]);
    setInitialStockProductConversions([]);
    setStockMovementRows([]);
    setStockMovementLoading(false);
  };

  const handleStockSave = async () => {
    if (!stockProduct) return;
    const newName = stockName.trim();
    if (!newName) return;
    const newQty = parseFloat(stockQuantity);
    if (Number.isNaN(newQty) || newQty < 0) return;
    const newMinQty = parseFloat(stockMinQuantity);
    if (Number.isNaN(newMinQty) || newMinQty < 0) return;
    const currentQty = Number(stockProduct.current_quantity);
    const currentMinQty = Number(stockProduct.min_quantity ?? 0);
    const currentActive = stockProduct.is_active !== false;
    const delta = newQty - currentQty;
    const nameChanged = newName !== (stockProduct.name ?? "").trim();
    const minChanged = newMinQty !== currentMinQty;
    const activeChanged = stockIsActive !== currentActive;
    const qtyChanged = delta !== 0;
    const skuChanged =
      (stockSku.trim() || null) !== (stockProduct.sku?.trim() || null);
    const unitChanged = stockUnit !== (stockProduct.unit || "un");
    const barcodeChanged =
      (stockBarcode.trim() || null) !== (stockProduct.barcode?.trim() || null);
    const composesCmvChanged =
      productComposesCmv(stockProduct) !== stockComposesCmv;

    const parsedLast = parseCurrencyInput(stockLastUnitValue);
    const resolvedLastUnit =
      parsedLast != null && !Number.isNaN(parsedLast) && parsedLast >= 0
        ? parsedLast
        : null;
    const currentLastUnit =
      stockProduct.last_unit_value != null &&
      !Number.isNaN(Number(stockProduct.last_unit_value))
        ? Number(stockProduct.last_unit_value)
        : null;
    const lastUnitValueChanged =
      resolvedLastUnit === null && currentLastUnit === null
        ? false
        : resolvedLastUnit === null || currentLastUnit === null
          ? true
          : Math.abs(resolvedLastUnit - currentLastUnit) > 1e-6;
    const currentLastUnitCode =
      stockProduct.last_unit_value_unit_code?.trim() || stockProduct.unit || "un";
    const lastUnitValueUnitChanged =
      (stockLastUnitValueUnitCode || stockUnit) !== currentLastUnitCode;

    const categoryIdsSnapshot = stockProductCategoryIdsRef.current;
    const categoriesChanged = !sameCategorySelection(
      categoryIdsSnapshot,
      initialStockProductCategoryIds,
    );
    const conversionsChanged = !sameProductConversions(
      stockProductConversions,
      initialStockProductConversions,
    );

    if (
      !qtyChanged &&
      !minChanged &&
      !activeChanged &&
      !nameChanged &&
      !skuChanged &&
      !unitChanged &&
      !barcodeChanged &&
      !composesCmvChanged &&
      !lastUnitValueChanged &&
      !lastUnitValueUnitChanged &&
      !categoriesChanged &&
      !conversionsChanged
    ) {
      closeStockSheet();
      return;
    }
    setStockSaving(true);
    if (!unitChanged && qtyChanged) {
      const { error } = await supabase.rpc("adjust_product_stock", {
        p_product_id: stockProduct.id,
        p_delta: delta,
        p_type: delta > 0 ? "in" : "out",
        p_reference_type: "adjustment",
        p_reference_id: null,
      });
      if (error) {
        console.error(error);
        setStockSaving(false);
        return;
      }
    }
    const updates: {
      name?: string;
      min_quantity?: number;
      current_quantity?: number;
      is_active?: boolean;
      sku?: string | null;
      unit?: string;
      barcode?: string | null;
      composes_cmv?: boolean;
      last_unit_value?: number | null;
      last_unit_value_unit_code?: string | null;
      last_unit_value_stock?: number | null;
      average_cost?: number | null;
    } = {};
    if (nameChanged) updates.name = newName;
    if (unitChanged) {
      updates.unit = stockUnit;
      updates.current_quantity = newQty;
      updates.min_quantity = newMinQty;
    } else if (minChanged) {
      updates.min_quantity = newMinQty;
    }
    if (activeChanged) updates.is_active = stockIsActive;
    if (skuChanged) updates.sku = stockSku.trim() || null;
    if (barcodeChanged) updates.barcode = stockBarcode.trim() || null;
    if (composesCmvChanged) {
      updates.composes_cmv = stockComposesCmv;
    }
    if (lastUnitValueChanged || lastUnitValueUnitChanged) {
      updates.last_unit_value = resolvedLastUnit;
      updates.last_unit_value_unit_code = stockLastUnitValueUnitCode || stockUnit;
      if (resolvedLastUnit == null) {
        updates.last_unit_value_stock = null;
        updates.average_cost = null;
      } else {
        const convRows = stockProductConversions.map((r) => ({
          primary_unit_code: r.primary_unit_code,
          secondary_unit_code: r.secondary_unit_code,
          primary_qty: Number(r.primary_qty),
          secondary_qty: Number(r.secondary_qty),
        }));
        const stockLast = convertUnitPriceForProduct(
          resolvedLastUnit,
          stockLastUnitValueUnitCode || stockUnit,
          stockUnit,
          stockUnit,
          convRows,
        );
        const stockCost = roundUnitPrice(stockLast ?? resolvedLastUnit);
        updates.last_unit_value_stock = stockCost;
        // Mantém a base de valorização de estoque alinhada ao preço manual informado.
        updates.average_cost = stockCost;
      }
    }
    if (unitChanged) {
      const currentAverageCost =
        stockProduct.average_cost != null &&
        Number.isFinite(Number(stockProduct.average_cost))
          ? Number(stockProduct.average_cost)
          : null;
      if (
        currentAverageCost != null &&
        Number.isFinite(currentQty) &&
        currentQty > 0 &&
        Number.isFinite(newQty) &&
        newQty > 0
      ) {
        updates.average_cost = roundUnitPrice(
          (currentQty * currentAverageCost) / newQty,
        );
      }
      if (!lastUnitValueChanged && !lastUnitValueUnitChanged) {
        const currentStockLast =
          stockProduct.last_unit_value_stock != null &&
          Number.isFinite(Number(stockProduct.last_unit_value_stock))
            ? Number(stockProduct.last_unit_value_stock)
            : stockProduct.last_unit_value != null &&
                Number.isFinite(Number(stockProduct.last_unit_value))
              ? Number(stockProduct.last_unit_value)
              : null;
        if (
          currentStockLast != null &&
          Number.isFinite(currentQty) &&
          currentQty > 0 &&
          Number.isFinite(newQty) &&
          newQty > 0
        ) {
          updates.last_unit_value_stock = roundUnitPrice(
            (currentQty * currentStockLast) / newQty,
          );
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from("products")
        .update(updates)
        .eq("id", stockProduct.id);
      if (error) {
        console.error(error);
        setStockSaving(false);
        return;
      }
    }

    if (categoriesChanged) {
      const idsToPersist = [...categoryIdsSnapshot];
      const { error: delErr } = await supabase
        .from("product_category_assignments")
        .delete()
        .eq("product_id", stockProduct.id);
      if (delErr) {
        console.error(delErr);
        setStockSaving(false);
        return;
      }
      if (idsToPersist.length > 0) {
        const { error: insErr } = await supabase
          .from("product_category_assignments")
          .insert(
            idsToPersist.map((category_id) => ({
              product_id: stockProduct.id,
              category_id,
            })),
          );
        if (insErr) {
          console.error(insErr);
          setStockSaving(false);
          return;
        }
      }
      setStockProductCategoryIds(idsToPersist);
      stockProductCategoryIdsRef.current = idsToPersist;
      setInitialStockProductCategoryIds(idsToPersist);
    }

    if (conversionsChanged && currentCompany?.id) {
      const { error: convDelErr } = await supabase
        .from("product_unit_conversions")
        .delete()
        .eq("product_id", stockProduct.id);
      if (convDelErr) {
        console.error(convDelErr);
        setStockSaving(false);
        return;
      }
      if (stockProductConversions.length > 0) {
        const { error: convInsErr } = await supabase
          .from("product_unit_conversions")
          .insert(
            stockProductConversions.map((r) => ({
              company_id: currentCompany.id,
              product_id: stockProduct.id,
              primary_qty: r.primary_qty,
              primary_unit_code: r.primary_unit_code,
              secondary_qty: r.secondary_qty,
              secondary_unit_code: r.secondary_unit_code,
            })),
          );
        if (convInsErr) {
          console.error(convInsErr);
          setStockSaving(false);
          return;
        }
      }
      setInitialStockProductConversions([...stockProductConversions]);
    }

    setStockSaving(false);
    closeStockSheet();
    void loadCompanyProductCategories();
    fetchProducts();
    void fetchLowStockCount();
    if (currentCompany?.id) void syncCompanyAlerts(currentCompany.id);
  };

  return (
    <PageShell className="space-y-8" narrow>
      <PageHeader
        title="Produtos e estoque"
        description="Catálogo, CMV, movimentações, contagem (incluindo link pelo WhatsApp), compras, etiquetas, perdas e receitas."
        icon={Package}
        action={
          estoqueTab === "catalogo" ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportSheetOpen(true)}
                className="h-10 w-full shrink-0 sm:w-auto"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Importar planilha
              </Button>
              <Button
                type="button"
                onClick={() => setProductSheetOpen(true)}
                className="h-10 w-full shrink-0 sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                Novo produto
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-border/80 pb-px scrollbar-thin">
        {(
          [
            ["catalogo", "Catálogo", LayoutGrid],
            ["movimentos", "Movimentos", SlidersHorizontal],
            ["cmv", "CMV", Coins],
            ["contagem", "Contagem", ClipboardList],
            ["compras", "Compras", ShoppingCart],
            ["etiquetas", "Etiquetas", Tag],
            ["perdas", "Perdas", Trash2],
            ["receitas", "Receitas", ChefHat],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setEstoqueTab(id as EstoqueTab)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-none border-b-2 px-2.5 py-2 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
              estoqueTab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {label}
          </button>
        ))}
      </div>

      {currentCompany?.id && (
        <>
          <CreateProductSheet
            open={productSheetOpen}
            onOpenChange={setProductSheetOpen}
            companyId={currentCompany.id}
            onSuccess={() => {
              void fetchProducts();
              void syncCompanyAlerts(currentCompany.id);
            }}
          />
          <ProductImportSheet
            open={importSheetOpen}
            onOpenChange={setImportSheetOpen}
            companyId={currentCompany.id}
            onSuccess={() => {
              void fetchProducts();
              void fetchLowStockCount();
              void syncCompanyAlerts(currentCompany.id);
            }}
          />
        </>
      )}

      {estoqueTab === "catalogo" && (
        <>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Produtos cadastrados
            </CardTitle>
            <CardDescription>
              Vincule itens das despesas aos produtos para atualizar o estoque
            </CardDescription>
          </div>
          {currentCompany?.id ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={stockExportLoading}
                  className="shrink-0 gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  {stockExportLoading ? "Exportando…" : "Exportar Excel"}
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => void handleStockExport("filtered")}
                  disabled={stockExportLoading}
                >
                  Com filtros atuais
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void handleStockExport("all")}
                  disabled={stockExportLoading}
                >
                  Todos os produtos
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </CardHeader>
        <CardContent>
          {lowStockOnly && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <span>
                Mostrando apenas produtos com estoque na ou abaixo do mínimo
                cadastrado.
              </span>
              <Button variant="ghost" size="sm" className="shrink-0" asChild>
                <Link to="/app/produtos">Ver todos os produtos</Link>
              </Button>
            </div>
          )}
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[min(100%,220px)] max-w-md flex-1 space-y-1.5">
                <Label htmlFor="prod-search" className="text-xs text-muted-foreground">
                  Produto
                </Label>
                <Input
                  id="prod-search"
                  placeholder="Nome ou SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="w-full min-w-[140px] max-w-[200px] space-y-1.5 sm:w-auto">
                <Label className="text-xs text-muted-foreground">Situação</Label>
                <Select
                  value={filterActive}
                  onValueChange={(v) =>
                    setFilterActive(v as "all" | "active" | "inactive")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativos</SelectItem>
                    <SelectItem value="inactive">Inativos</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full min-w-[160px] max-w-[240px] space-y-1.5 sm:w-auto">
                <Label className="text-xs text-muted-foreground">Categoria</Label>
                <Select
                  value={filterCategoryId}
                  onValueChange={setFilterCategoryId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {companyProductCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full min-w-[180px] max-w-[260px] space-y-1.5 sm:w-auto">
                <Label className="text-xs text-muted-foreground">Alerta de estoque</Label>
                {lowStockOnly ? (
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Apenas ≤ mínimo (link estoque baixo)
                  </p>
                ) : (
                  <Select
                    value={filterStockAlert}
                    onValueChange={(v) =>
                      setFilterStockAlert(
                        v as "all" | "zero" | "below_min" | "any",
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="any">Com alerta</SelectItem>
                      <SelectItem value="zero">Estoque zerado</SelectItem>
                      <SelectItem value="below_min">
                        Abaixo do mínimo (com saldo)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="w-full min-w-[150px] max-w-[200px] space-y-1.5 sm:w-auto">
                <Label className="text-xs text-muted-foreground">Compõe CMV</Label>
                <Select
                  value={filterComposesCmv}
                  onValueChange={(v) =>
                    setFilterComposesCmv(v as "all" | "yes" | "no")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="yes">Sim</SelectItem>
                    <SelectItem value="no">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full min-w-[160px] max-w-[200px] space-y-1.5 sm:w-auto">
                <Label className="text-xs text-muted-foreground">
                  Atualizado em
                </Label>
                <Select
                  value={filterUpdatedPreset}
                  onValueChange={(v) =>
                    setFilterUpdatedPreset(
                      v as "all" | "today" | "7d" | "30d" | "custom",
                    )
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Qualquer data</SelectItem>
                    <SelectItem value="today">Hoje</SelectItem>
                    <SelectItem value="7d">Últimos 7 dias</SelectItem>
                    <SelectItem value="30d">Últimos 30 dias</SelectItem>
                    <SelectItem value="custom">Entre datas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {filterUpdatedPreset === "custom" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="upd-from" className="text-xs text-muted-foreground">
                      De
                    </Label>
                    <Input
                      id="upd-from"
                      type="date"
                      value={filterUpdatedFrom}
                      onChange={(e) => setFilterUpdatedFrom(e.target.value)}
                      className="w-[160px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="upd-to" className="text-xs text-muted-foreground">
                      Até
                    </Label>
                    <Input
                      id="upd-to"
                      type="date"
                      value={filterUpdatedTo}
                      onChange={(e) => setFilterUpdatedTo(e.target.value)}
                      className="w-[160px]"
                    />
                  </div>
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setSearch("");
                  setFilterCategoryId("all");
                  setFilterStockAlert("all");
                  setFilterComposesCmv("all");
                  setFilterUpdatedPreset("all");
                  setFilterUpdatedFrom("");
                  setFilterUpdatedTo("");
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : products.length === 0 ? (
            <p className="text-muted-foreground">
              {lowStockOnly
                ? "Nenhum produto com estoque baixo (entre os que têm quantidade mínima definida)."
                : "Nenhum produto cadastrado"}
            </p>
          ) : (
            <ul className="list-none space-y-4 p-0">
              {products.map((p) => {
                const qNum = Number(p.current_quantity);
                const minNum = Number(p.min_quantity ?? 0);
                const stockIsZero = p.stock_is_zero ?? qNum <= 0;
                const stockBelowMinPositive =
                  p.stock_below_min_positive ??
                  (minNum > 0 && qNum > 0 && qNum <= minNum);
                const needsStockHighlight =
                  p.stock_has_alert ??
                  (stockIsZero || (minNum > 0 && qNum <= minNum));
                const qtyStr = Number(p.current_quantity).toLocaleString("pt-BR");
                const minStr =
                  p.min_quantity > 0
                    ? Number(p.min_quantity).toLocaleString("pt-BR")
                    : "—";
                const { cmv, last, unit: unitCost, lastUnitCode } = unitCostParts(p);
                const stockLineValue =
                  unitCost != null
                    ? Number(p.current_quantity) * unitCost
                    : null;
                const catalogTags = productCatalogMap[p.id];
                const composesLabel = productComposesCmv(p)
                  ? "Compõe CMV: Sim"
                  : "Compõe CMV: Não";
                const catSegments =
                  catalogTags && catalogTags.length > 0
                    ? [...catalogTags.map((c) => c.name), composesLabel]
                    : [composesLabel];
                const pendingPurchaseQty =
                  pendingPurchaseByProduct[p.id] ?? 0;
                return (
                  <li key={p.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openStockSheet(p)}
                      onKeyDown={(e) => e.key === "Enter" && openStockSheet(p)}
                      className={cn(
                        "group relative w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/25 text-left shadow-sm transition-all",
                        "hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "p-4 sm:p-5 md:p-6",
                        p.is_active === false && "opacity-[0.82]",
                        needsStockHighlight
                          ? "border-destructive/35 bg-destructive/[0.04] ring-1 ring-inset ring-destructive/15"
                          : "border-border/80",
                      )}
                    >
                      <div className="flex gap-3 sm:gap-4">
                        <div
                          className={cn(
                            "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-sm sm:h-12 sm:w-12",
                            needsStockHighlight
                              ? "border-destructive/30 bg-destructive/10 text-destructive"
                              : "border-border/70 bg-muted/50 text-muted-foreground group-hover:border-primary/25 group-hover:bg-primary/5 group-hover:text-primary",
                          )}
                          aria-hidden
                        >
                          <Package className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.6} />
                        </div>

                        <div className="min-w-0 flex-1 space-y-3 sm:space-y-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                                <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl">
                                  {p.name}
                                </h3>
                                {p.is_active === false && (
                                  <Badge
                                    variant="secondary"
                                    className="h-6 gap-1 px-2 text-[0.7rem] font-normal"
                                  >
                                    <PowerOff className="h-3 w-3" />
                                    Inativo
                                  </Badge>
                                )}
                                {stockIsZero && (
                                  <Badge
                                    variant="destructive"
                                    className="h-6 gap-1 px-2 text-[0.7rem] font-normal"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    Estoque zerado
                                  </Badge>
                                )}
                                {stockBelowMinPositive && (
                                  <Badge
                                    variant="secondary"
                                    className="h-6 gap-1 border-amber-500/40 bg-amber-500/10 px-2 text-[0.7rem] font-normal text-amber-950 dark:text-amber-50"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    Abaixo do mínimo
                                  </Badge>
                                )}
                                {pendingPurchaseQty > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="h-6 gap-1 border-blue-500/35 bg-blue-500/[0.08] px-2 text-[0.7rem] font-normal text-blue-950 dark:border-blue-400/35 dark:bg-blue-500/15 dark:text-blue-50"
                                  >
                                    <ShoppingCart className="h-3 w-3" />
                                    Compra em andamento
                                  </Badge>
                                )}
                              </div>

                              {catSegments.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {catSegments.map((seg, idx) => (
                                    <span
                                      key={`${p.id}-${idx}-${seg}`}
                                      className={cn(
                                        "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm",
                                        cmvCategoryTagClass(idx),
                                      )}
                                    >
                                      <span className="truncate">{seg}</span>
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <p className="text-xs text-muted-foreground sm:text-[0.8rem]">
                                <span className="font-mono text-[0.8rem] sm:text-sm">
                                  {p.sku ? p.sku : "—"}
                                </span>
                                <span className="mx-2 text-border">·</span>
                                <span>Unidade: {p.unit}</span>
                              </p>
                            </div>

                            <span
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary sm:h-10 sm:w-10"
                              aria-hidden
                            >
                              <ChevronRight className="h-5 w-5" />
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
                              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Quantidade
                              </p>
                              <p className="mt-2 text-lg font-semibold tabular-nums leading-none text-foreground sm:text-xl">
                                <span className="inline-flex flex-wrap items-baseline gap-x-1">
                                  <span>{qtyStr}</span>
                                  <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                                    {p.unit}
                                  </span>
                                </span>
                                {pendingPurchaseQty > 0 ? (
                                  <span className="mt-1.5 block text-xs font-normal tabular-nums leading-snug text-blue-700 dark:text-blue-300">
                                    +
                                    {pendingPurchaseQty.toLocaleString("pt-BR")}{" "}
                                    {p.unit} em pedido de compra
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
                              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Estoque mínimo
                              </p>
                              <p className="mt-2 text-lg font-semibold tabular-nums leading-none text-foreground sm:text-xl">
                                {minStr}
                                {p.min_quantity > 0 ? (
                                  <span className="ml-1 text-xs font-medium text-muted-foreground sm:text-sm">
                                    {p.unit}
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
                              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Preço unitário
                              </p>
                              <p className="mt-2 text-sm font-semibold tabular-nums leading-tight text-foreground sm:text-base">
                                {cmv != null ? (
                                  <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
                                    <span className="whitespace-nowrap">
                                      {formatCurrency(cmv)}
                                    </span>
                                    <span className="text-[0.65rem] font-normal text-muted-foreground sm:text-xs">
                                      /{p.unit} · médio
                                    </span>
                                  </span>
                                ) : last != null ? (
                                  <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
                                    <span className="whitespace-nowrap">
                                      {formatCurrency(last)}
                                    </span>
                                    <span className="text-[0.65rem] font-normal text-muted-foreground sm:text-xs">
                                      /{lastUnitCode ?? p.unit} · último
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </p>
                            </div>
                            <div
                              className={cn(
                                "rounded-xl border px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5",
                                stockLineValue != null && unitCost != null
                                  ? "border-primary/25 bg-primary/[0.06]"
                                  : "border-border/70 bg-background/70",
                              )}
                            >
                              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Valor em estoque
                              </p>
                              <p
                                className={cn(
                                  "mt-2 text-base font-bold tabular-nums leading-snug sm:text-lg",
                                  stockLineValue != null && unitCost != null
                                    ? "text-foreground"
                                    : "text-muted-foreground",
                                )}
                              >
                                {stockLineValue != null && unitCost != null
                                  ? formatCurrency(stockLineValue)
                                  : "—"}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!loading && (
            <Pagination
              page={productsPage}
              totalCount={productsCount}
              onPageChange={setProductsPage}
            />
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!stockProduct}
        onOpenChange={(o) => {
          if (!o) closeStockSheet();
        }}
      >
        <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl sm:max-w-2xl lg:max-w-3xl">
          {stockProduct && productSheetView === "summary" && (
            <>
              <SheetHeader className="shrink-0 space-y-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
                <div className="mb-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      productSheetViewRef.current = "edit";
                      syncStockFormFromProduct(stockProduct);
                      setProductSheetView("edit");
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                </div>
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                      stockProduct.min_quantity > 0 &&
                        stockProduct.current_quantity <= stockProduct.min_quantity
                        ? "border-destructive/40 bg-destructive/15 text-destructive"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    <Package className="h-7 w-7" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3 pr-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle className="text-xl font-semibold leading-snug sm:text-2xl">
                        {stockProduct.name}
                      </SheetTitle>
                      {stockProduct.is_active === false ? (
                        <Badge variant="secondary" className="gap-1">
                          <PowerOff className="h-3 w-3" />
                          Inativo
                        </Badge>
                      ) : null}
                      {stockProduct.min_quantity > 0 &&
                      stockProduct.current_quantity <= stockProduct.min_quantity ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Estoque baixo
                        </Badge>
                      ) : null}
                    </div>
                    <SheetDescription>
                      Resumo do cadastro — toque em{" "}
                      <span className="font-medium text-foreground">Editar</span>{" "}
                      para alterar dados, categorias e estoque.
                    </SheetDescription>
                    <div>
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        Categorias de produto
                      </p>
                      {stockProductCategoryIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {stockProductCategoryIds
                            .map((id) =>
                              companyProductCategories.find((c) => c.id === id),
                            )
                            .filter(
                              (c): c is CompanyProductCategory => c != null,
                            )
                            .sort((a, b) =>
                              a.name.localeCompare(b.name, "pt-BR"),
                            )
                            .map((c, idx) => (
                              <span
                                key={c.id}
                                className={cn(
                                  "inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-medium shadow-sm",
                                  cmvCategoryTagClass(idx),
                                )}
                              >
                                <span className="truncate">{c.name}</span>
                              </span>
                            ))}
                        </div>
                      ) : (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          Nenhuma categoria — adicione em Editar.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
                <div className="space-y-4 p-6">
                  <div className={SHEET_SECTION}>
                    <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Identificação
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm shadow-sm">
                        <span className="text-muted-foreground">SKU</span>
                        <span className="font-mono font-medium text-right wrap-anywhere">
                          {stockProduct.sku ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm shadow-sm">
                        <span className="text-muted-foreground">Unidade</span>
                        <span className="font-medium">{stockProduct.unit}</span>
                      </div>
                      <div className="flex justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm shadow-sm sm:col-span-2">
                        <span className="text-muted-foreground">Código barras</span>
                        <span className="font-mono text-right wrap-anywhere">
                          {stockProduct.barcode ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm shadow-sm sm:col-span-2">
                        <span className="text-muted-foreground shrink-0">
                          Compõe CMV?
                        </span>
                        <span className="text-right font-medium leading-snug">
                          {productComposesCmv(stockProduct) ? "Sim" : "Não"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Estoque e valor
                    </p>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className={SHEET_TILE}>
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Quantidade
                        </p>
                        <p className="mt-2 text-xl font-semibold tabular-nums leading-none text-foreground sm:text-2xl">
                          {Number(stockProduct.current_quantity).toLocaleString(
                            "pt-BR",
                          )}
                          <span className="ml-1 text-sm font-medium text-muted-foreground">
                            {stockProduct.unit}
                          </span>
                        </p>
                      </div>
                      <div className={SHEET_TILE}>
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Mínimo
                        </p>
                        <p className="mt-2 text-xl font-semibold tabular-nums leading-none text-foreground sm:text-2xl">
                          {Number(stockProduct.min_quantity) > 0
                            ? Number(stockProduct.min_quantity).toLocaleString(
                                "pt-BR",
                              )
                            : "—"}
                          {Number(stockProduct.min_quantity) > 0 ? (
                            <span className="ml-1 text-sm font-medium text-muted-foreground">
                              {stockProduct.unit}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className={SHEET_TILE}>
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          {stockPricePresentation.average != null &&
                          stockPricePresentation.last != null
                            ? "Custos"
                            : stockPricePresentation.average != null
                              ? "Preço médio"
                              : stockPricePresentation.last != null
                                ? "Último preço"
                                : "Preço"}
                        </p>
                        <div className="mt-2 space-y-2.5 text-base font-semibold tabular-nums leading-snug text-foreground sm:text-lg">
                          {stockPricePresentation.average != null &&
                          stockPricePresentation.last != null ? (
                            <>
                              <div>
                                <p className="text-xs font-normal text-muted-foreground">
                                  Preço médio
                                </p>
                                <p>
                                  {formatCurrency(stockPricePresentation.average)}
                                  <span className="text-xs font-normal text-muted-foreground">
                                    {" "}
                                    por {stockProduct.unit}
                                  </span>
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-normal text-muted-foreground">
                                  Último preço
                                </p>
                                <p>
                                  {formatCurrency(stockPricePresentation.last)}
                                  <span className="text-xs font-normal text-muted-foreground">
                                    {" "}
                                    por{" "}
                                    {stockPricePresentation.lastUnitCode ??
                                      stockProduct.unit}
                                  </span>
                                </p>
                              </div>
                            </>
                          ) : stockPricePresentation.average != null ? (
                            <p>
                              {formatCurrency(stockPricePresentation.average)}
                              <span className="block text-xs font-normal text-muted-foreground sm:inline sm:ml-1">
                                por {stockProduct.unit}
                              </span>
                            </p>
                          ) : stockPricePresentation.last != null ? (
                            <p>
                              {formatCurrency(stockPricePresentation.last)}
                              <span className="block text-xs font-normal text-muted-foreground sm:inline sm:ml-1">
                                por{" "}
                                {stockPricePresentation.lastUnitCode ??
                                  stockProduct.unit}
                              </span>
                            </p>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                      <div
                        className={cn(
                          SHEET_TILE,
                          stockSummaryLineValue != null &&
                            stockPricePresentation.lineUnit != null
                            ? "border-primary/30 bg-card ring-1 ring-primary/20"
                            : "",
                        )}
                      >
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Valor em estoque
                        </p>
                        <p
                          className={cn(
                            "mt-2 text-lg font-bold tabular-nums sm:text-xl",
                            stockSummaryLineValue != null &&
                              stockPricePresentation.lineUnit != null
                              ? "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {stockSummaryLineValue != null &&
                          stockPricePresentation.lineUnit != null
                            ? formatCurrency(stockSummaryLineValue)
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className={SHEET_SECTION}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        Histórico de movimentação
                      </p>
                      <span className="text-xs text-muted-foreground">
                        Últimos 20 registros
                      </span>
                    </div>
                    {stockMovementLoading ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando movimentações...
                      </div>
                    ) : stockMovementRows.length === 0 ? (
                      <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
                        Nenhuma movimentação registrada para este produto.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-border bg-background shadow-sm">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                              <th className="px-3 py-2 font-medium">Data</th>
                              <th className="px-3 py-2 font-medium">Tipo</th>
                              <th className="px-3 py-2 font-medium">Quantidade</th>
                              <th className="px-3 py-2 font-medium">Origem</th>
                              <th className="px-3 py-2 font-medium">Custo un.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockMovementRows.map((row) => {
                              const isIn = row.type === "in";
                              return (
                                <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                    {new Date(row.created_at).toLocaleString("pt-BR", {
                                      day: "2-digit",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge
                                      variant={isIn ? "secondary" : "outline"}
                                      className="gap-1 font-normal"
                                    >
                                      {isIn ? (
                                        <ArrowDownLeft className="h-3 w-3" />
                                      ) : (
                                        <ArrowUpRight className="h-3 w-3" />
                                      )}
                                      {isIn ? "Entrada" : "Saída"}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2 tabular-nums">
                                    {Number(row.quantity).toLocaleString("pt-BR")}{" "}
                                    {stockProduct.unit}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    {stockRefLabel(row.reference_type)}
                                  </td>
                                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                                    {row.unit_cost != null
                                      ? formatCurrency(Number(row.unit_cost))
                                      : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className={cn(SHEET_SECTION, "flex flex-wrap items-center justify-between gap-3")}>
                    <div>
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        Status
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Visível ao vincular em despesas e notas
                      </p>
                    </div>
                    {stockProduct.is_active !== false ? (
                      <Badge variant="secondary" className="h-8 px-3">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="h-8 gap-1 px-3">
                        <PowerOff className="h-3.5 w-3.5" />
                        Inativo
                      </Badge>
                    )}
                  </div>

                  {stockProduct.min_quantity > 0 &&
                    stockProduct.current_quantity <= stockProduct.min_quantity && (
                      <div className="flex items-center gap-3 rounded-2xl border border-destructive/50 bg-card px-4 py-3 text-destructive shadow-sm">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/40 bg-background">
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">Estoque no ou abaixo do mínimo</p>
                          <p className="text-xs text-destructive/90">
                            Verifique compras ou ajuste o mínimo cadastrado.
                          </p>
                        </div>
                      </div>
                    )}
                </div>
              </div>

              <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={closeStockSheet}
                >
                  Fechar
                </Button>
              </SheetFooter>
            </>
          )}
          {stockProduct && productSheetView === "edit" && (
            <>
              <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
                    <Pencil className="h-6 w-6 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1 pr-6">
                    <SheetTitle className="text-xl font-semibold sm:text-2xl">
                      Editar produto
                    </SheetTitle>
                    <SheetDescription>
                      {stockProduct.name}
                    </SheetDescription>
                    <p className="text-sm text-muted-foreground">
                      Alterações entram em vigor ao salvar.
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
                <div className="space-y-4 p-6">
                  <div className={SHEET_SECTION}>
                    <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Identificação
                    </p>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="stock-name">Nome</Label>
                        <Input
                          id="stock-name"
                          value={stockName}
                          onChange={(e) => setStockName(e.target.value)}
                          placeholder="Nome do produto"
                          className={SHEET_INPUT}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="stock-sku">Código (SKU)</Label>
                          <Input
                            id="stock-sku"
                            value={stockSku}
                            onChange={(e) => setStockSku(e.target.value)}
                            placeholder="Opcional"
                            className={cn(SHEET_INPUT, "font-mono")}
                          />
                        </div>
                        <div>
                          <Label htmlFor="stock-barcode">Código de barras</Label>
                          <Input
                            id="stock-barcode"
                            value={stockBarcode}
                            onChange={(e) => setStockBarcode(e.target.value)}
                            placeholder="Opcional — EAN ou alfanumérico"
                            className={cn(SHEET_INPUT, "font-mono")}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Unidade</Label>
                        <Select
                          value={stockUnit}
                          onValueChange={handleStockUnitChange}
                        >
                          <SelectTrigger className={SHEET_SELECT}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {unitSelectOptions.map((u) => (
                              <SelectItem key={u.value} value={u.value}>
                                {u.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {currentCompany?.id ? (
                    <div className={SHEET_SECTION}>
                      <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        Categorias de produto
                      </p>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Várias categorias; crie novas pelo campo abaixo se precisar.
                      </p>
                      <ProductCategoryTagsField
                        companyId={currentCompany.id}
                        categories={companyProductCategories}
                        selectedIds={stockProductCategoryIds}
                        onChange={(ids) => {
                          stockProductCategoryIdsRef.current = ids;
                          setStockProductCategoryIds(ids);
                        }}
                        onCategoriesChange={() =>
                          void loadCompanyProductCategories()
                        }
                        disabled={stockSaving}
                        label=""
                        hint=""
                      />
                    </div>
                  ) : null}

                  <div className={SHEET_SECTION}>
                    <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      CMV e preço de referência
                    </p>
                    <div className="flex flex-row items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                      <div className="space-y-0.5">
                        <Label htmlFor="stock-composes-cmv" className="text-base">
                          Este produto compõe CMV?
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Se sim, vendas geram CMV na folha de despesa CMV da
                          empresa. A classificação da receita da venda fica em
                          Receitas.
                        </p>
                      </div>
                      <Switch
                        id="stock-composes-cmv"
                        checked={stockComposesCmv}
                        onCheckedChange={setStockComposesCmv}
                        disabled={stockSaving}
                      />
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="stock-last-unit">Último valor pago (opcional)</Label>
                      <Input
                        id="stock-last-unit"
                        type="text"
                        inputMode="numeric"
                        value={stockLastUnitValue}
                        onChange={(e) =>
                          setStockLastUnitValue(formatCurrencyInput(e.target.value))
                        }
                        placeholder="Ex.: R$ 25,00"
                        className={SHEET_INPUT}
                      />
                      </div>
                      <div>
                        <Label>Unidade do valor</Label>
                        <Select
                          value={stockLastUnitValueUnitCode}
                          onValueChange={setStockLastUnitValueUnitCode}
                        >
                          <SelectTrigger className={SHEET_SELECT}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {lastUnitValueUnitOptions.map((u) => (
                              <SelectItem key={u.value} value={u.value}>
                                {u.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Referência manual por {stockLastUnitValueUnitCode}. Esse valor
                        de referência não muda ao trocar a unidade principal do produto;
                        o sistema converte internamente só para manter o total correto.
                      </p>
                    </div>
                  </div>

                  <div className={SHEET_SECTION}>
                    <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quantidades
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="stock-qty">Em estoque</Label>
                        <Input
                          id="stock-qty"
                          type="number"
                          step="0.01"
                          min="0"
                          value={stockQuantity}
                          onChange={(e) => setStockQuantity(e.target.value)}
                          className={SHEET_INPUT}
                        />
                      </div>
                      <div>
                        <Label htmlFor="stock-min">Mínimo (alerta)</Label>
                        <Input
                          id="stock-min"
                          type="number"
                          step="0.01"
                          min="0"
                          value={stockMinQuantity}
                          onChange={(e) => setStockMinQuantity(e.target.value)}
                          placeholder="0 = sem alerta"
                          className={SHEET_INPUT}
                        />
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          0 desativa o alerta de estoque baixo.
                        </p>
                      </div>
                    </div>
                  </div>

                  {currentCompany?.id ? (
                    <ProductUnitConversionsSection
                      companyId={currentCompany.id}
                      stockUnitCode={stockUnit}
                      value={stockProductConversions}
                      onChange={setStockProductConversions}
                      disabled={stockSaving}
                      sectionClassName={SHEET_SECTION}
                    />
                  ) : null}

                  <div
                    className={cn(
                      SHEET_SECTION,
                      "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
                    )}
                  >
                    <div>
                      <Label className="text-base" htmlFor="stock-active">
                        Status do item
                      </Label>
                      <p
                        id="stock-active"
                        className="mt-1 text-sm text-muted-foreground"
                      >
                        Inativos não aparecem ao vincular em despesas.
                      </p>
                    </div>
                    <Switch
                      checked={stockIsActive}
                      onCheckedChange={setStockIsActive}
                      className="data-[state=checked]:bg-primary"
                    />
                  </div>
                </div>
              </div>

              <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    productSheetViewRef.current = "summary";
                    syncStockFormFromProduct(stockProduct);
                    void (async () => {
                      const ids = await loadAssignmentsForProduct(
                        stockProduct.id,
                      );
                      setStockProductCategoryIds(ids);
                      setInitialStockProductCategoryIds(ids);
                      stockProductCategoryIdsRef.current = ids;
                    })();
                    setProductSheetView("summary");
                  }}
                  disabled={stockSaving}
                >
                  Voltar ao resumo
                </Button>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={closeStockSheet}
                    disabled={stockSaving}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={handleStockSave}
                    disabled={stockSaving}
                  >
                    {stockSaving ? "Salvando..." : "Salvar"}
                  </Button>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {lowStockCount > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {lowStockCount} produto(s) com estoque abaixo do mínimo
            </CardTitle>
            <CardDescription>
              Verifique o recebimento de notas ou ajuste as quantidades mínimas
            </CardDescription>
          </CardHeader>
        </Card>
      )}
        </>
      )}

      {currentCompany?.id && estoqueTab === "movimentos" && (
        <EstoqueMovimentacoesPanel companyId={currentCompany.id} />
      )}
      {currentCompany?.id && estoqueTab === "cmv" && (
        <EstoqueCmvPanel companyId={currentCompany.id} />
      )}
      {currentCompany?.id && estoqueTab === "contagem" && (
        <EstoqueContagemPanel companyId={currentCompany.id} />
      )}
      {currentCompany?.id && estoqueTab === "compras" && (
        <EstoqueComprasPanel companyId={currentCompany.id} />
      )}
      {currentCompany?.id && estoqueTab === "etiquetas" && (
        <EstoqueEtiquetasPanel companyId={currentCompany.id} />
      )}
      {currentCompany?.id && estoqueTab === "perdas" && (
        <EstoquePerdasPanel companyId={currentCompany.id} />
      )}
      {currentCompany?.id && estoqueTab === "receitas" && (
        <EstoqueReceitasPanel
          companyId={currentCompany.id}
          onStockChanged={() => {
            void fetchProducts();
            void fetchLowStockCount();
          }}
        />
      )}
    </PageShell>
  );
}

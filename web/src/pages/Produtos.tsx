import { CreateProductSheet } from "@/components/CreateProductSheet";
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
import { ProductCatalogCard } from "@/components/products/ProductCatalogCard";
import type { ProductCatalogLayout } from "@/components/products/ProductCatalogCard";
import { ProductCatalogFiltersPanel } from "@/components/products/ProductCatalogFiltersPanel";
import { ProductIdentificationSummary } from "@/components/products/ProductIdentificationSummary";
import { ProductMergeDialog } from "@/components/products/ProductMergeDialog";
import { ProductTechnicalSheetDialog } from "@/components/products/ProductTechnicalSheetDialog";
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SECTION,
  PRODUCT_SHEET_SELECT,
  PRODUCT_SHEET_TILE,
} from "@/components/products/productSheetStyles";
import { ProductStockLotsSection } from "@/components/products/ProductStockLotsSection";
import {
  parseProductStockLots,
  type ProductStockLotEntry,
} from "@/lib/productStockLots";
import { ProductStockMovementHistorySection } from "@/components/products/ProductStockMovementHistorySection";
import { ProductSuppliersSection } from "@/components/products/ProductSuppliersSection";
import { ProductUnitConversionsSection } from "@/components/products/ProductUnitConversionsSection";
import {
  isLegacyProductUnit,
  ProductUnitSearchSelect,
} from "@/components/products/ProductUnitSearchSelect";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import {
  fetchProductTechnicalSheet,
  technicalSheetErrorMessage,
} from "@/lib/productTechnicalSheet";
import {
  convertUnitPriceForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import { productConversionRowLabel } from "@/lib/companyUnits/productConversionRows";
import {
  buildProductUnitSelectOptions,
  getSystemProductUnitSelectOptionsWithLegacy,
  isSystemUnitCode,
} from "@/lib/companyUnits/productUnitOptions";
import {
  buildNextConversionsAfterHubChange,
  computeStockQuantityAfterHubChange,
} from "@/lib/companyUnits/stockHubUnitChange";
import { runStockExportDownload } from "@/lib/exportProductStockExcel";
import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import { updatedAtFilterBounds } from "@/lib/productCatalogFilters";
import {
  matchesPurchasesMetric,
  parsePurchasesMetricParam,
  PURCHASES_METRIC_LABELS,
} from "@/lib/productPurchasesDashboard";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";
import { parseProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import {
  loadProductUnitConversions,
  persistProductUnitConversions,
} from "@/lib/productUnitConversionsService";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  AlertTriangle,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Coins,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  Truck,
  LayoutGrid,
  Merge,
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

const CATALOG_VIEW_STORAGE_KEY = "faro:produtos-catalog-view-mode";

function readCatalogViewMode(): ProductCatalogLayout {
  try {
    const stored = localStorage.getItem(CATALOG_VIEW_STORAGE_KEY);
    return stored === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
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

type OperationalTypeValue =
  | "INSUMO"
  | "PRODUTO_REVENDA"
  | "ITEM_OPERACIONAL"
  | "RECEITA_FICHA"
  | "NAO_ESTOCAVEL"
  | "REVISAO_PENDENTE";

const OPERATIONAL_TYPE_LABEL: Record<OperationalTypeValue, string> = {
  INSUMO: "Insumo",
  PRODUTO_REVENDA: "Revenda",
  ITEM_OPERACIONAL: "Operacional",
  RECEITA_FICHA: "Receita / ficha",
  NAO_ESTOCAVEL: "Nao estocavel",
  REVISAO_PENDENTE: "Revisao pendente",
};

const OPERATIONAL_TYPE_OPTIONS: OperationalTypeValue[] = [
  "INSUMO",
  "PRODUTO_REVENDA",
  "ITEM_OPERACIONAL",
  "RECEITA_FICHA",
  "NAO_ESTOCAVEL",
  "REVISAO_PENDENTE",
];

type OperationalConfigSnapshot = {
  suggested_operational_type: string | null;
  suggested_score: number | null;
  suggestion_reasons: Record<string, unknown> | null;
  configuration_status: string | null;
  configuration_completeness: Record<string, unknown> | null;
  linked_entry_breakdown_recipe_id: string | null;
};

function operationalTypeLabel(value: string | null | undefined): string {
  if (!value) return "Nao classificado";
  return OPERATIONAL_TYPE_LABEL[value as OperationalTypeValue] ?? value;
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

async function fetchProductConversionMap(
  companyId: string,
  productIds: string[],
): Promise<
  Record<
    string,
    Array<{
      primary_qty: number;
      primary_unit_code: string;
      secondary_qty: number;
      secondary_unit_code: string;
    }>
  >
> {
  if (productIds.length === 0) return {};
  const { data, error } = await supabase
    .from("products")
    .select("id, unit_conversions")
    .eq("company_id", companyId)
    .in("id", productIds);
  if (error) return {};
  const out: Record<
    string,
    Array<{
      primary_qty: number;
      primary_unit_code: string;
      secondary_qty: number;
      secondary_unit_code: string;
    }>
  > = {};
  for (const row of data ?? []) {
    const r = row as { id: string; unit_conversions?: unknown };
    const parsed = parseProductUnitConversionsJson(
      r.unit_conversions,
      companyId,
      r.id,
    );
    if (parsed.length === 0) continue;
    out[r.id] = parsed.map((c) => ({
      primary_qty: Number(c.primary_qty),
      primary_unit_code: c.primary_unit_code,
      secondary_qty: Number(c.secondary_qty),
      secondary_unit_code: c.secondary_unit_code,
    }));
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
  const [searchParams, setSearchParams] = useSearchParams();
  const lowStockOnly = searchParams.get("estoque") === "baixo";
  const purchasesFilter = parsePurchasesMetricParam(
    searchParams.get("compras"),
  );
  const recipeOutputProductId =
    searchParams.get("recipeOutputProduct")?.trim() || undefined;
  const productHighlightId = searchParams.get("highlight")?.trim() || undefined;

  const clearRecipeOutputProductParam = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    if (!next.has("recipeOutputProduct")) return;
    next.delete("recipeOutputProduct");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsCount, setProductsCount] = useState(0);
  const [productsPage, setProductsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
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
  const [catalogViewMode, setCatalogViewMode] =
    useState<ProductCatalogLayout>(readCatalogViewMode);
  const [catalogFiltersOpen, setCatalogFiltersOpen] = useState(
    () => lowStockOnly || purchasesFilter != null,
  );
  const [stockExportLoading, setStockExportLoading] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  /** Resumo ao abrir; edição após "Editar". */
  const [productSheetView, setProductSheetView] = useState<"summary" | "edit">(
    "summary",
  );
  /** Abas dentro do detalhe do produto (vista resumo). */
  const [productDetailTab, setProductDetailTab] = useState<
    "resumo" | "historico" | "fornecedores"
  >("resumo");
  const [stockName, setStockName] = useState("");
  const [stockSku, setStockSku] = useState("");
  const [stockUnit, setStockUnit] = useState("un");
  const [stockCustomUnitInput, setStockCustomUnitInput] = useState("");
  const [stockCustomUnitLabel, setStockCustomUnitLabel] = useState("");
  const [customUnitAliasOptions, setCustomUnitAliasOptions] = useState<
    Array<{ unit_code: string; unit_label: string }>
  >([]);
  const [bulkUnitApplyDialogOpen, setBulkUnitApplyDialogOpen] = useState(false);
  const [bulkUnitApplyLoading, setBulkUnitApplyLoading] = useState(false);
  const [pendingBulkUnitApply, setPendingBulkUnitApply] = useState<{
    companyId: string;
    sourceUnitRaw: string;
    targetUnitCode: string;
    excludeProductId: string;
  } | null>(null);
  const [stockBarcode, setStockBarcode] = useState("");
  const [stockEan, setStockEan] = useState("");
  const [stockUnitCreating, setStockUnitCreating] = useState(false);
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockMinQuantity, setStockMinQuantity] = useState("");
  const [stockLastUnitValue, setStockLastUnitValue] = useState("");
  const [stockLastUnitValueUnitCode, setStockLastUnitValueUnitCode] =
    useState("un");
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
  const productHighlightHandledRef = useRef<string | null>(null);
  const productsFetchSeqRef = useRef(0);
  const catalogLoadedForCompanyRef = useRef<string | null>(null);
  /** Nomes das categorias de catálogo por produto (listagem). */
  const [productCatalogMap, setProductCatalogMap] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  const [operationalTypeByProduct, setOperationalTypeByProduct] = useState<
    Record<string, string | null>
  >({});
  const [operationalConfigByProduct, setOperationalConfigByProduct] = useState<
    Record<string, OperationalConfigSnapshot>
  >({});
  const [stockOperationalType, setStockOperationalType] =
    useState<OperationalTypeValue>("REVISAO_PENDENTE");
  const [pendingPurchaseByProduct, setPendingPurchaseByProduct] = useState<
    Record<string, number>
  >({});
  const [productConversionMap, setProductConversionMap] = useState<
    Record<
      string,
      Array<{
        primary_qty: number;
        primary_unit_code: string;
        secondary_qty: number;
        secondary_unit_code: string;
      }>
    >
  >({});
  const [stockSaving, setStockSaving] = useState(false);
  const [lotsRefreshKey, setLotsRefreshKey] = useState(0);
  const [stockLots, setStockLots] = useState<ProductStockLotEntry[]>([]);
  const [initialStockLots, setInitialStockLots] = useState<
    ProductStockLotEntry[]
  >([]);
  const [stockDeleteDialogOpen, setStockDeleteDialogOpen] = useState(false);
  const [productMergeOpen, setProductMergeOpen] = useState(false);
  const [technicalSheetOpen, setTechnicalSheetOpen] = useState(false);
  const [outputTechnicalSheetRecipeId, setOutputTechnicalSheetRecipeId] = useState<
    string | null
  >(null);
  const [stockDeleting, setStockDeleting] = useState(false);
  const [stockProductConversions, setStockProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [initialStockProductConversions, setInitialStockProductConversions] =
    useState<ProductUnitConversionDraft[]>([]);
  const [stockProductConversionsLoading, setStockProductConversionsLoading] =
    useState(false);
  const [stockConversionsSaving, setStockConversionsSaving] = useState(false);
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
    () => buildProductUnitSelectOptions(stockUnit, customUnitAliasOptions),
    [stockUnit, customUnitAliasOptions],
  );
  const knownUnitCodes = useMemo(
    () => new Set(unitSelectOptions.map((u) => u.value.trim().toLowerCase())),
    [unitSelectOptions],
  );
  const lastUnitValueUnitOptions = useMemo(() => {
    const allowed = new Set<string>([stockUnit]);
    for (const r of stockProductConversions) {
      if (
        r.primary_unit_code.trim().toLowerCase() ===
        stockUnit.trim().toLowerCase()
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

  const computeStockUnitHubChange = (
    prev: string,
    next: string,
    input: {
      quantityStr: string;
      minQuantityStr: string;
      conversions: ProductUnitConversionDraft[];
      lastUnitValueStr: string;
      lastUnitValueUnitCode: string;
      companyId: string;
    },
  ) => {
    if (prev.trim().toLowerCase() === next.trim().toLowerCase()) return null;
    const q = parseFloat(
      input.quantityStr.replace(/\s/g, "").replace(",", "."),
    );
    const m = parseFloat(
      input.minQuantityStr.replace(/\s/g, "").replace(",", "."),
    );
    const qOk = Number.isFinite(q);
    const mOk = Number.isFinite(m);
    const convRows = input.conversions.map((r) => ({
      primary_unit_code: r.primary_unit_code,
      secondary_unit_code: r.secondary_unit_code,
      primary_qty: Number(r.primary_qty),
      secondary_qty: Number(r.secondary_qty),
    }));
    const rebasedConversions = buildNextConversionsAfterHubChange(
      convRows,
      prev,
      next,
    );
    const cq = qOk
      ? computeStockQuantityAfterHubChange(
          q,
          prev,
          next,
          convRows,
          rebasedConversions,
        )
      : null;
    const cm = mOk
      ? computeStockQuantityAfterHubChange(
          m,
          prev,
          next,
          convRows,
          rebasedConversions,
        )
      : null;
    const prevPriceUnit = (
      input.lastUnitValueUnitCode.trim() || prev
    ).toLowerCase();
    let nextLastUnitValueStr: string | null = null;
    let nextLastUnitValueUnitCode: string | null = null;
    if (prevPriceUnit === prev.trim().toLowerCase()) {
      nextLastUnitValueUnitCode = next;
    }
    const parsedLast = parseCurrencyInput(input.lastUnitValueStr);
    if (
      parsedLast != null &&
      Number.isFinite(parsedLast) &&
      prevPriceUnit === prev.trim().toLowerCase() &&
      cq != null &&
      qOk &&
      cq > 0
    ) {
      const nextPrice = (parsedLast * q) / cq;
      if (Number.isFinite(nextPrice)) {
        nextLastUnitValueStr = new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(nextPrice);
      }
    }
    const messages: string[] = [];
    if (qOk && cq == null) {
      messages.push(
        "Sem conversão entre essas unidades; ajuste o estoque manualmente se necessário.",
      );
    }
    if (input.conversions.length > 0 && rebasedConversions.length === 0) {
      messages.push(
        "Não foi possível reaproveitar as conversões com a nova unidade.",
      );
    }
    return {
      nextUnit: next,
      conversions: rebasedConversions.map((r) => ({
        ...r,
        company_id: input.companyId,
      })),
      quantityStr: cq != null ? String(cq) : null,
      minQuantityStr: cm != null ? String(cm) : null,
      lastUnitValueStr: nextLastUnitValueStr,
      lastUnitValueUnitCode: nextLastUnitValueUnitCode,
      numericQuantity: cq,
      numericMinQuantity: cm,
      messages,
    };
  };

  const applyStockUnitHubChangeToForm = (
    effects: NonNullable<ReturnType<typeof computeStockUnitHubChange>>,
    opts?: { persistHint?: boolean },
  ) => {
    setStockUnit(effects.nextUnit);
    setStockProductConversions(effects.conversions);
    if (effects.lastUnitValueUnitCode != null) {
      setStockLastUnitValueUnitCode(effects.lastUnitValueUnitCode);
    }
    if (effects.lastUnitValueStr != null) {
      setStockLastUnitValue(effects.lastUnitValueStr);
    }
    if (effects.quantityStr != null) {
      setStockQuantity(effects.quantityStr);
    }
    if (effects.minQuantityStr != null) {
      setStockMinQuantity(effects.minQuantityStr);
    }
    for (const msg of effects.messages) {
      toast.message(msg);
    }
    if (
      opts?.persistHint &&
      (effects.quantityStr != null || effects.minQuantityStr != null)
    ) {
      toast.message(
        "Unidade de estoque atualizada no formulário. Salve para persistir.",
      );
    }
  };

  const handleStockUnitChange = (next: string) => {
    if (!currentCompany?.id) return;
    const effects = computeStockUnitHubChange(stockUnit, next, {
      quantityStr: stockQuantity,
      minQuantityStr: stockMinQuantity,
      conversions: stockProductConversions,
      lastUnitValueStr: stockLastUnitValue,
      lastUnitValueUnitCode: stockLastUnitValueUnitCode,
      companyId: currentCompany.id,
    });
    if (!effects) return;
    applyStockUnitHubChangeToForm(effects, { persistHint: true });
  };

  const reloadStockConversionsAfterPersist = async () => {
    if (!currentCompany?.id || !stockProduct) return;
    const { rows } = await loadProductUnitConversions(
      currentCompany.id,
      stockProduct.id,
    );
    setStockProductConversions(rows);
    setInitialStockProductConversions([...rows]);
    setProductConversionMap((prev) => ({
      ...prev,
      [stockProduct.id]: rows.map((c) => ({
        primary_qty: Number(c.primary_qty),
        primary_unit_code: c.primary_unit_code,
        secondary_qty: Number(c.secondary_qty),
        secondary_unit_code: c.secondary_unit_code,
      })),
    }));
  };

  const handleSummaryConversionsChange = async (
    next: ProductUnitConversionDraft[],
  ) => {
    if (!currentCompany?.id || !stockProduct) return;
    setStockConversionsSaving(true);
    const withMeta = next.map((r) => ({
      ...r,
      company_id: currentCompany.id,
      product_id: stockProduct.id,
    }));
    const convResult = await persistProductUnitConversions(
      currentCompany.id,
      stockProduct.id,
      withMeta,
    );
    if (!convResult.ok) {
      toast.error(convResult.error ?? "Falha ao salvar conversões.");
      setStockConversionsSaving(false);
      return;
    }
    await reloadStockConversionsAfterPersist();
    setStockConversionsSaving(false);
    toast.success("Conversões atualizadas.");
  };

  const handleSummaryPromoteStockUnit = async (secondaryCode: string) => {
    if (!currentCompany?.id || !stockProduct) return;
    const effects = computeStockUnitHubChange(stockUnit, secondaryCode.trim(), {
      quantityStr: stockQuantity,
      minQuantityStr: stockMinQuantity,
      conversions: stockProductConversions,
      lastUnitValueStr: stockLastUnitValue,
      lastUnitValueUnitCode: stockLastUnitValueUnitCode,
      companyId: currentCompany.id,
    });
    if (!effects) return;
    setStockConversionsSaving(true);
    applyStockUnitHubChangeToForm(effects);

    const currentQty = parseFloat(
      stockQuantity.replace(/\s/g, "").replace(",", "."),
    );
    const newQty =
      effects.numericQuantity ??
      (Number.isFinite(currentQty) ? currentQty : stockProduct.current_quantity);
    const newMin =
      effects.numericMinQuantity ??
      parseFloat(stockMinQuantity.replace(/\s/g, "").replace(",", ".")) ??
      stockProduct.min_quantity;

    const updates: {
      unit: string;
      current_quantity: number;
      min_quantity: number;
      last_unit_value_stock?: number | null;
      average_cost?: number | null;
      last_unit_value_unit_code?: string | null;
    } = {
      unit: effects.nextUnit.trim().toLowerCase(),
      current_quantity: newQty,
      min_quantity: Number.isFinite(newMin) ? newMin : stockProduct.min_quantity,
    };

    if (effects.lastUnitValueUnitCode != null) {
      updates.last_unit_value_unit_code = effects.lastUnitValueUnitCode;
    }

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

    const { error: unitError } = await supabase
      .from("products")
      .update(updates)
      .eq("company_id", currentCompany.id)
      .eq("id", stockProduct.id);
    if (unitError) {
      toast.error(unitError.message);
      setStockConversionsSaving(false);
      return;
    }

    const convResult = await persistProductUnitConversions(
      currentCompany.id,
      stockProduct.id,
      effects.conversions.map((r) => ({
        ...r,
        product_id: stockProduct.id,
      })),
    );
    if (!convResult.ok) {
      toast.error(convResult.error ?? "Falha ao salvar conversões.");
      setStockConversionsSaving(false);
      return;
    }

    await reloadStockConversionsAfterPersist();
    setStockProduct((prev) =>
      prev
        ? {
            ...prev,
            unit: updates.unit,
            current_quantity: updates.current_quantity,
            min_quantity: updates.min_quantity,
            last_unit_value_unit_code:
              updates.last_unit_value_unit_code ?? prev.last_unit_value_unit_code,
            last_unit_value_stock:
              updates.last_unit_value_stock ?? prev.last_unit_value_stock,
            average_cost: updates.average_cost ?? prev.average_cost,
          }
        : prev,
    );
    setProducts((prev) =>
      prev.map((p) =>
        p.id === stockProduct.id
          ? {
              ...p,
              unit: updates.unit,
              current_quantity: updates.current_quantity,
              min_quantity: updates.min_quantity,
              last_unit_value_unit_code:
                updates.last_unit_value_unit_code ??
                p.last_unit_value_unit_code,
              last_unit_value_stock:
                updates.last_unit_value_stock ?? p.last_unit_value_stock,
              average_cost: updates.average_cost ?? p.average_cost,
            }
          : p,
      ),
    );
    setStockConversionsSaving(false);
    toast.success("Unidade padrão atualizada.");
  };

  const normalizeCustomUnitCode = (raw: string): string => {
    return raw
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "");
  };

  const applyCustomUnit = async (
    overrideLabel?: string,
    overrideCode?: string,
  ) => {
    const code = normalizeCustomUnitCode(
      overrideCode ?? stockCustomUnitInput,
    );
    const label = (overrideLabel ?? stockCustomUnitLabel).trim();
    if (!code) {
      toast.error("Informe um código de unidade válido (ex.: fd).");
      return;
    }
    if (!label) {
      toast.error("Informe o nome da unidade (ex.: Vidro).");
      return;
    }
    if (!currentCompany?.id) {
      toast.error("Empresa não encontrada para registrar unidade.");
      return;
    }
    setStockUnitCreating(true);
    const sourceHint = String(
      stockProduct?.import_unit_raw ?? overrideCode ?? stockCustomUnitInput,
    ).trim();
    const { data, error } = await supabase.rpc(
      "register_company_custom_unit_alias",
      {
        p_company_id: currentCompany.id,
        p_unit_label: label,
        p_unit_code: code,
        p_source_hint: sourceHint || code,
        p_apply_to_existing: true,
      },
    );
    let updatedProducts = 0;
    if (error) {
      const msg = String(error.message ?? "");
      const canFallback =
        msg.includes("register_company_custom_unit_alias") &&
        msg.includes("does not exist");
      if (!canFallback) {
        toast.error(`Falha ao criar unidade: ${error.message}`);
        setStockUnitCreating(false);
        return;
      }
      const { error: aliasInsertError } = await supabase
        .from("company_custom_unit_aliases")
        .upsert(
          {
            company_id: currentCompany.id,
            unit_code: code,
            unit_label: label,
            source_hint: sourceHint || code,
          },
          { onConflict: "company_id,unit_code" },
        );
      if (aliasInsertError) {
        toast.error(`Falha ao registrar unidade: ${aliasInsertError.message}`);
        setStockUnitCreating(false);
        return;
      }
      const { data: pendingRows, error: pendingError } = await supabase
        .from("products")
        .select("id")
        .eq("company_id", currentCompany.id)
        .eq("import_unit_needs_review", true)
        .eq("import_unit_raw", sourceHint || code);
      if (pendingError) {
        toast.error(
          `Falha ao localizar produtos pendentes: ${pendingError.message}`,
        );
        setStockUnitCreating(false);
        return;
      }
      const ids = (pendingRows ?? []).map((r) =>
        String((r as { id: string }).id),
      );
      if (ids.length > 0) {
        const { error: bulkError } = await supabase
          .from("products")
          .update({
            unit: code,
            import_unit_needs_review: false,
            import_unit_raw: null,
          })
          .in("id", ids);
        if (bulkError) {
          toast.error(`Falha ao aplicar em lote: ${bulkError.message}`);
          setStockUnitCreating(false);
          return;
        }
      }
      updatedProducts = ids.length;
    } else {
      const payload = data as {
        ok?: boolean;
        error?: string;
        updated_products?: number;
      };
      if (!payload?.ok) {
        toast.error(payload?.error ?? "Não foi possível registrar unidade.");
        setStockUnitCreating(false);
        return;
      }
      updatedProducts = Number(payload.updated_products ?? 0);
    }

    if (stockProduct?.id) {
      const { error: currentProductError } = await supabase
        .from("products")
        .update({
          unit: code,
          import_unit_needs_review: false,
          import_unit_raw: null,
        })
        .eq("id", stockProduct.id);
      if (currentProductError) {
        toast.error(
          `Unidade criada, mas falhou ao aplicar no produto atual: ${currentProductError.message}`,
        );
      }
    }
    handleStockUnitChange(code);
    setStockCustomUnitInput("");
    setStockCustomUnitLabel("");
    toast.success(
      `Unidade "${label} (${code})" criada e aplicada em ${updatedProducts} produto(s).`,
    );
    const { data: aliases } = await supabase
      .from("company_custom_unit_aliases")
      .select("unit_code, unit_label")
      .eq("company_id", currentCompany.id)
      .order("unit_label", { ascending: true });
    setCustomUnitAliasOptions(
      (aliases ?? []) as Array<{ unit_code: string; unit_label: string }>,
    );
    await fetchProducts();
    setStockUnitCreating(false);
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

  const loadCustomUnitAliasOptions = useCallback(async () => {
    if (!currentCompany?.id) {
      setCustomUnitAliasOptions([]);
      return;
    }
    const { data, error } = await supabase
      .from("company_custom_unit_aliases")
      .select("unit_code, unit_label")
      .eq("company_id", currentCompany.id)
      .order("unit_label", { ascending: true });
    if (error) {
      console.error(error);
      setCustomUnitAliasOptions([]);
      toast.error(
        `Não foi possível carregar unidades personalizadas: ${error.message}`,
      );
      return;
    }
    setCustomUnitAliasOptions(
      (data ?? []) as Array<{ unit_code: string; unit_label: string }>,
    );
  }, [currentCompany?.id]);

  useEffect(() => {
    if (!currentCompany?.id) return;
    void loadCompanyProductCategories();
  }, [currentCompany?.id, loadCompanyProductCategories]);

  useEffect(() => {
    void loadCustomUnitAliasOptions();
  }, [loadCustomUnitAliasOptions]);

  useEffect(() => {
    try {
      localStorage.setItem(CATALOG_VIEW_STORAGE_KEY, catalogViewMode);
    } catch {
      /* ignore */
    }
  }, [catalogViewMode]);

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

  useEffect(() => {
    catalogLoadedForCompanyRef.current = null;
    setProducts([]);
    setProductsCount(0);
    setProductsPage(1);
    setLoading(true);
    setCatalogRefreshing(false);
  }, [currentCompany?.id]);

  const fetchProducts = useCallback(async () => {
    const companyId = currentCompany?.id;
    if (!companyId) return;

    const requestSeq = ++productsFetchSeqRef.current;
    const isInitialLoad = catalogLoadedForCompanyRef.current !== companyId;

    if (isInitialLoad) {
      setLoading(true);
      setCatalogRefreshing(false);
    } else {
      setCatalogRefreshing(true);
    }

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
          if (requestSeq !== productsFetchSeqRef.current) return;
          setProducts([]);
          setProductsCount(0);
          setProductCatalogMap({});
          setOperationalTypeByProduct({});
          setOperationalConfigByProduct({});
          setPendingPurchaseByProduct({});
          catalogLoadedForCompanyRef.current = companyId;
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
          .eq("company_id", companyId)
          .eq("listed_in_product_catalog", true)
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

      let rows: Product[];
      let totalCount: number;
      if (purchasesFilter) {
        const all = await fetchAllInRange<Product>(buildBase());
        const filtered = all.filter((p) =>
          matchesPurchasesMetric(p, purchasesFilter),
        );
        const from = (productsPage - 1) * PAGE_SIZE;
        rows = filtered.slice(from, from + PAGE_SIZE);
        totalCount = filtered.length;
      } else {
        const { data, count, error } = await buildBase().range(
          (productsPage - 1) * PAGE_SIZE,
          productsPage * PAGE_SIZE - 1,
        );
        if (error) console.error(error);
        rows = (data ?? []) as Product[];
        totalCount = count ?? 0;
      }

      if (requestSeq !== productsFetchSeqRef.current) return;

      setProducts(rows);
      setProductsCount(totalCount);

      const [catalogMap, pendingMap, opCfg] = await Promise.all([
        fetchProductCatalogMap(companyId, rows.map((p) => p.id)),
        loadPendingPurchaseQuantities(companyId),
        rows.length > 0
          ? supabase
              .from("product_operational_config")
              .select(
                "product_id, final_operational_type, suggested_operational_type, suggested_score, suggestion_reasons, configuration_status, configuration_completeness, linked_entry_breakdown_recipe_id",
              )
              .eq("company_id", companyId)
              .in(
                "product_id",
                rows.map((p) => p.id),
              )
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (requestSeq !== productsFetchSeqRef.current) return;

      setProductCatalogMap(catalogMap);
      setPendingPurchaseByProduct(pendingMap);
      const convMap = await fetchProductConversionMap(
        companyId,
        rows.map((p) => p.id),
      );

      if (requestSeq !== productsFetchSeqRef.current) return;

      setProductConversionMap(convMap);
      if (opCfg.error) {
        console.error(opCfg.error);
        setOperationalTypeByProduct({});
        setOperationalConfigByProduct({});
      } else {
        const byId: Record<string, string | null> = {};
        const cfgById: Record<string, OperationalConfigSnapshot> = {};
        for (const raw of opCfg.data ?? []) {
          const row = raw as {
            product_id: string;
            final_operational_type: string | null;
            suggested_operational_type: string | null;
            suggested_score: number | null;
            suggestion_reasons: Record<string, unknown> | null;
            configuration_status: string | null;
            configuration_completeness: Record<string, unknown> | null;
            linked_entry_breakdown_recipe_id: string | null;
          };
          byId[row.product_id] =
            row.final_operational_type ??
            row.suggested_operational_type ??
            null;
          cfgById[row.product_id] = {
            suggested_operational_type: row.suggested_operational_type,
            suggested_score: row.suggested_score,
            suggestion_reasons: row.suggestion_reasons ?? null,
            configuration_status: row.configuration_status,
            configuration_completeness: row.configuration_completeness ?? null,
            linked_entry_breakdown_recipe_id:
              row.linked_entry_breakdown_recipe_id ?? null,
          };
        }
        setOperationalTypeByProduct(byId);
        setOperationalConfigByProduct(cfgById);
      }
      catalogLoadedForCompanyRef.current = companyId;
    } finally {
      if (requestSeq === productsFetchSeqRef.current) {
        setLoading(false);
        setCatalogRefreshing(false);
      }
    }
  }, [
    currentCompany?.id,
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
    purchasesFilter,
  ]);

  useEffect(() => {
    if (!purchasesFilter) return;
    setProductsPage(1);
  }, [purchasesFilter]);

  const fetchLowStockCount = useCallback(async () => {
    const companyId = currentCompany?.id;
    if (!companyId) return;
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("stock_below_min_inclusive", true)
      .or("is_active.is.null,is_active.eq.true");
    if (error) {
      console.error(error);
      setLowStockCount(0);
      return;
    }
    setLowStockCount(count ?? 0);
  }, [currentCompany?.id]);

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
    setProductsPage(1);
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
    void fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    const est = searchParams.get("estoque");
    const aba = searchParams.get("aba");
    const compras = searchParams.get("compras");
    if (est === "baixo" || compras) {
      setEstoqueTab("catalogo");
    } else if (est === "receitas") {
      setEstoqueTab("receitas");
    } else if (aba === "contagem") {
      setEstoqueTab("contagem");
    }
  }, [searchParams]);

  useEffect(() => {
    void fetchLowStockCount();
  }, [fetchLowStockCount]);

  useEffect(() => {
    if (!stockProduct?.id || !currentCompany?.id) {
      return;
    }
    if (productConversionsLoadedIdRef.current === stockProduct.id) {
      return;
    }
    const loadPid = stockProduct.id;
    let cancelled = false;
    setStockProductConversionsLoading(true);
    void (async () => {
      const { rows, error } = await loadProductUnitConversions(
        currentCompany!.id,
        loadPid,
      );
      if (cancelled) return;
      if (error) {
        console.error(error);
        setStockProductConversions([]);
        setInitialStockProductConversions([]);
        setStockProductConversionsLoading(false);
        return;
      }
      setStockProductConversions(rows);
      setInitialStockProductConversions(rows);
      productConversionsLoadedIdRef.current = loadPid;
      setStockProductConversionsLoading(false);
    })();
    return () => {
      cancelled = true;
      setStockProductConversionsLoading(false);
    };
  }, [stockProduct?.id, currentCompany?.id]);

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
    return {
      cmv,
      last,
      unit,
      lastUnitCode: p.last_unit_value_unit_code ?? p.unit,
    };
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

  const syncStockFormFromProduct = useCallback(
    (p: Product) => {
      const normalizedUnit = (p.unit || "un").trim().toLowerCase();
      const normalizedLastUnit = (
        p.last_unit_value_unit_code?.trim() ||
        p.unit ||
        "un"
      )
        .trim()
        .toLowerCase();
      setStockName(p.name);
      setStockSku(p.sku ?? "");
      setStockUnit(normalizedUnit);
      setStockBarcode(p.barcode ?? "");
      setStockEan(p.ean ?? "");
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
      setStockLastUnitValueUnitCode(normalizedLastUnit);
      setStockIsActive(p.is_active !== false);
      setStockComposesCmv(productComposesCmv(p));
      const importRaw = (p.import_unit_raw ?? "").trim();
      setStockCustomUnitInput(importRaw);
      setStockCustomUnitLabel("");
      setStockOperationalType(
        (operationalTypeByProduct[p.id] as
          | OperationalTypeValue
          | null
          | undefined) ?? "REVISAO_PENDENTE",
      );
    },
    [operationalTypeByProduct],
  );

  const openStockSheet = (p: Product) => {
    const gen = ++assignmentLoadGenRef.current;
    productSheetViewRef.current = "summary";
    productConversionsLoadedIdRef.current = null;
    setStockProduct(p);
    const parsedLots = parseProductStockLots(p.stock_lots);
    setStockLots(parsedLots);
    setInitialStockLots(parsedLots);
    syncStockFormFromProduct(p);
    setProductSheetView("summary");
    setProductDetailTab("resumo");
    const cachedConversions = (productConversionMap[p.id] ?? []).map((r) => ({
      company_id: currentCompany?.id ?? "",
      primary_qty: r.primary_qty,
      primary_unit_code: r.primary_unit_code,
      secondary_qty: r.secondary_qty,
      secondary_unit_code: r.secondary_unit_code,
    }));
    setStockProductConversions(cachedConversions);
    setInitialStockProductConversions(cachedConversions);
    setStockProductCategoryIds([]);
    setInitialStockProductCategoryIds([]);
    stockProductCategoryIdsRef.current = [];
    void (async () => {
      const sheet = await fetchProductTechnicalSheet(
        currentCompany?.id ?? p.company_id,
        p.id,
      );
      if (assignmentLoadGenRef.current === gen) {
        setOutputTechnicalSheetRecipeId(sheet.data?.recipe_id ?? null);
      }
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
    setStockLots([]);
    setInitialStockLots([]);
    setProductSheetView("summary");
    setProductDetailTab("resumo");
    setStockProductCategoryIds([]);
    setInitialStockProductCategoryIds([]);
    stockProductCategoryIdsRef.current = [];
    setStockOperationalType("REVISAO_PENDENTE");
    setStockProductConversions([]);
    setInitialStockProductConversions([]);
    setStockProductConversionsLoading(false);
    setStockDeleteDialogOpen(false);
    setOutputTechnicalSheetRecipeId(null);
  };

  useEffect(() => {
    if (!productHighlightId) {
      productHighlightHandledRef.current = null;
    }
  }, [productHighlightId]);

  /** Abre o detalhe do produto quando a URL traz `?highlight=<uuid>` (ex.: revisão pós-importação). */
  useEffect(() => {
    if (!productHighlightId || loading) return;
    if (productHighlightHandledRef.current === productHighlightId) return;
    const found = products.find((p) => p.id === productHighlightId);
    if (!found) {
      toast.message(
        "Produto não está na página atual. Use a busca ou mude de página na lista.",
      );
      productHighlightHandledRef.current = productHighlightId;
      const next = new URLSearchParams(searchParams);
      next.delete("highlight");
      setSearchParams(next, { replace: true });
      return;
    }
    productHighlightHandledRef.current = productHighlightId;
    openStockSheet(found);
    const next = new URLSearchParams(searchParams);
    next.delete("highlight");
    setSearchParams(next, { replace: true });
  }, [productHighlightId, loading, products, searchParams, setSearchParams]);

  const handleStockSave = async () => {
    if (!stockProduct) return;
    const newName = sanitizeCatalogProductName(stockName);
    if (!newName) return;
    const newQty = parseFloat(stockQuantity);
    if (Number.isNaN(newQty) || newQty < 0) return;
    const newMinQty = parseFloat(stockMinQuantity);
    if (Number.isNaN(newMinQty) || newMinQty < 0) return;
    const currentQty = Number(stockProduct.current_quantity);
    const currentMinQty = Number(stockProduct.min_quantity ?? 0);
    const currentActive = stockProduct.is_active !== false;
    const delta = newQty - currentQty;
    const nameChanged =
      newName !== sanitizeCatalogProductName(stockProduct.name ?? "");
    const minChanged = newMinQty !== currentMinQty;
    const activeChanged = stockIsActive !== currentActive;
    const qtyChanged = delta !== 0;
    const skuChanged =
      (stockSku.trim() || null) !== (stockProduct.sku?.trim() || null);
    const currentUnit = (stockProduct.unit || "un").trim().toLowerCase();
    const unitChanged = stockUnit !== currentUnit;
    const barcodeChanged =
      (stockBarcode.trim() || null) !== (stockProduct.barcode?.trim() || null);
    const eanChanged =
      (stockEan.trim() || null) !== (stockProduct.ean?.trim() || null);
    const composesCmvChanged =
      productComposesCmv(stockProduct) !== stockComposesCmv;
    const currentOperationalType =
      (operationalTypeByProduct[stockProduct.id] as
        | OperationalTypeValue
        | null
        | undefined) ?? "REVISAO_PENDENTE";
    const operationalTypeChanged =
      stockOperationalType !== currentOperationalType;

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
      stockProduct.last_unit_value_unit_code?.trim() ||
      stockProduct.unit ||
      "un";
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
    const lotsChanged =
      JSON.stringify(stockLots) !== JSON.stringify(initialStockLots);

    if (
      !qtyChanged &&
      !minChanged &&
      !activeChanged &&
      !nameChanged &&
      !skuChanged &&
      !unitChanged &&
      !barcodeChanged &&
      !eanChanged &&
      !composesCmvChanged &&
      !operationalTypeChanged &&
      !lastUnitValueChanged &&
      !lastUnitValueUnitChanged &&
      !categoriesChanged &&
      !conversionsChanged &&
      !lotsChanged
    ) {
      closeStockSheet();
      return;
    }
    setStockSaving(true);
    if (!unitChanged && qtyChanged) {
      const unitCostForMovement =
        delta > 0
          ? (resolvedLastUnit ??
            currentLastUnit ??
            (stockProduct.average_cost != null &&
            Number(stockProduct.average_cost) > 0
              ? Number(stockProduct.average_cost)
              : null))
          : null;
      const { error } = await supabase.rpc("adjust_product_stock", {
        p_product_id: stockProduct.id,
        p_delta: delta,
        p_type: delta > 0 ? "in" : "out",
        p_reference_type: "adjustment",
        p_reference_id: null,
        p_unit_value: unitCostForMovement,
      });
      if (error) {
        console.error(error);
        toast.error(technicalSheetErrorMessage(error.message));
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
      import_unit_raw?: string | null;
      import_unit_needs_review?: boolean;
      barcode?: string | null;
      ean?: string | null;
      composes_cmv?: boolean;
      last_unit_value?: number | null;
      last_unit_value_unit_code?: string | null;
      last_unit_value_stock?: number | null;
      average_cost?: number | null;
      stock_lots?: ProductStockLotEntry[];
    } = {};
    if (nameChanged) updates.name = newName;
    if (unitChanged) {
      updates.unit = stockUnit.trim().toLowerCase();
      if (
        isSystemUnitCode(stockUnit) ||
        knownUnitCodes.has(stockUnit.trim().toLowerCase())
      ) {
        updates.import_unit_needs_review = false;
        updates.import_unit_raw = null;
      }
      updates.current_quantity = newQty;
      updates.min_quantity = newMinQty;
    } else if (minChanged) {
      updates.min_quantity = newMinQty;
    }
    if (activeChanged) updates.is_active = stockIsActive;
    if (skuChanged) updates.sku = stockSku.trim() || null;
    if (barcodeChanged) updates.barcode = stockBarcode.trim() || null;
    if (eanChanged) updates.ean = stockEan.trim() || null;
    if (composesCmvChanged) {
      updates.composes_cmv = stockComposesCmv;
    }
    if (lastUnitValueChanged || lastUnitValueUnitChanged) {
      updates.last_unit_value = resolvedLastUnit;
      updates.last_unit_value_unit_code =
        stockLastUnitValueUnitCode || stockUnit;
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
    if (lotsChanged) {
      updates.stock_lots = stockLots;
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
    if (operationalTypeChanged) {
      const cfg = operationalConfigByProduct[stockProduct.id];
      const { data, error } = await supabase.rpc(
        "upsert_product_operational_config",
        {
          p_product_id: stockProduct.id,
          p_suggested_operational_type:
            (cfg?.suggested_operational_type as OperationalItemType | null) ??
            stockOperationalType,
          p_suggested_score: cfg?.suggested_score ?? 0,
          p_suggestion_reasons: (cfg?.suggestion_reasons ?? {}) as never,
          p_final_operational_type: stockOperationalType,
          p_final_decision_source: "USER_EDITED",
          p_configuration_status: cfg?.configuration_status ?? "PENDENTE",
          p_configuration_completeness: (cfg?.configuration_completeness ??
            {}) as never,
          p_linked_entry_breakdown_recipe_id:
            cfg?.linked_entry_breakdown_recipe_id ?? null,
          p_notes: null,
          p_ui_filter_json: null,
        },
      );
      if (error) {
        console.error(error);
        setStockSaving(false);
        return;
      }
      const out = data as { ok?: boolean; error?: string };
      if (!out?.ok) {
        toast.error(out?.error ?? "Falha ao salvar tipo operacional.");
        setStockSaving(false);
        return;
      }
      setOperationalTypeByProduct((prev) => ({
        ...prev,
        [stockProduct.id]: stockOperationalType,
      }));
    }

    const sourceReviewRaw = String(stockProduct.import_unit_raw ?? "").trim();
    const shouldOfferBulkReviewApply =
      unitChanged &&
      isSystemUnitCode(stockUnit) &&
      stockProduct.import_unit_needs_review === true &&
      sourceReviewRaw.length > 0 &&
      !!currentCompany?.id;
    if (shouldOfferBulkReviewApply) {
      setPendingBulkUnitApply({
        companyId: currentCompany!.id,
        sourceUnitRaw: sourceReviewRaw,
        targetUnitCode: stockUnit.trim().toLowerCase(),
        excludeProductId: stockProduct.id,
      });
      setBulkUnitApplyDialogOpen(true);
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
              company_id: currentCompany.id,
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
      const convResult = await persistProductUnitConversions(
        currentCompany.id,
        stockProduct.id,
        stockProductConversions.map((r) => ({
          ...r,
          company_id: currentCompany.id,
          product_id: stockProduct.id,
        })),
      );
      if (!convResult.ok) {
        console.error(convResult.error);
        setStockSaving(false);
        return;
      }
      const { rows: reloaded } = await loadProductUnitConversions(
        currentCompany.id,
        stockProduct.id,
      );
      setStockProductConversions(reloaded);
      setInitialStockProductConversions([...reloaded]);
    }

    if (lotsChanged) {
      setInitialStockLots([...stockLots]);
    }
    setStockSaving(false);
    setLotsRefreshKey((k) => k + 1);
    closeStockSheet();
    void loadCompanyProductCategories();
    fetchProducts();
    void fetchLowStockCount();
    if (currentCompany?.id) void syncCompanyAlerts(currentCompany.id);
  };

  const handleStockProductDelete = async () => {
    if (!stockProduct) return;
    setStockDeleting(true);
    const { error } = await supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", stockProduct.id);
    setStockDeleting(false);
    setStockDeleteDialogOpen(false);
    if (error) {
      console.error(error);
      toast.error(error.message ?? "Não foi possível excluir o produto.");
      return;
    }
    toast.success(
      "Produto excluído. Ele deixa de aparecer na lista de ativos.",
    );
    closeStockSheet();
    fetchProducts();
    void fetchLowStockCount();
    if (currentCompany?.id) void syncCompanyAlerts(currentCompany.id);
  };

  const confirmBulkUnitApply = async () => {
    if (!pendingBulkUnitApply) {
      setBulkUnitApplyDialogOpen(false);
      return;
    }
    setBulkUnitApplyLoading(true);
    const { data: bulkData, error: bulkError } = await supabase.rpc(
      "apply_unit_review_to_similar_products",
      {
        p_company_id: pendingBulkUnitApply.companyId,
        p_source_unit_raw: pendingBulkUnitApply.sourceUnitRaw,
        p_target_unit_code: pendingBulkUnitApply.targetUnitCode,
        p_exclude_product_id: pendingBulkUnitApply.excludeProductId,
      },
    );
    if (bulkError) {
      toast.error(`Falha ao aplicar em lote: ${bulkError.message}`);
    } else {
      const payload = bulkData as {
        ok?: boolean;
        error?: string;
        updated_products?: number;
      };
      if (!payload?.ok) {
        toast.error(
          payload?.error ?? "Não foi possível aplicar para os demais produtos.",
        );
      } else {
        toast.success(
          `Unidade aplicada em ${Number(payload.updated_products ?? 0)} produto(s) pendente(s).`,
        );
        await fetchProducts();
      }
    }
    setBulkUnitApplyLoading(false);
    setBulkUnitApplyDialogOpen(false);
    setPendingBulkUnitApply(null);
  };

  return (
    <PageShell className="min-w-0 space-y-6 sm:space-y-8">
      <PageHeader
        title="Produtos e estoque"
        description={
          <>
            <span className="hidden sm:inline">
              Catálogo, CMV, movimentações, contagem (incluindo link pelo
              WhatsApp), compras, etiquetas, perdas e fichas técnicas.
            </span>
            <span className="sm:hidden">
              Catálogo, movimentações, contagem, compras e fichas técnicas.
            </span>
          </>
        }
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

      <div className="sticky top-0 z-10 -mx-1 border-b border-border/80 bg-background/95 pb-px backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex gap-0.5 overflow-x-auto scrollbar-thin">
        {(
          [
            ["catalogo", "Catálogo", LayoutGrid],
            ["movimentos", "Movimentações", SlidersHorizontal],
            ["cmv", "CMV", Coins],
            ["contagem", "Contagem", ClipboardList],
            ["compras", "Compras", ShoppingCart],
            ["etiquetas", "Etiquetas", Tag],
            ["perdas", "Perdas", Trash2],
            ["receitas", "Ficha Técnica", ChefHat],
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
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Package className="h-5 w-5" />
                  Produtos cadastrados
                  {catalogRefreshing ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Atualizando…
                    </span>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  Vincule itens das despesas aos produtos para atualizar o
                  estoque
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    asChild
                  >
                    <Link to="/app/produtos">Ver todos os produtos</Link>
                  </Button>
                </div>
              )}
              {purchasesFilter && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  <span>
                    Filtro de compras: produtos com{" "}
                    <span className="font-medium text-foreground">
                      {PURCHASES_METRIC_LABELS[purchasesFilter]}
                    </span>
                    .
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    asChild
                  >
                    <Link to="/app/produtos">Ver todos os produtos</Link>
                  </Button>
                </div>
              )}
              <ProductCatalogFiltersPanel
                open={catalogFiltersOpen}
                onOpenChange={setCatalogFiltersOpen}
                search={search}
                onSearchChange={setSearch}
                filterActive={filterActive}
                onFilterActiveChange={setFilterActive}
                filterCategoryId={filterCategoryId}
                onFilterCategoryIdChange={setFilterCategoryId}
                filterStockAlert={filterStockAlert}
                onFilterStockAlertChange={setFilterStockAlert}
                filterComposesCmv={filterComposesCmv}
                onFilterComposesCmvChange={setFilterComposesCmv}
                filterUpdatedPreset={filterUpdatedPreset}
                onFilterUpdatedPresetChange={setFilterUpdatedPreset}
                filterUpdatedFrom={filterUpdatedFrom}
                onFilterUpdatedFromChange={setFilterUpdatedFrom}
                filterUpdatedTo={filterUpdatedTo}
                onFilterUpdatedToChange={setFilterUpdatedTo}
                lowStockOnly={lowStockOnly}
                companyProductCategories={companyProductCategories}
                viewMode={catalogViewMode}
                onViewModeChange={setCatalogViewMode}
                onClearFilters={() => {
                  setSearch("");
                  setFilterActive("active");
                  setFilterCategoryId("all");
                  setFilterStockAlert("all");
                  setFilterComposesCmv("all");
                  setFilterUpdatedPreset("all");
                  setFilterUpdatedFrom("");
                  setFilterUpdatedTo("");
                }}
              />
              {loading && products.length === 0 ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : products.length === 0 ? (
                <p className="text-muted-foreground">
                  {lowStockOnly
                    ? "Nenhum produto com estoque baixo (entre os que têm quantidade mínima definida)."
                    : "Nenhum produto cadastrado"}
                </p>
              ) : (
                <ul
                  className={cn(
                    "list-none p-0 transition-opacity duration-150",
                    catalogRefreshing && "opacity-80",
                    catalogViewMode === "grid"
                      ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                      : "space-y-4",
                  )}
                >
                  {products.map((p) => (
                    <li
                      key={p.id}
                      className={catalogViewMode === "grid" ? "min-w-0" : undefined}
                    >
                      <ProductCatalogCard
                        product={p}
                        layout={catalogViewMode}
                        formatCurrency={formatCurrency}
                        onOpen={openStockSheet}
                        operationalType={operationalTypeByProduct[p.id] ?? null}
                        operationalTypeLabel={operationalTypeLabel}
                        catalogTags={productCatalogMap[p.id]}
                        pendingPurchaseQty={pendingPurchaseByProduct[p.id] ?? 0}
                        conversionRowCount={
                          (productConversionMap[p.id] ?? []).length
                        }
                      />
                    </li>
                  ))}
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
                    <div className="mb-4 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTechnicalSheetOpen(true)}
                      >
                        <ChefHat className="h-4 w-4 mr-2" />
                        {outputTechnicalSheetRecipeId
                          ? "Editar ficha técnica"
                          : "É ficha técnica"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setProductMergeOpen(true)}
                      >
                        <Merge className="h-4 w-4 mr-2" />
                        Unificar com outro
                      </Button>
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
                            stockProduct.current_quantity <=
                              stockProduct.min_quantity
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
                          {outputTechnicalSheetRecipeId ? (
                            <Badge
                              variant="secondary"
                              className="gap-1 border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100"
                            >
                              <ChefHat className="h-3 w-3" />
                              Ficha técnica
                            </Badge>
                          ) : null}
                          {stockProduct.is_active === false ? (
                            <Badge variant="secondary" className="gap-1">
                              <PowerOff className="h-3 w-3" />
                              Inativo
                            </Badge>
                          ) : null}
                          {stockProduct.min_quantity > 0 &&
                          stockProduct.current_quantity <=
                            stockProduct.min_quantity ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Estoque baixo
                            </Badge>
                          ) : null}
                        </div>
                        <SheetDescription>
                          Resumo do cadastro — toque em{" "}
                          <span className="font-medium text-foreground">
                            Editar
                          </span>{" "}
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
                                  companyProductCategories.find(
                                    (c) => c.id === id,
                                  ),
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

                  <div
                    className="flex shrink-0 gap-1 border-b border-border bg-card px-6"
                    role="tablist"
                    aria-label="Secções do produto"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={productDetailTab === "resumo"}
                      onClick={() => setProductDetailTab("resumo")}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-none border-b-2 px-1 py-3 text-sm font-medium transition-colors sm:px-2",
                        productDetailTab === "resumo"
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Package className="h-4 w-4 shrink-0" />
                      Resumo
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={productDetailTab === "historico"}
                      onClick={() => setProductDetailTab("historico")}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-none border-b-2 px-1 py-3 text-sm font-medium transition-colors sm:px-2",
                        productDetailTab === "historico"
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <History className="h-4 w-4 shrink-0" />
                      Histórico
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={productDetailTab === "fornecedores"}
                      onClick={() => setProductDetailTab("fornecedores")}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-none border-b-2 px-1 py-3 text-sm font-medium transition-colors sm:px-2",
                        productDetailTab === "fornecedores"
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Truck className="h-4 w-4 shrink-0" />
                      Fornecedores
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
                    {productDetailTab === "resumo" ? (
                      <div className="space-y-4 p-6">
                        <ProductIdentificationSummary
                          product={stockProduct}
                          composesCmv={productComposesCmv(stockProduct)}
                          operationalTypeLabel={operationalTypeLabel(
                            operationalTypeByProduct[stockProduct.id] ?? null,
                          )}
                          className={SHEET_SECTION}
                        />

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
                                {Number(
                                  stockProduct.current_quantity,
                                ).toLocaleString("pt-BR")}
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
                                  ? Number(
                                      stockProduct.min_quantity,
                                    ).toLocaleString("pt-BR")
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
                                Último preço
                              </p>
                              <div className="mt-2 space-y-2.5 text-base font-semibold tabular-nums leading-snug text-foreground sm:text-lg">
                                <p>
                                  {formatCurrency(
                                    stockPricePresentation.last ?? 0,
                                  )}
                                  <span className="text-xs font-normal text-muted-foreground">
                                    {" "}
                                    por{" "}
                                    {stockPricePresentation.lastUnitCode ??
                                      stockProduct.unit}
                                  </span>
                                </p>
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

                        <ProductStockLotsSection
                          productId={stockProduct.id}
                          unit={stockProduct.unit}
                          currentStock={Number(stockProduct.current_quantity)}
                          refreshKey={lotsRefreshKey}
                          readOnly
                        />

                        {currentCompany?.id ? (
                          stockProductConversionsLoading ? (
                            <div className={SHEET_SECTION}>
                              <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Conversões de unidade
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Carregando conversões…
                              </p>
                            </div>
                          ) : (
                            <ProductUnitConversionsSection
                              compact
                              companyId={currentCompany.id}
                              stockUnitCode={stockProduct.unit}
                              value={stockProductConversions}
                              onChange={(next) =>
                                void handleSummaryConversionsChange(next)
                              }
                              onPromoteSecondaryToStockUnit={(code) =>
                                void handleSummaryPromoteStockUnit(code)
                              }
                              disabled={stockConversionsSaving}
                              sectionClassName={SHEET_SECTION}
                            />
                          )
                        ) : null}

                        <div
                          className={cn(
                            SHEET_SECTION,
                            "flex flex-wrap items-center justify-between gap-3",
                          )}
                        >
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
                            <Badge
                              variant="secondary"
                              className="h-8 gap-1 px-3"
                            >
                              <PowerOff className="h-3.5 w-3.5" />
                              Inativo
                            </Badge>
                          )}
                        </div>

                        {stockProduct.min_quantity > 0 &&
                          stockProduct.current_quantity <=
                            stockProduct.min_quantity && (
                            <div className="flex items-center gap-3 rounded-2xl border border-destructive/50 bg-card px-4 py-3 text-destructive shadow-sm">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/40 bg-background">
                                <AlertTriangle className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">
                                  Estoque no ou abaixo do mínimo
                                </p>
                                <p className="text-xs text-destructive/90">
                                  Verifique compras ou ajuste o mínimo
                                  cadastrado.
                                </p>
                              </div>
                            </div>
                          )}
                      </div>
                    ) : productDetailTab === "historico" ? (
                      <div className="space-y-4 p-6">
                        <ProductStockMovementHistorySection
                          productId={stockProduct.id}
                          unit={stockProduct.unit}
                          active={productDetailTab === "historico"}
                          className={SHEET_SECTION}
                        />
                      </div>
                    ) : (
                      <div className="space-y-4 p-6">
                        {currentCompany?.id ? (
                          <ProductSuppliersSection
                            productId={stockProduct.id}
                            companyId={currentCompany.id}
                            active={productDetailTab === "fornecedores"}
                            className={SHEET_SECTION}
                          />
                        ) : (
                          <p className="rounded-xl border border-border bg-background px-3 py-3 text-sm text-muted-foreground">
                            Selecione uma empresa para ver os fornecedores.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 sm:w-auto"
                      onClick={() => setStockDeleteDialogOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir produto
                    </Button>
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
                        <SheetDescription>{stockProduct.name}</SheetDescription>
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
                              <Label htmlFor="stock-barcode">
                                Código de barras
                              </Label>
                              <Input
                                id="stock-barcode"
                                value={stockBarcode}
                                onChange={(e) =>
                                  setStockBarcode(e.target.value)
                                }
                                placeholder="Opcional"
                                className={cn(SHEET_INPUT, "font-mono")}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <Label htmlFor="stock-ean">EAN / GTIN</Label>
                              <Input
                                id="stock-ean"
                                value={stockEan}
                                onChange={(e) => setStockEan(e.target.value)}
                                placeholder="Opcional — código da NF-e"
                                className={cn(SHEET_INPUT, "font-mono")}
                              />
                            </div>
                          </div>
                          <div className="flex flex-row items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                            <div className="space-y-0.5">
                              <Label
                                htmlFor="stock-active"
                                className="text-base"
                              >
                                {stockIsActive ? "Ativo" : "Inativo"}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Inativos não aparecem ao vincular em despesas.
                              </p>
                            </div>
                            <Switch
                              id="stock-active"
                              checked={stockIsActive}
                              onCheckedChange={setStockIsActive}
                              disabled={stockSaving}
                              className="data-[state=checked]:bg-primary"
                            />
                          </div>
                          <div>
                            <Label htmlFor="stock-operational-type">
                              Tipo operacional
                            </Label>
                            <Select
                              value={stockOperationalType}
                              onValueChange={(v) =>
                                setStockOperationalType(
                                  v as OperationalTypeValue,
                                )
                              }
                            >
                              <SelectTrigger
                                id="stock-operational-type"
                                className={SHEET_SELECT}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {OPERATIONAL_TYPE_OPTIONS.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {operationalTypeLabel(t)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {currentCompany?.id ? (
                            <div className="rounded-xl border border-border bg-background px-4 py-3">
                              <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Categorias de produto
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
                        </div>
                      </div>

                      <div className={SHEET_SECTION}>
                        <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Unidade de medida
                        </p>
                        <div>
                          <Label>Unidade de estoque</Label>
                          <ProductUnitSearchSelect
                            value={stockUnit}
                            options={unitSelectOptions}
                            onSelect={handleStockUnitChange}
                            onCreateUnit={async (label, code) => {
                              await applyCustomUnit(label, code);
                            }}
                            disabled={stockSaving}
                            creating={stockUnitCreating}
                            importUnitRawHint={stockProduct.import_unit_raw}
                          />
                          {isLegacyProductUnit(stockUnit, knownUnitCodes) && (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                              Unidade fora do catálogo padrão. Revise ou crie
                              uma unidade personalizada na lista.
                            </p>
                          )}
                        </div>
                      </div>

                      {currentCompany?.id ? (
                        <ProductUnitConversionsSection
                          companyId={currentCompany.id}
                          stockUnitCode={stockUnit}
                          value={stockProductConversions}
                          onChange={setStockProductConversions}
                          onPromoteSecondaryToStockUnit={handleStockUnitChange}
                          disabled={stockSaving}
                          sectionClassName={SHEET_SECTION}
                        />
                      ) : null}

                      <div className={SHEET_SECTION}>
                        <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          CMV e preço
                        </p>
                        <div className="flex flex-row items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                          <div className="space-y-0.5">
                            <Label
                              htmlFor="stock-composes-cmv"
                              className="text-base"
                            >
                              Este produto compõe CMV?
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Se sim, vendas geram CMV na folha de despesa CMV
                              da empresa. A classificação da receita da venda
                              fica em Receitas.
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
                            <Label htmlFor="stock-last-unit">
                              Último valor pago (opcional)
                            </Label>
                            <Input
                              id="stock-last-unit"
                              type="text"
                              inputMode="numeric"
                              value={stockLastUnitValue}
                              onChange={(e) =>
                                setStockLastUnitValue(
                                  formatCurrencyInput(e.target.value),
                                )
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
                          <p className="sm:col-span-2 mt-1.5 text-xs text-muted-foreground">
                            Referência manual por {stockLastUnitValueUnitCode}.
                            Esse valor de referência não muda ao trocar a
                            unidade principal do produto; o sistema converte
                            internamente só para manter o total correto.
                          </p>
                        </div>
                      </div>

                      <div className={SHEET_SECTION}>
                        <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Estoque
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
                              onChange={(e) =>
                                setStockMinQuantity(e.target.value)
                              }
                              placeholder="0 = sem alerta"
                              className={SHEET_INPUT}
                            />
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              0 desativa o alerta de estoque baixo.
                            </p>
                          </div>
                        </div>
                      </div>

                      <ProductStockLotsSection
                        productId={stockProduct.id}
                        unit={stockProduct.unit}
                        currentStock={
                          Number(stockQuantity.replace(",", ".")) ||
                          Number(stockProduct.current_quantity)
                        }
                        lots={stockLots}
                        onLotsChange={setStockLots}
                      />
                    </div>
                  </div>

                  <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 sm:w-auto"
                      onClick={() => setStockDeleteDialogOpen(true)}
                      disabled={stockSaving || stockDeleting}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir produto
                    </Button>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
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
                          setProductDetailTab("resumo");
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
                    </div>
                  </SheetFooter>
                </>
              )}
            </SheetContent>
          </Sheet>

          <AlertDialog
            open={stockDeleteDialogOpen}
            onOpenChange={(open) => {
              if (!stockDeleting) setStockDeleteDialogOpen(open);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
                <AlertDialogDescription>
                  {stockProduct
                    ? `O produto "${stockProduct.name}" será inativado e deixará de aparecer na lista de ativos. O histórico de movimentações é preservado.`
                    : "O produto será inativado e deixará de aparecer na lista de ativos."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={stockDeleting}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={stockDeleting}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleStockProductDelete();
                  }}
                >
                  {stockDeleting ? "Excluindo..." : "Excluir"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {lowStockCount > 0 && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  {lowStockCount} produto(s) com estoque abaixo do mínimo
                </CardTitle>
                <CardDescription>
                  Verifique o recebimento de notas ou ajuste as quantidades
                  mínimas
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </>
      )}

      {currentCompany?.id && estoqueTab === "movimentos" && (
        <EstoqueMovimentacoesPanel
          companyId={currentCompany.id}
          onStockChanged={() => {
            void fetchProducts();
            void fetchLowStockCount();
          }}
        />
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
          prefillNewRecipeOutputProductId={recipeOutputProductId}
          onPrefillConsumed={clearRecipeOutputProductParam}
          onStockChanged={() => {
            void fetchProducts();
            void fetchLowStockCount();
          }}
        />
      )}
      <Dialog
        open={bulkUnitApplyDialogOpen}
        onOpenChange={(open) => {
          setBulkUnitApplyDialogOpen(open);
          if (!open && !bulkUnitApplyLoading) {
            setPendingBulkUnitApply(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar unidade para pendentes?</DialogTitle>
            <DialogDescription>
              {pendingBulkUnitApply
                ? `Aplicar "${pendingBulkUnitApply.targetUnitCode}" para todos os produtos pendentes com unidade XML "${pendingBulkUnitApply.sourceUnitRaw}"?`
                : "Confirme a aplicação em massa da unidade para produtos pendentes."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBulkUnitApplyDialogOpen(false);
                if (!bulkUnitApplyLoading) setPendingBulkUnitApply(null);
              }}
              disabled={bulkUnitApplyLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void confirmBulkUnitApply()}
              disabled={bulkUnitApplyLoading || !pendingBulkUnitApply}
            >
              {bulkUnitApplyLoading ? "Aplicando..." : "Aplicar para pendentes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {currentCompany?.id && stockProduct ? (
        <ProductTechnicalSheetDialog
          open={technicalSheetOpen}
          onOpenChange={setTechnicalSheetOpen}
          companyId={currentCompany.id}
          outputProduct={stockProduct}
          onSaved={(recipeId, backfill) => {
            setOutputTechnicalSheetRecipeId(recipeId);
            closeStockSheet();
            void fetchProducts();
            if (backfill && backfill.ingredient_movements_created > 0) {
              toast.message(
                `Histórico replicado: ${backfill.output_out_movements} saída(s) do prato geraram ${backfill.ingredient_movements_created} movimentação(ões) nos insumos.`,
              );
            }
          }}
        />
      ) : null}

      {currentCompany?.id && stockProduct ? (
        <ProductMergeDialog
          open={productMergeOpen}
          onOpenChange={setProductMergeOpen}
          companyId={currentCompany.id}
          sourceProduct={stockProduct}
          formatCurrency={formatCurrency}
          onMerged={async (winnerId) => {
            await fetchProducts();
            const { data } = await supabase
              .from("products")
              .select("*")
              .eq("id", winnerId)
              .maybeSingle();
            if (data) {
              openStockSheet(data as Product);
            } else {
              closeStockSheet();
            }
          }}
        />
      ) : null}
    </PageShell>
  );
}

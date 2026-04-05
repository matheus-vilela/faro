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
  buildChildrenMap,
  isLeafCategory,
  isSelectableReceitaLeaf,
} from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { Product } from "@/types/product";
import {
  AlertTriangle,
  ChefHat,
  ChevronRight,
  ClipboardList,
  Coins,
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
import { useCallback, useEffect, useMemo, useState } from "react";

const PRODUCT_UNIT_OPTIONS = [
  { value: "un", label: "Unidade" },
  { value: "kg", label: "Quilograma (kg)" },
  { value: "g", label: "Gramas (g)" },
  { value: "l", label: "Litro (l)" },
  { value: "ml", label: "Mililitro (ml)" },
  { value: "cx", label: "Caixa" },
  { value: "pct", label: "Pacote" },
] as const;

export function Produtos() {
  const { currentCompany } = useCompany();
  const [products, setProducts] = useState<Product[]>([]);
  const [productsCount, setProductsCount] = useState(0);
  const [productsPage, setProductsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterActive, setFilterActive] = useState<
    "all" | "active" | "inactive"
  >("active");
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
  const [stockIsActive, setStockIsActive] = useState(true);
  const [stockRevenueCategoryId, setStockRevenueCategoryId] = useState("");
  const [receitaLeaves, setReceitaLeaves] = useState<CompanyCategory[]>([]);
  const [stockSaving, setStockSaving] = useState(false);

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

  const unitSelectOptions = useMemo(() => {
    const base = [...PRODUCT_UNIT_OPTIONS];
    if (stockUnit && !base.some((o) => o.value === stockUnit)) {
      return [{ value: stockUnit, label: stockUnit }, ...base];
    }
    return base;
  }, [stockUnit]);

  const defaultReceitaLeafId = useMemo(() => {
    const vendas = receitaLeaves.find(
      (c) =>
        c.name.toLowerCase().includes("vendas") &&
        c.name.toLowerCase().includes("produt"),
    );
    return vendas?.id ?? receitaLeaves[0]?.id ?? "";
  }, [receitaLeaves]);

  const loadReceitaCategories = useCallback(async () => {
    if (!currentCompany?.id) return;
    const { data, error } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", currentCompany.id)
      .eq("natureza", "RECEITA")
      .eq("tipo", "OPERACIONAL")
      .or("ativo.is.null,ativo.eq.true")
      .order("ordem", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      setReceitaLeaves([]);
      return;
    }
    const list = (data ?? []) as CompanyCategory[];
    const cm = buildChildrenMap(list);
    const leaves = list.filter(
      (c) => isSelectableReceitaLeaf(c) && isLeafCategory(c.id, cm),
    );
    setReceitaLeaves(leaves);
  }, [currentCompany?.id]);

  useEffect(() => {
    if (!stockProduct || !currentCompany?.id) return;
    void loadReceitaCategories();
  }, [stockProduct, currentCompany?.id, loadReceitaCategories]);

  const revenueCategoryDisplayName = useMemo(() => {
    if (!stockProduct?.revenue_category_id) return null;
    const leaf = receitaLeaves.find(
      (c) => c.id === stockProduct.revenue_category_id,
    );
    return leaf?.name ?? null;
  }, [stockProduct?.revenue_category_id, receitaLeaves]);

  const fetchProducts = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("company_id", currentCompany.id)
      .order("name");
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      query = query.or(`name.ilike.${term},sku.ilike.${term}`);
    }
    if (filterActive === "active") {
      query = query.or("is_active.is.null,is_active.eq.true");
    } else if (filterActive === "inactive") {
      query = query.eq("is_active", false);
    }
    const { data, count } = await query.range(
      (productsPage - 1) * PAGE_SIZE,
      productsPage * PAGE_SIZE - 1,
    );
    setProducts((data as Product[]) ?? []);
    setProductsCount(count ?? 0);
    setLoading(false);
  }, [currentCompany, debouncedSearch, filterActive, productsPage]);

  const fetchLowStockCount = useCallback(async () => {
    if (!currentCompany?.id) return;
    const { data } = await supabase
      .from("products")
      .select("current_quantity, min_quantity")
      .eq("company_id", currentCompany.id)
      .gt("min_quantity", 0)
      .or("is_active.is.null,is_active.eq.true");
    const low = (data ?? []).filter(
      (p) => Number(p.current_quantity) <= Number(p.min_quantity),
    ).length;
    setLowStockCount(low);
  }, [currentCompany]);

  useEffect(() => {
    queueMicrotask(() => setProductsPage(1));
  }, [debouncedSearch, filterActive]);

  useEffect(() => {
    queueMicrotask(() => void fetchProducts());
  }, [fetchProducts]);

  useEffect(() => {
    queueMicrotask(() => void fetchLowStockCount());
  }, [fetchLowStockCount]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const syncStockFormFromProduct = useCallback((p: Product) => {
    setStockName(p.name);
    setStockSku(p.sku ?? "");
    setStockUnit(p.unit || "un");
    setStockBarcode(p.barcode ?? "");
    setStockQuantity(String(p.current_quantity));
    setStockMinQuantity(String(p.min_quantity ?? 0));
    setStockLastUnitValue(
      p.last_unit_value != null && !Number.isNaN(Number(p.last_unit_value))
        ? String(Number(p.last_unit_value))
        : "",
    );
    setStockIsActive(p.is_active !== false);
  }, []);

  const openStockSheet = (p: Product) => {
    setStockProduct(p);
    syncStockFormFromProduct(p);
    setProductSheetView("summary");
  };

  const closeStockSheet = () => {
    setStockProduct(null);
    setProductSheetView("summary");
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
    const resolvedRevenueCategoryId =
      stockRevenueCategoryId || defaultReceitaLeafId || null;
    const revenueCategoryChanged =
      (stockProduct.revenue_category_id ?? null) !==
      (resolvedRevenueCategoryId ?? null);

    const rawLast = stockLastUnitValue.trim();
    let resolvedLastUnit: number | null = null;
    if (rawLast !== "") {
      const parsedLast = parseFloat(
        rawLast.replace(/\s/g, "").replace(",", "."),
      );
      if (Number.isNaN(parsedLast) || parsedLast < 0) {
        return;
      }
      resolvedLastUnit = parsedLast;
    }
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

    if (
      !qtyChanged &&
      !minChanged &&
      !activeChanged &&
      !nameChanged &&
      !skuChanged &&
      !unitChanged &&
      !barcodeChanged &&
      !revenueCategoryChanged &&
      !lastUnitValueChanged
    ) {
      closeStockSheet();
      return;
    }
    setStockSaving(true);
    if (qtyChanged) {
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
      is_active?: boolean;
      sku?: string | null;
      unit?: string;
      barcode?: string | null;
      revenue_category_id?: string | null;
      last_unit_value?: number | null;
    } = {};
    if (nameChanged) updates.name = newName;
    if (minChanged) updates.min_quantity = newMinQty;
    if (activeChanged) updates.is_active = stockIsActive;
    if (skuChanged) updates.sku = stockSku.trim() || null;
    if (unitChanged) updates.unit = stockUnit;
    if (barcodeChanged) updates.barcode = stockBarcode.trim() || null;
    if (revenueCategoryChanged) {
      updates.revenue_category_id = resolvedRevenueCategoryId;
    }
    if (lastUnitValueChanged) {
      updates.last_unit_value = resolvedLastUnit;
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
    setStockSaving(false);
    closeStockSheet();
    fetchProducts();
    void fetchLowStockCount();
  };

  return (
    <PageShell className="space-y-8" narrow>
      <PageHeader
        title="Produtos e estoque"
        description="Catálogo, CMV, movimentações, contagem (incluindo link pelo WhatsApp), compras, etiquetas, perdas e receitas."
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
            onSuccess={() => fetchProducts()}
          />
          <ProductImportSheet
            open={importSheetOpen}
            onOpenChange={setImportSheetOpen}
            companyId={currentCompany.id}
            onSuccess={() => {
              void fetchProducts();
              void fetchLowStockCount();
            }}
          />
        </>
      )}

      {estoqueTab === "catalogo" && (
        <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Produtos cadastrados
            </CardTitle>
            <CardDescription>
              Vincule itens das despesas aos produtos para atualizar o estoque
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Buscar por nome ou SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={filterActive}
              onValueChange={(v) =>
                setFilterActive(v as "all" | "active" | "inactive")
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : products.length === 0 ? (
            <p className="text-muted-foreground">Nenhum produto cadastrado</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {products.map((p) => {
                const isLowStock =
                  p.min_quantity > 0 && p.current_quantity <= p.min_quantity;
                const qtyStr = Number(p.current_quantity).toLocaleString("pt-BR");
                const minStr =
                  p.min_quantity > 0
                    ? Number(p.min_quantity).toLocaleString("pt-BR")
                    : null;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openStockSheet(p)}
                    onKeyDown={(e) => e.key === "Enter" && openStockSheet(p)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border px-3 py-3.5 text-left transition-colors last:border-b-0 sm:gap-4 sm:px-4",
                      "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      p.is_active === false && "opacity-[0.78]",
                      isLowStock && "bg-destructive/6",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground",
                        isLowStock &&
                          "border-destructive/35 bg-destructive/10 text-destructive",
                      )}
                      aria-hidden
                    >
                      <Package className="h-5 w-5" strokeWidth={1.75} />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium leading-snug text-foreground">
                          {p.name}
                        </span>
                        {p.is_active === false && (
                          <Badge
                            variant="secondary"
                            className="h-5 gap-1 px-1.5 text-[0.65rem] font-normal"
                          >
                            <PowerOff className="h-3 w-3" />
                            Inativo
                          </Badge>
                        )}
                        {isLowStock && (
                          <Badge
                            variant="destructive"
                            className="h-5 gap-1 px-1.5 text-[0.65rem] font-normal"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Baixo
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">
                          {p.sku ? p.sku : "—"}
                        </span>
                        <span className="mx-1.5 text-border">·</span>
                        <span>{p.unit}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                      <div className="text-right leading-tight">
                        <p className="text-base font-semibold tabular-nums leading-none text-foreground sm:text-lg">
                          {qtyStr}
                        </p>
                        <p className="mt-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                          em estoque
                        </p>
                        {minStr != null && (
                          <p className="mt-1 text-[0.65rem] tabular-nums text-muted-foreground">
                            mín. {minStr} {p.unit}
                          </p>
                        )}
                      </div>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground/70 sm:h-5 sm:w-5"
                        aria-hidden
                      />
                    </div>
                  </div>
                );
              })}
            </div>
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
        <SheetContent className="flex flex-col sm:max-w-md">
          {stockProduct && productSheetView === "summary" && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8 leading-snug">
                  {stockProduct.name}
                </SheetTitle>
                <SheetDescription>
                  Resumo do cadastro. Use Editar para alterar estoque e dados.
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto py-6">
                <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">SKU</span>
                    <span className="font-mono text-right wrap-anywhere">
                      {stockProduct.sku ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Unidade</span>
                    <span>{stockProduct.unit}</span>
                  </div>
                  {stockProduct.barcode ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Código barras</span>
                      <span className="font-mono text-right wrap-anywhere">
                        {stockProduct.barcode}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      Categoria de receita
                    </span>
                    <span className="text-right wrap-anywhere">
                      {revenueCategoryDisplayName ??
                        (stockProduct.revenue_category_id ? "—" : "Padrão")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-border/60 pt-3">
                    <span className="text-muted-foreground">Em estoque</span>
                    <span className="font-semibold tabular-nums">
                      {Number(stockProduct.current_quantity).toLocaleString(
                        "pt-BR",
                      )}{" "}
                      {stockProduct.unit}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Mínimo</span>
                    <span className="tabular-nums">
                      {Number(stockProduct.min_quantity) > 0
                        ? `${Number(stockProduct.min_quantity).toLocaleString("pt-BR")} ${stockProduct.unit}`
                        : "—"}
                    </span>
                  </div>
                  {stockProduct.last_unit_value != null &&
                    stockProduct.last_unit_value > 0 && (
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Último preço</span>
                        <span className="tabular-nums">
                          {formatCurrency(
                            Number(stockProduct.last_unit_value),
                          )}
                          /{stockProduct.unit}
                        </span>
                      </div>
                    )}
                  <div className="flex justify-between gap-3 border-t border-border/60 pt-3">
                    <span className="text-muted-foreground">Status</span>
                    <span>
                      {stockProduct.is_active !== false ? (
                        <Badge variant="secondary">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <PowerOff className="h-3 w-3" />
                          Inativo
                        </Badge>
                      )}
                    </span>
                  </div>
                  {stockProduct.min_quantity > 0 &&
                    stockProduct.current_quantity <= stockProduct.min_quantity && (
                      <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span className="text-xs font-medium">
                          Estoque no ou abaixo do mínimo
                        </span>
                      </div>
                    )}
                </div>
              </div>
              <SheetFooter className="mt-auto flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={closeStockSheet}
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    syncStockFormFromProduct(stockProduct);
                    setProductSheetView("edit");
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar
                </Button>
              </SheetFooter>
            </>
          )}
          {stockProduct && productSheetView === "edit" && (
            <>
              <SheetHeader>
                <SheetTitle>Editar produto</SheetTitle>
                <SheetDescription>
                  Ajuste nome, SKU, unidade, categoria de receita, estoque e status.
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto py-6">
                <div>
                  <Label>Nome</Label>
                  <Input
                    value={stockName}
                    onChange={(e) => setStockName(e.target.value)}
                    placeholder="Nome do produto"
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>Código (SKU)</Label>
                  <Input
                    value={stockSku}
                    onChange={(e) => setStockSku(e.target.value)}
                    placeholder="Opcional"
                    className="mt-2 font-mono"
                  />
                </div>
                <div>
                  <Label>Código de barras</Label>
                  <Input
                    value={stockBarcode}
                    onChange={(e) => setStockBarcode(e.target.value)}
                    placeholder="Opcional — EAN ou alfanumérico"
                    className="mt-2 font-mono"
                  />
                </div>
                <div>
                  <Label>Unidade</Label>
                  <Select value={stockUnit} onValueChange={setStockUnit}>
                    <SelectTrigger className="mt-2">
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
                <div>
                  <Label>Categoria de receita (venda pontual)</Label>
                  <Select
                    value={
                      stockRevenueCategoryId ||
                      defaultReceitaLeafId ||
                      "__auto__"
                    }
                    onValueChange={(v) =>
                      setStockRevenueCategoryId(v === "__auto__" ? "" : v)
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Padrão do sistema" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">
                        Padrão (ex.: Vendas de produtos)
                      </SelectItem>
                      {receitaLeaves.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Usada no lançamento de receitas por venda de produto e no DRE
                  </p>
                </div>
                <div>
                  <Label>Quantidade em estoque</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value)}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>Quantidade mínima</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={stockMinQuantity}
                    onChange={(e) => setStockMinQuantity(e.target.value)}
                    className="mt-2"
                    placeholder="0 = sem alerta de estoque baixo"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Usado para alertas de estoque baixo (0 = desativado)
                  </p>
                </div>
                <div>
                  <Label>Último valor pago (opcional)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={stockLastUnitValue}
                    onChange={(e) => setStockLastUnitValue(e.target.value)}
                    placeholder="Ex.: último preço de compra por unidade"
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Referência de preço por {stockUnit}; usada no estoque e CMV
                    até haver movimentações valoradas
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <Label className="text-base">Status</Label>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {stockIsActive ? "Ativo" : "Inativo"} — itens inativos não
                      aparecem ao vincular em despesas
                    </p>
                  </div>
                  <Switch
                    checked={stockIsActive}
                    onCheckedChange={setStockIsActive}
                  />
                </div>
              </div>
              <SheetFooter className="mt-auto flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    syncStockFormFromProduct(stockProduct);
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
        <EstoqueReceitasPanel companyId={currentCompany.id} />
      )}
    </PageShell>
  );
}

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
import {
  buildChildrenMap,
  categoryPathLabel,
  isLeafCategory,
  tipoBadge,
} from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { Product } from "@/types/product";
import {
  computeRevenueTaxDeduction,
  type RevenueEntry,
  type RevenueTaxType,
} from "@/types/revenue";
import {
  parseQuantityForUnit,
  quantityInputPropsForUnit,
} from "@/lib/productQuantityInput";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import type { CompanyRevenueCategoryTaxSetting } from "@/types/revenueCategoryTax";
import { CircleDollarSign, FileText, Plus } from "lucide-react";
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
};

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
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailRevenueId, setDetailRevenueId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [entryMode, setEntryMode] = useState<"manual" | "product_sale">(
    "manual",
  );
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
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [pricingMode, setPricingMode] = useState<"unit" | "total">("unit");
  const [unitValue, setUnitValue] = useState<string>("");
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

  const tipoFilter = useMemo((): "OPERACIONAL" | "NAO_OPERACIONAL" => {
    if (entryMode === "product_sale") return "OPERACIONAL";
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

  const unitNum = parseFloat(unitValue.replace(",", ".")) || 0;

  const selectedProduct = productId
    ? products.find((p) => p.id === productId)
    : undefined;

  const qtyNum = useMemo(() => {
    if (entryMode === "product_sale" && selectedProduct) {
      return parseQuantityForUnit(quantity, selectedProduct.unit);
    }
    return parseFloat(quantity.replace(",", ".")) || 0;
  }, [entryMode, quantity, selectedProduct]);

  const computedGrossProduct = useMemo(() => {
    if (entryMode !== "product_sale") return grossNum;
    if (pricingMode === "unit") return Math.round(qtyNum * unitNum * 100) / 100;
    return grossNum;
  }, [entryMode, pricingMode, qtyNum, unitNum, grossNum]);

  const effectiveGross =
    entryMode === "product_sale" && pricingMode === "unit"
      ? computedGrossProduct
      : grossNum;

  const productTaxNet = computeRevenueTaxDeduction({
    gross: effectiveGross,
    taxType,
    taxValue: taxValNum,
  });

  const stockOk =
    entryMode !== "product_sale" ||
    !selectedProduct ||
    qtyNum <= 0 ||
    Number(selectedProduct.current_quantity) >= qtyNum;

  const quantityFieldProps = quantityInputPropsForUnit(
    entryMode === "product_sale" ? selectedProduct?.unit : undefined,
  );

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

    const { data: taxRows } = await supabase
      .from("company_revenue_category_tax_settings")
      .select("category_id, tax_type, tax_value")
      .eq("company_id", currentCompany.id);

    setCompanyCategories((catRows as CompanyCategory[]) ?? []);
    setProducts((prodRows as Product[]) ?? []);
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
  }, [tipoFilter, sheetOpen, entryMode]);

  useEffect(() => {
    if (!productId) return;
    setQuantity("1");
  }, [productId]);

  useEffect(() => {
    if (entryMode === "product_sale") {
      setRevenueType("operational");
    }
  }, [entryMode]);

  useEffect(() => {
    if (entryMode === "product_sale" && selectedProduct) {
      setTitle(`Venda — ${selectedProduct.name}`);
    }
  }, [entryMode, productId, selectedProduct?.name]);

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
    setEntryMode("manual");
    setRevenueType("operational");
    setCategoryLeafId("");
    setProductId("");
    setQuantity("1");
    setPricingMode("unit");
    setUnitValue("");
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
    if (!title.trim()) return false;
    if (entryMode === "manual" && !categoryLeafId) return false;
    if (entryMode === "product_sale" && !categoryLeafId) return false;
    if (effectiveGross <= 0) return false;
    if (entryMode === "product_sale") {
      if (!productId || qtyNum <= 0) return false;
      if (!selectedProduct?.cmv_category_id) return false;
      if (pricingMode === "unit" && unitNum < 0) return false;
      if (pricingMode === "total" && grossNum <= 0) return false;
      if (!stockOk) return false;
    }
    return true;
  }, [
    currentCompany?.id,
    entryDate,
    title,
    entryMode,
    categoryLeafId,
    effectiveGross,
    productId,
    qtyNum,
    pricingMode,
    unitNum,
    grossNum,
    stockOk,
    selectedProduct?.cmv_category_id,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany?.id || !canSubmit || saving) return;

    const grossPayload =
      entryMode === "product_sale" && pricingMode === "unit"
        ? computedGrossProduct
        : effectiveGross;

    const revenueLeaf = categoriesById.get(categoryLeafId);
    const payload: Record<string, unknown> = {
      company_id: currentCompany.id,
      entry_date: entryDate,
      title: title.trim(),
      entry_mode: entryMode,
      revenue_type:
        entryMode === "product_sale" ? "operational" : revenueType,
      category_id: revenueLeaf?.parent_id ?? null,
      subcategory_id: categoryLeafId,
      gross_amount: grossPayload,
    };

    if (entryMode === "manual") {
      payload.product_id = null;
      payload.quantity = null;
      payload.pricing_mode = null;
      payload.unit_value = null;
    } else {
      payload.product_id = productId;
      payload.quantity = qtyNum;
      payload.pricing_mode = pricingMode;
      payload.unit_value = pricingMode === "unit" ? unitNum : null;
    }

    setSaving(true);
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

  const displayTax = entryMode === "product_sale" && pricingMode === "unit"
    ? productTaxNet.taxAmount
    : taxAmount;
  const displayNet = entryMode === "product_sale" && pricingMode === "unit"
    ? productTaxNet.netAmount
    : netAmount;

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
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5" />
              Nova receita
            </SheetTitle>
            <SheetDescription>
              Lançamento por período ou venda pontual de produto com impostos e
              DRE.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-5 py-4">
            <div>
              <Label>Modo de lançamento</Label>
              <Select
                value={entryMode}
                onValueChange={(v) =>
                  setEntryMode(v as "manual" | "product_sale")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Lançamento por período</SelectItem>
                  <SelectItem value="product_sale">Venda pontual</SelectItem>
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
                    <SelectItem value="operational">Operacional</SelectItem>
                    <SelectItem value="non_operational">
                      Não operacional
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {entryMode === "product_sale" && (
              <p className="text-sm text-muted-foreground rounded-md border border-border/80 bg-muted/40 px-3 py-2">
                Venda pontual é receita{" "}
                <span className="font-medium text-foreground">operacional</span>.
                Escolha a <span className="font-medium text-foreground">categoria da venda</span> para o DRE; o produto define apenas estoque e CMV.
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
              </>
            )}

            {entryMode === "product_sale" && (
              <>
                <div>
                  <Label>Produto</Label>
                  <Select
                    value={productId || "__none__"}
                    onValueChange={(v) => {
                      const id = v === "__none__" ? "" : v;
                      setProductId(id);
                      const p = products.find((x) => x.id === id);
                      setTitle(p ? `Venda — ${p.name}` : "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Selecione</SelectItem>
                      {products
                        .filter((p) => p.is_active !== false)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            {p.sku ? ` (${p.sku})` : ""} — Est.:{" "}
                            {Number(p.current_quantity).toLocaleString("pt-BR")}{" "}
                            {p.unit}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

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
                    <Label>Preço</Label>
                    <Select
                      value={pricingMode}
                      onValueChange={(v) => setPricingMode(v as "unit" | "total")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unit">Valor unitário</SelectItem>
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
                      value={grossInput}
                      onChange={(e) => setGrossInput(e.target.value)}
                      placeholder="0,00"
                    />
                  </div>
                )}

                <div>
                  <Label>Título do lançamento</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Gerado a partir do produto"
                  />
                </div>

                {selectedProduct && !selectedProduct.cmv_category_id && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    Este produto não tem categoria de CMV no cadastro. Defina em
                    Produtos e estoque antes de lançar a venda.
                  </div>
                )}

                {selectedProduct && !stockOk && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    Estoque insuficiente. Disponível:{" "}
                    {Number(selectedProduct.current_quantity).toLocaleString(
                      "pt-BR",
                    )}{" "}
                    {selectedProduct.unit}.
                  </div>
                )}
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
                  placeholder="0,00"
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
                  Selecione a categoria de receita para exibir a taxa aplicável.
                </p>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm space-y-1.5">
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

            <SheetFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
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

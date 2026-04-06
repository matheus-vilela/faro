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
  parseQuantityForUnit,
  quantityInputPropsForUnit,
} from "@/lib/productQuantityInput";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { Product } from "@/types/product";
import {
  computeRevenueTaxDeduction,
  type RevenueEntry,
  type RevenueTaxType,
} from "@/types/revenue";
import { CircleDollarSign, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const REVENUE_TYPE_LABEL: Record<string, string> = {
  operational: "Operacional",
  non_operational: "Não operacional",
};

const ENTRY_MODE_LABEL: Record<string, string> = {
  manual: "Manual",
  product_sale: "Venda de produto",
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
  const [loading, setLoading] = useState(false);

  const [detailEditMode, setDetailEditMode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [entryMode, setEntryMode] = useState<"manual" | "product_sale">(
    "manual",
  );
  const [revenueType, setRevenueType] = useState<
    "operational" | "non_operational"
  >("operational");
  const [entryDate, setEntryDate] = useState("");
  const [title, setTitle] = useState("");
  const [categoryLeafId, setCategoryLeafId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [pricingMode, setPricingMode] = useState<"unit" | "total">("unit");
  const [unitValue, setUnitValue] = useState("");
  const [grossInput, setGrossInput] = useState("");
  const [taxType, setTaxType] = useState<RevenueTaxType>("percentage");
  const [taxValue, setTaxValue] = useState("0");

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const childrenMap = useMemo(
    () => buildChildrenMap(companyCategories),
    [companyCategories],
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

  const load = useCallback(async () => {
    if (!revenueEntryId || !companyId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    const [entryRes, catRes, prodRes] = await Promise.all([
      supabase.from("revenue_entries").select("*").eq("id", revenueEntryId).single(),
      supabase
        .from("company_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("ordem", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("products").select("*").eq("company_id", companyId).order("name"),
    ]);
    setLoading(false);

    if (entryRes.error || !entryRes.data) {
      console.error(entryRes.error);
      toast.error("Não foi possível carregar a receita.");
      setDetail(null);
      return;
    }

    setDetail(entryRes.data as RevenueEntry);
    setCompanyCategories((catRes.data as CompanyCategory[]) ?? []);
    setProducts((prodRes.data as Product[]) ?? []);
  }, [revenueEntryId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!revenueEntryId) {
      setDetail(null);
      setDetailEditMode(false);
    }
  }, [revenueEntryId]);

  useEffect(() => {
    if (entryMode === "product_sale") {
      setRevenueType("operational");
    }
  }, [entryMode]);

  const startEdit = () => {
    if (!detail) return;
    setEntryMode(detail.entry_mode);
    setRevenueType(detail.revenue_type);
    setEntryDate(detail.entry_date.slice(0, 10));
    setTitle(detail.title);
    setCategoryLeafId(detail.subcategory_id);
    setProductId(detail.product_id ?? "");
    setQuantity(
      detail.quantity != null ? String(detail.quantity) : "1",
    );
    setPricingMode(detail.pricing_mode ?? "unit");
    setUnitValue(
      detail.unit_value != null ? String(detail.unit_value) : "",
    );
    setGrossInput(String(detail.gross_amount));
    setTaxType(detail.tax_type);
    setTaxValue(String(detail.tax_value));
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
    companyId,
    detail,
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

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !detail || !canSubmit || editSaving) return;

    const grossPayload =
      entryMode === "product_sale" && pricingMode === "unit"
        ? computedGrossProduct
        : effectiveGross;

    const revenueLeaf = categoriesById.get(categoryLeafId);
    const payload: Record<string, unknown> = {
      entry_id: detail.id,
      company_id: companyId,
      entry_date: entryDate,
      title: title.trim(),
      entry_mode: entryMode,
      revenue_type: entryMode === "product_sale" ? "operational" : revenueType,
      category_id: revenueLeaf?.parent_id ?? null,
      subcategory_id: categoryLeafId,
      gross_amount: grossPayload,
      tax_type: taxType,
      tax_value: taxValNum,
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

    toast.success("Receita atualizada.");
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
    toast.success("Receita excluída.");
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
    entryMode === "product_sale" && pricingMode === "unit"
      ? productTaxNet.taxAmount
      : taxAmount;
  const displayNet =
    entryMode === "product_sale" && pricingMode === "unit"
      ? productTaxNet.netAmount
      : netAmount;

  const productNameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );

  if (!companyId) return null;

  return (
    <>
      <Sheet open={!!revenueEntryId} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {loading && (
            <p className="text-sm text-muted-foreground py-8">Carregando…</p>
          )}
          {!loading && detail && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between pr-8">
                  <SheetTitle>
                    {detailEditMode ? "Editar receita" : "Dados da receita"}
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
                  <span className="font-medium text-foreground">{detail.title}</span>
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
                      A <span className="font-medium text-foreground">categoria da venda</span> classifica a receita no DRE; o produto define estoque e CMV.
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
                            onValueChange={(v) =>
                              setPricingMode(v as "unit" | "total")
                            }
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
                      {selectedProduct && !selectedProduct.cmv_category_id && (
                        <div
                          role="alert"
                          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                        >
                          Este produto não tem categoria de CMV no cadastro. Defina em
                          Produtos e estoque antes de salvar.
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
                        required
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Tipo de taxa / imposto</Label>
                      <Select
                        value={taxType}
                        onValueChange={(v) => setTaxType(v as RevenueTaxType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">Percentual (%)</SelectItem>
                          <SelectItem value="currency">Valor em reais (R$)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>
                        {taxType === "percentage"
                          ? "Percentual (%)"
                          : "Valor da taxa (R$)"}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={taxValue}
                        onChange={(e) => setTaxValue(e.target.value)}
                      />
                    </div>
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
                        {categoryPathLabel(detail.subcategory_id, categoriesById)}
                      </span>
                    </div>
                    {detail.entry_mode === "product_sale" && detail.product_id ? (
                      <div>
                        <span className="text-muted-foreground">Produto:</span>{" "}
                        {productNameById.get(detail.product_id) ?? detail.product_id}
                        {detail.quantity != null ? (
                          <>
                            {" "}
                            · {String(detail.quantity)}{" "}
                            {products.find((p) => p.id === detail.product_id)?.unit ?? ""}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {categoriesById.get(detail.subcategory_id) ? (
                      <div>
                        <Badge variant="outline">
                          {tipoBadge(categoriesById.get(detail.subcategory_id)!)}
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
                      <span className="text-muted-foreground">Taxas / deduções</span>
                      <span>- {formatCurrency(Number(detail.tax_amount))}</span>
                    </div>
                    <div className="flex justify-between gap-2 font-medium border-t border-border/60 pt-2">
                      <span>Valor líquido</span>
                      <span>{formatCurrency(Number(detail.net_amount))}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleDollarSign className="h-4 w-4 shrink-0" />
                    <span>
                      Lançamento reconhecido no DRE pelos boletos a receber vinculados
                      (competência pela data da receita).
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
            <DialogTitle>Excluir receita</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta receita? Os boletos a receber
              vinculados serão removidos. Em venda de produto, a quantidade
              voltará ao estoque.
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

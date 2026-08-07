import { ProductUnitPickerWithConversion } from "@/components/products/ProductUnitPickerWithConversion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import { SYSTEM_PRODUCT_UNITS } from "@/lib/companyUnits/systemUnits";
import { normalizeInvoiceProductLabel } from "@/lib/productImport/canonicalName";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import { parseProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import {
  loadProductUnitConversions,
  persistProductUnitConversions,
} from "@/lib/productUnitConversionsService";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  PackageCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ItemStatus = "received" | "partial" | "not_received";

type ReviewItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_value: number;
  product_id: string | null;
  invoice_unit: string | null;
  stock_quantity: number | null;
  stock_added: boolean;
  import_nature: string | null;
  import_stock_resolution: string | null;
  resolved_entry_breakdown_recipe_id: string | null;
  import_pending_resolution: boolean | null;
  import_confidence_0_1: number | null;
  import_engine_suggestion: string | null;
};

type ReviewHeader = {
  recebimentoId: string;
  expenseId: string;
  status: "pending" | "received";
  supplierName: string;
  invoiceNumber: string | null;
  companyId: string;
};

type RecipeOption = { id: string; name: string };

type ItemStatusRow = {
  expense_item_id: string;
  status: ItemStatus;
  quantity_received?: number | null;
};

export type RecebimentoReviewPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID do recebimento a revisar. */
  recebimentoId: string | null;
  companyId: string | null;
  onChanged?: () => void;
};

function statusLabel(s: ItemStatus | undefined): string {
  if (s === "partial") return "Parcial";
  if (s === "not_received") return "Não recebido";
  if (s === "received") return "Recebido";
  return "Aguardando";
}

export function RecebimentoReviewPanel({
  open,
  onOpenChange,
  recebimentoId,
  companyId,
  onChanged,
}: RecebimentoReviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [header, setHeader] = useState<ReviewHeader | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [itemStatuses, setItemStatuses] = useState<ItemStatusRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [conversionsByProduct, setConversionsByProduct] = useState<
    Record<string, ProductUnitConversionDraft[]>
  >({});
  const [recipesByProduct, setRecipesByProduct] = useState<
    Record<string, RecipeOption[]>
  >({});
  const [copyingLink, setCopyingLink] = useState(false);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const productSelectOptions = useMemo(
    () => products.map(productSearchOption),
    [products],
  );

  const statusByItem = useMemo(() => {
    const m = new Map<string, ItemStatusRow>();
    for (const s of itemStatuses) m.set(s.expense_item_id, s);
    return m;
  }, [itemStatuses]);

  const systemUnitCodes = useMemo(
    () => SYSTEM_PRODUCT_UNITS.map((u) => u.code),
    [],
  );

  const load = useCallback(async () => {
    if (!open || !recebimentoId || !companyId) return;
    setLoading(true);
    try {
      const { data: rec, error: recErr } = await supabase
        .from("recebimentos")
        .select(
          `
          id,
          expense_id,
          status,
          expenses (
            id,
            company_id,
            supplier_name,
            display_name,
            invoice_number,
            expense_items (
              id,
              product_name,
              quantity,
              unit_value,
              product_id,
              invoice_unit,
              stock_quantity,
              stock_added,
              import_nature,
              import_stock_resolution,
              resolved_entry_breakdown_recipe_id,
              import_pending_resolution,
              import_confidence_0_1,
              import_engine_suggestion
            )
          ),
          recebimento_item_status (
            expense_item_id,
            status,
            quantity_received
          )
        `,
        )
        .eq("id", recebimentoId)
        .maybeSingle();

      if (recErr || !rec) {
        toast.error(recErr?.message ?? "Recebimento não encontrado.");
        setHeader(null);
        setItems([]);
        return;
      }

      const exp = rec.expenses as unknown as {
        id: string;
        company_id: string;
        supplier_name: string | null;
        display_name: string | null;
        invoice_number: string | null;
        expense_items?: ReviewItem[];
      } | null;

      if (!exp || exp.company_id !== companyId) {
        toast.error("Recebimento não pertence a esta empresa.");
        setHeader(null);
        setItems([]);
        return;
      }

      setHeader({
        recebimentoId: rec.id as string,
        expenseId: exp.id,
        status: rec.status as "pending" | "received",
        supplierName:
          exp.display_name?.trim() ||
          exp.supplier_name?.trim() ||
          "Sem fornecedor",
        invoiceNumber: exp.invoice_number,
        companyId,
      });

      const lines = (exp.expense_items ?? []).map((it) => ({
        ...it,
        product_id: it.product_id ?? null,
        invoice_unit: it.invoice_unit ?? null,
        stock_quantity: it.stock_quantity ?? null,
        stock_added: !!it.stock_added,
        import_nature: it.import_nature ?? null,
        import_stock_resolution: it.import_stock_resolution ?? null,
        resolved_entry_breakdown_recipe_id:
          it.resolved_entry_breakdown_recipe_id ?? null,
        import_pending_resolution: it.import_pending_resolution ?? null,
        import_confidence_0_1: it.import_confidence_0_1 ?? null,
        import_engine_suggestion: it.import_engine_suggestion ?? null,
      }));
      setItems(lines);
      setItemStatuses(
        (rec.recebimento_item_status as ItemStatusRow[] | null) ?? [],
      );

      const [{ data: prodRows }, { data: allProdWithConv }] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, unit, unit_conversions, current_quantity, min_quantity, company_id")
          .eq("company_id", companyId)
          .order("name", { ascending: true })
          .limit(2000),
        supabase
          .from("products")
          .select("id, unit, unit_conversions")
          .eq("company_id", companyId)
          .limit(2000),
      ]);

      setProducts((prodRows as Product[]) ?? []);

      const convMap: Record<string, ProductUnitConversionDraft[]> = {};
      for (const p of allProdWithConv ?? []) {
        const drafts = parseProductUnitConversionsJson(
          p.unit_conversions,
          companyId,
          p.id as string,
        );
        if (drafts.length) convMap[p.id as string] = drafts;
      }
      setConversionsByProduct(convMap);

      const productIds = [
        ...new Set(
          lines.map((l) => l.product_id).filter((id): id is string => !!id),
        ),
      ];
      if (productIds.length > 0) {
        const { data: rcp } = await supabase
          .from("recipes")
          .select("id, name, output_product_id")
          .eq("company_id", companyId)
          .eq("recipe_type", "ENTRY_BREAKDOWN")
          .eq("active", true)
          .in("output_product_id", productIds)
          .order("name", { ascending: true });
        const byPid: Record<string, RecipeOption[]> = {};
        for (const r of rcp ?? []) {
          const pid = r.output_product_id as string | null;
          if (!pid) continue;
          if (!byPid[pid]) byPid[pid] = [];
          byPid[pid].push({ id: r.id as string, name: r.name as string });
        }
        setRecipesByProduct(byPid);
      } else {
        setRecipesByProduct({});
      }
    } finally {
      setLoading(false);
    }
  }, [open, recebimentoId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allowedUnitsForProduct = useCallback(
    (productId: string): string[] => {
      const product = productById.get(productId);
      if (!product) return systemUnitCodes;
      const base = product.unit;
      const allowed = new Set<string>([base, ...systemUnitCodes]);
      const convs = conversionsByProduct[productId] ?? [];
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
    [conversionsByProduct, productById, systemUnitCodes],
  );

  const toStockQty = useCallback(
    (productId: string, qty: number, fromUnit: string): number | null => {
      const product = productById.get(productId);
      if (!product) return null;
      const convs = (conversionsByProduct[productId] ?? []).map((r) => ({
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

  const copyOperadorLink = async () => {
    if (!header) return;
    setCopyingLink(true);
    const { data: shortSlug, error } = await supabase.rpc(
      "ensure_recebimento_short_slug",
      { p_recebimento_id: header.recebimentoId },
    );
    setCopyingLink(false);
    if (error || !shortSlug) {
      toast.error(error?.message ?? "Não foi possível gerar o link.");
      return;
    }
    const url = `${window.location.origin}/s/${shortSlug}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link do operador copiado.");
  };

  const upsertAlias = async (productName: string, productId: string) => {
    if (!companyId) return;
    const nl = normalizeInvoiceProductLabel(productName);
    if (!nl) return;
    const { error } = await supabase.from("product_invoice_line_aliases").upsert(
      {
        company_id: companyId,
        normalized_label: nl,
        product_id: productId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,normalized_label" },
    );
    if (error) {
      console.warn("[RecebimentoReviewPanel] alias upsert:", error.message);
    }
  };

  const saveItemLinkAndUnit = async (
    item: ReviewItem,
    next: {
      productId: string | null;
      invoiceUnit: string | null;
      stockResolution: string | null;
      recipeId: string | null;
    },
  ) => {
    setSavingId(item.id);
    try {
      const productId = next.productId;
      const invoiceUnit = next.invoiceUnit?.trim() || null;
      const stockQty =
        productId && invoiceUnit
          ? toStockQty(productId, Number(item.quantity), invoiceUnit)
          : null;

      const { error: upErr } = await supabase
        .from("expense_items")
        .update({
          product_id: productId,
          invoice_unit: invoiceUnit,
          stock_quantity: stockQty,
          import_pending_resolution: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (upErr) throw upErr;

      if (productId) {
        await upsertAlias(item.product_name, productId);
      }

      const resolution = next.stockResolution ?? "DIRECT";
      const nature =
        resolution === "EXPLODE_BY_RECIPE" ? "INSUMO" : "ESTOQUE_DIRETO";
      const { data: resData, error: resErr } = await supabase.rpc(
        "update_expense_item_import_resolution",
        {
          p_expense_item_id: item.id,
          p_import_stock_resolution: resolution,
          p_resolved_recipe_id:
            resolution === "EXPLODE_BY_RECIPE" ? next.recipeId : null,
          p_target_product_id: productId,
          p_import_nature: nature,
          p_import_engine_suggestion: "STAFF_REVIEW_PANEL",
          p_import_pending_resolution: false,
        },
      );
      if (resErr) throw resErr;
      const out = resData as { ok?: boolean; error?: string } | null;
      if (out && out.ok === false) {
        throw new Error(out.error ?? "Falha ao salvar entrada.");
      }

      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? {
                ...it,
                product_id: productId,
                invoice_unit: invoiceUnit,
                stock_quantity: stockQty,
                import_pending_resolution: false,
                import_stock_resolution: resolution,
                resolved_entry_breakdown_recipe_id:
                  resolution === "EXPLODE_BY_RECIPE" ? next.recipeId : null,
                import_nature: nature,
              }
            : it,
        ),
      );
      toast.success("Item atualizado.");
      onChanged?.();

      if (productId && !recipesByProduct[productId]) {
        const { data: rcp } = await supabase
          .from("recipes")
          .select("id, name, output_product_id")
          .eq("company_id", companyId!)
          .eq("recipe_type", "ENTRY_BREAKDOWN")
          .eq("active", true)
          .eq("output_product_id", productId)
          .order("name", { ascending: true });
        setRecipesByProduct((prev) => ({
          ...prev,
          [productId]: (rcp ?? []).map((r) => ({
            id: r.id as string,
            name: r.name as string,
          })),
        }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar item.");
    } finally {
      setSavingId(null);
    }
  };

  const handleConversionsChange = async (
    productId: string,
    next: ProductUnitConversionDraft[],
  ) => {
    if (!companyId) return;
    const result = await persistProductUnitConversions(
      companyId,
      productId,
      next,
    );
    if (!result.ok) {
      toast.error(result.error ?? "Erro ao salvar conversão.");
      return;
    }
    const { rows } = await loadProductUnitConversions(companyId, productId);
    setConversionsByProduct((prev) => ({ ...prev, [productId]: rows }));
    toast.success("Conversões do produto atualizadas.");

    // Recalcula stock_quantity dos itens deste produto com unidade definida
    const product = productById.get(productId);
    if (!product) return;
    for (const it of items) {
      if (it.product_id !== productId || !it.invoice_unit) continue;
      const stockQty = toStockQty(
        productId,
        Number(it.quantity),
        it.invoice_unit,
      );
      // toStockQty uses stale conversions — recompute with `rows`
      const convs = rows.map((r) => ({
        primary_unit_code: r.primary_unit_code,
        secondary_unit_code: r.secondary_unit_code,
        primary_qty: Number(r.primary_qty),
        secondary_qty: Number(r.secondary_qty),
      }));
      const raw = convertQuantityForProduct(
        Number(it.quantity),
        it.invoice_unit,
        product.unit,
        product.unit,
        convs,
      );
      const qty = raw == null ? null : roundHubQuantityForStock(raw);
      await supabase
        .from("expense_items")
        .update({ stock_quantity: qty })
        .eq("id", it.id);
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id ? { ...x, stock_quantity: qty } : x,
        ),
      );
      void stockQty;
    }
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "flex h-[min(96vh,920px)] w-[min(96vw,1200px)] max-w-none translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-none",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
            <PackageCheck className="h-5 w-5 shrink-0" />
            Revisão do recebimento
            {header?.status === "received" ? (
              <Badge variant="default">Confirmado</Badge>
            ) : (
              <Badge variant="secondary">Pendente</Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {header
              ? `${header.supplierName}${
                  header.invoiceNumber ? ` · NF ${header.invoiceNumber}` : ""
                }`
              : "Carregando…"}
          </DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!header || copyingLink}
              onClick={() => void copyOperadorLink()}
            >
              {copyingLink ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copiar link do operador
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando itens…
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">Nenhum item nesta nota.</p>
          ) : (
            <div className="space-y-4">
              {items.map((it) => {
                const productId = it.product_id;
                const product = productId
                  ? productById.get(productId)
                  : undefined;
                const confStatus = statusByItem.get(it.id);
                const recipes = productId
                  ? (recipesByProduct[productId] ?? [])
                  : [];
                const saving = savingId === it.id;
                const needsAttention =
                  !productId ||
                  it.import_pending_resolution === true ||
                  (productId &&
                    it.invoice_unit &&
                    it.stock_quantity == null);

                return (
                  <div
                    key={it.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-sm",
                      needsAttention &&
                        "border-amber-500/40 ring-1 ring-amber-500/15",
                    )}
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-lg font-semibold leading-snug">
                          {it.product_name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Qtd na NF:{" "}
                          <span className="font-medium text-foreground tabular-nums">
                            {Number(it.quantity)}
                          </span>
                          {" · "}
                          Confirmação:{" "}
                          <span className="font-medium text-foreground">
                            {statusLabel(confStatus?.status)}
                            {confStatus?.status === "partial" &&
                            confStatus.quantity_received != null
                              ? ` (${confStatus.quantity_received})`
                              : ""}
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {it.import_pending_resolution && (
                          <Badge
                            variant="outline"
                            className="border-amber-600/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
                          >
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            Revisão pendente
                          </Badge>
                        )}
                        {it.import_confidence_0_1 != null && (
                          <Badge variant="outline" className="text-[11px]">
                            Confiança{" "}
                            {Math.round(Number(it.import_confidence_0_1) * 100)}
                            %
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Produto vinculado</Label>
                        <SearchSelect
                          value={productId ?? "__none__"}
                          disabled={saving}
                          onValueChange={(v) => {
                            const nextPid = v === "__none__" ? null : v;
                            const nextUnit =
                              nextPid && productById.get(nextPid)
                                ? it.invoice_unit ??
                                  productById.get(nextPid)!.unit
                                : null;
                            void saveItemLinkAndUnit(it, {
                              productId: nextPid,
                              invoiceUnit: nextUnit,
                              stockResolution:
                                it.import_stock_resolution ?? "DIRECT",
                              recipeId: it.resolved_entry_breakdown_recipe_id,
                            });
                          }}
                          options={productSelectOptions}
                          leadingOptions={[
                            { value: "__none__", label: "Não vincular" },
                          ]}
                          placeholder="Não vincular"
                          searchPlaceholder="Buscar produto…"
                          emptyMessage="Nenhum produto encontrado."
                          listMaxHeightClassName="max-h-[min(50vh,320px)]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Entrada no estoque</Label>
                        <Select
                          value={it.import_stock_resolution ?? "DIRECT"}
                          disabled={saving || !productId}
                          onValueChange={(v) => {
                            void saveItemLinkAndUnit(it, {
                              productId,
                              invoiceUnit: it.invoice_unit,
                              stockResolution: v,
                              recipeId:
                                v === "EXPLODE_BY_RECIPE"
                                  ? it.resolved_entry_breakdown_recipe_id ??
                                    recipes[0]?.id ??
                                    null
                                  : null,
                            });
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DIRECT">
                              Entrada direta
                            </SelectItem>
                            <SelectItem value="EXPLODE_BY_RECIPE">
                              Explodir por receita
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {it.import_stock_resolution === "EXPLODE_BY_RECIPE" && (
                          <SearchSelect
                            value={
                              it.resolved_entry_breakdown_recipe_id ??
                              "__none__"
                            }
                            disabled={saving || recipes.length === 0}
                            onValueChange={(v) => {
                              void saveItemLinkAndUnit(it, {
                                productId,
                                invoiceUnit: it.invoice_unit,
                                stockResolution: "EXPLODE_BY_RECIPE",
                                recipeId: v === "__none__" ? null : v,
                              });
                            }}
                            options={recipes.map((r) => ({
                              value: r.id,
                              label: r.name,
                            }))}
                            leadingOptions={[
                              { value: "__none__", label: "Sem receita" },
                            ]}
                            placeholder="Receita de entrada"
                            searchPlaceholder="Buscar receita…"
                            emptyMessage="Nenhuma receita encontrada."
                          />
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Unidade da NF → estoque</Label>
                        {productId && product ? (
                          <>
                            <ProductUnitPickerWithConversion
                              companyId={companyId!}
                              stockUnitCode={product.unit}
                              hubUnitCode={product.unit}
                              unitCodes={allowedUnitsForProduct(productId)}
                              value={it.invoice_unit ?? product.unit}
                              onValueChange={(code) => {
                                void saveItemLinkAndUnit(it, {
                                  productId,
                                  invoiceUnit: code,
                                  stockResolution:
                                    it.import_stock_resolution ?? "DIRECT",
                                  recipeId:
                                    it.resolved_entry_breakdown_recipe_id,
                                });
                              }}
                              conversions={
                                conversionsByProduct[productId] ?? []
                              }
                              onConversionsChange={(next) =>
                                handleConversionsChange(productId, next)
                              }
                              disabled={saving}
                              placeholder="Unidade da NF"
                            />
                            <p className="text-xs text-muted-foreground">
                              Estoque:{" "}
                              <span className="font-medium text-foreground tabular-nums">
                                {it.stock_quantity != null
                                  ? `${it.stock_quantity} ${product.unit}`
                                  : "— (defina conversão)"}
                              </span>
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Vincule um produto para definir a conversão.
                          </p>
                        )}
                      </div>
                    </div>

                    {saving && (
                      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Salvando…
                      </p>
                    )}
                    {!saving && productId && it.invoice_unit && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        Vínculo e conversão prontos
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

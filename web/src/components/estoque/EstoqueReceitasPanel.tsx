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
import { ProductUnitConversionQuickAdd } from "@/components/products/ProductUnitConversionQuickAdd";
import { convertQuantityForProduct } from "@/lib/companyUnits/convert";
import { getAllowedUnitsForProductHub } from "@/lib/companyUnits/productAllowedUnits";
import {
  persistProductUnitConversions,
  prepareProductUnitConversionsForPersist,
} from "@/lib/productUnitConversionsService";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  ChefHat,
  ChevronsUpDown,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type IngRow = { product_id: string; quantity: string; unit_code: string };

type RecipeRow = {
  id: string;
  name: string;
  batch_yield: number;
  active: boolean;
  output_product_id: string | null;
  recipe_ingredients: {
    id: string;
    product_id: string;
    quantity: number;
    input_quantity?: number | null;
    input_unit_code?: string | null;
    products: { name: string; unit: string } | null;
  }[];
};

function ProductPicker({
  products,
  value,
  onChange,
  placeholder = "Produto",
}: {
  products: Product[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);
  const selected = products.find((p) => p.id === value);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products;
    return products.filter((p) => p.name.toLowerCase().includes(t));
  }, [products, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto..."
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                value === p.id && "bg-accent/80",
              )}
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
            >
              {p.name}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type IngredientEditorProps = {
  companyId: string;
  products: Product[];
  productById: Map<string, Product>;
  ings: IngRow[];
  setIngs: React.Dispatch<React.SetStateAction<IngRow[]>>;
  allowedUnitsForProduct: (productId: string) => string[];
  conversionsByProduct: Map<string, ProductUnitConversionDraft[]>;
  handleIngredientConversionsChange: (
    productId: string,
    next: ProductUnitConversionDraft[],
  ) => Promise<void>;
  toBaseQty: (productId: string, qty: number, fromUnit: string) => number | null;
  fromBaseQty: (productId: string, qty: number, toUnit: string) => number | null;
  formatQtyHint: (value: number) => string;
};

function RecipeIngredientsAddPanel({
  companyId,
  products,
  productById,
  ings,
  setIngs,
  allowedUnitsForProduct,
  conversionsByProduct,
  handleIngredientConversionsChange,
  toBaseQty,
  fromBaseQty,
  formatQtyHint,
}: IngredientEditorProps) {
  const [draftProductId, setDraftProductId] = useState("");
  const [draftUnitCode, setDraftUnitCode] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("1");

  const draftProduct = draftProductId ? productById.get(draftProductId) : null;
  const draftUnits = draftProductId
    ? allowedUnitsForProduct(draftProductId)
    : [];

  useEffect(() => {
    if (!draftProductId) {
      setDraftUnitCode("");
      return;
    }
    const p = productById.get(draftProductId);
    if (p) {
      setDraftUnitCode(p.unit.trim().toLowerCase());
    }
  }, [draftProductId, productById]);

  const listedIngs = useMemo(
    () => ings.filter((r) => r.product_id && r.unit_code.trim()),
    [ings],
  );

  const addIngredient = () => {
    const pid = draftProductId.trim();
    if (!pid) {
      toast.error("Selecione um produto.");
      return;
    }
    const unit = draftUnitCode.trim().toLowerCase();
    if (!unit) {
      toast.error("Selecione a unidade.");
      return;
    }
    const parsed = parseFloat(draftQuantity.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Informe a quantidade por porção.");
      return;
    }
    const allowed = allowedUnitsForProduct(pid).map((u) => u.trim().toLowerCase());
    if (!allowed.includes(unit)) {
      toast.error("Selecione uma unidade válida para o produto.");
      return;
    }
    const baseQty = toBaseQty(pid, parsed, unit);
    if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
      toast.error("Não foi possível converter a unidade. Cadastre uma conversão.");
      return;
    }
    if (listedIngs.some((r) => r.product_id === pid)) {
      toast.error("Este produto já está na ficha. Remova-o antes de adicionar de novo.");
      return;
    }

    setIngs((prev) => [
      ...prev,
      {
        product_id: pid,
        quantity: String(parsed),
        unit_code: unit,
      },
    ]);
    setDraftQuantity("1");
    toast.success("Ingrediente adicionado à ficha.");
  };

  const draftConversionHint = (() => {
    if (!draftProduct || !draftUnitCode) return null;
    const isBase =
      draftUnitCode.trim().toLowerCase() ===
      draftProduct.unit.trim().toLowerCase();
    if (isBase) {
      return (
        <p className="text-[11px] text-muted-foreground">
          Quantidade na unidade de estoque ({systemUnitLabel(draftProduct.unit)}).
        </p>
      );
    }
    const oneInSelected = fromBaseQty(draftProductId, 1, draftUnitCode);
    if (oneInSelected == null) {
      return (
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          Falta conversão para {systemUnitLabel(draftUnitCode)}. Use «Cadastrar
          conversão» abaixo.
        </p>
      );
    }
    return (
      <p className="text-[11px] text-muted-foreground">
        {formatQtyHint(oneInSelected)} {systemUnitLabel(draftUnitCode)} equivalem a 1{" "}
        {systemUnitLabel(draftProduct.unit)}.
      </p>
    );
  })();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Adicionar produto</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Escolha o insumo, a unidade e quanto entra em cada porção vendida (1 unidade
            da ficha).
          </p>
        </div>

        <div className="space-y-2">
          <Label>Produto</Label>
          <ProductPicker
            products={products}
            value={draftProductId}
            onChange={setDraftProductId}
            placeholder="Selecionar produto"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select
              value={draftUnitCode || "__"}
              onValueChange={(v) => setDraftUnitCode(v === "__" ? "" : v)}
              disabled={!draftProductId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__">—</SelectItem>
                {draftUnits.map((u) => (
                  <SelectItem key={u} value={u}>
                    {systemUnitLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draftProductId && draftProduct ? (
              <ProductUnitConversionQuickAdd
                companyId={companyId}
                stockUnitCode={draftProduct.unit}
                conversions={conversionsByProduct.get(draftProductId) ?? []}
                onConversionsChange={(next) =>
                  void handleIngredientConversionsChange(draftProductId, next)
                }
                onSecondaryUnitAdded={(code) => setDraftUnitCode(code)}
                className="mt-1.5 h-8 w-full text-xs"
              />
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Quantidade por porção</Label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="Ex.: 100"
              value={draftQuantity}
              onChange={(e) => setDraftQuantity(e.target.value)}
              disabled={!draftProductId}
            />
          </div>
        </div>

        {draftConversionHint}

        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={addIngredient}
          disabled={!draftProductId}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Adicionar
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-semibold text-foreground">
          Resumo da ficha técnica
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Insumos por porção — o lote multiplica pelo rendimento ao baixar estoque.
        </p>

        {listedIngs.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhum ingrediente adicionado ainda.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {ings.map((row, rowIndex) => {
              if (!row.product_id || !row.unit_code.trim()) return null;
              const product = productById.get(row.product_id);
              return (
                <li
                  key={`${row.product_id}-${row.unit_code}-${rowIndex}`}
                  className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {product?.name ?? "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="tabular-nums font-medium text-foreground">
                        {Number(row.quantity).toLocaleString("pt-BR", {
                          maximumFractionDigits: 6,
                        })}
                      </span>{" "}
                      · {systemUnitLabel(row.unit_code)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                    aria-label="Remover ingrediente"
                    onClick={() =>
                      setIngs((prev) => prev.filter((_, j) => j !== rowIndex))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function EstoqueReceitasPanel({
  companyId,
  onStockChanged,
  prefillNewRecipeOutputProductId,
  prefillNewRecipeAutoOpen = true,
  onPrefillConsumed,
  sheetOnly = false,
  ingredientsOnly = false,
  initialOpenRecipeId,
  onSheetOpenChange,
}: {
  companyId: string;
  onStockChanged?: () => void;
  /** Produto-alvo para vincular à ficha (saída em ficha nova ou saída/ingrediente em ficha existente). */
  prefillNewRecipeOutputProductId?: string | null;
  /**
   * Se true (padrão), abre o sheet de nova receita assim que o produto estiver carregado (ex.: deep link em Produtos).
   * Se false, só define o contexto de vínculo: o utilizador escolhe ficha na lista ou “Nova ficha técnica”.
   */
  prefillNewRecipeAutoOpen?: boolean;
  /** Chamado após aplicar o preenchimento para limpar query string na URL. */
  onPrefillConsumed?: () => void;
  /** Só renderiza o sheet lateral (ex.: dashboard EPOC). */
  sheetOnly?: boolean;
  /** Sheet limitado a ingredientes; nome/rendimento/saída ficam ocultos. */
  ingredientsOnly?: boolean;
  /** Abre esta receita no sheet após carregar o catálogo. */
  initialOpenRecipeId?: string | null;
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [productConversions, setProductConversions] = useState<
    ProductUnitConversionDraft[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<"summary" | "edit">("edit");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [batchYield, setBatchYield] = useState("1");
  const [outputId, setOutputId] = useState<string>("");
  const [ings, setIngs] = useState<IngRow[]>([]);
  const [consumeRecipe, setConsumeRecipe] = useState<string>("");
  const [portions, setPortions] = useState("1");
  const [consuming, setConsuming] = useState(false);
  const [linkContextProductId, setLinkContextProductId] = useState<string | null>(null);
  const prefillHandledRef = useRef(false);
  const initialRecipeOpenedRef = useRef<string | null>(null);

  useEffect(() => {
    prefillHandledRef.current = false;
    initialRecipeOpenedRef.current = null;
  }, [companyId, prefillNewRecipeOutputProductId, initialOpenRecipeId]);

  useEffect(() => {
    const pid = prefillNewRecipeOutputProductId?.trim();
    if (!pid) {
      if (!prefillNewRecipeAutoOpen) setLinkContextProductId(null);
      return;
    }
    if (loading) return;
    const match = products.find((p) => p.id === pid);
    if (!match) return;

    if (!prefillNewRecipeAutoOpen) {
      setLinkContextProductId(pid);
      return;
    }

    if (prefillHandledRef.current) return;
    prefillHandledRef.current = true;
    setEditingRecipeId(null);
    setSheetMode("edit");
    const base = match.name.trim();
    setName(base ? `${base} — ficha` : "Nova ficha técnica");
    setBatchYield("1");
    setOutputId(pid);
    setIngs([]);
    setSheetOpen(true);
    toast.message("Defina os insumos e salve a receita quando estiver pronto.");
    onPrefillConsumed?.();
  }, [
    prefillNewRecipeOutputProductId,
    prefillNewRecipeAutoOpen,
    products,
    loading,
    onPrefillConsumed,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, r, c] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("name"),
      supabase
        .from("recipes")
        .select(
          "id, name, batch_yield, active, output_product_id, recipe_ingredients(id, product_id, quantity, input_quantity, input_unit_code, products(name, unit))",
        )
        .eq("company_id", companyId)
        .order("name"),
      supabase.from("product_unit_conversions").select("*").eq("company_id", companyId),
    ]);
    setLoading(false);
    setProducts((p.data ?? []) as Product[]);
    setRecipes((r.data ?? []) as unknown as RecipeRow[]);
    setProductConversions((c.data ?? []) as ProductUnitConversionDraft[]);
  }, [companyId]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const openEditRecipe = useCallback(
    (r: RecipeRow, linkProductId?: string | null) => {
      const pending = linkProductId?.trim() ?? "";
      setEditingRecipeId(r.id);
      setName(r.name);
      setBatchYield(String(r.batch_yield));
      let nextOutput = (r.output_product_id ?? "").trim();
      let nextIngs: IngRow[] = (r.recipe_ingredients ?? []).map((i) => ({
        product_id: i.product_id,
        quantity: String(i.input_quantity ?? i.quantity),
        unit_code:
          i.input_unit_code ??
          products.find((p) => p.id === i.product_id)?.unit ??
          "",
      }));

      if (ingredientsOnly) {
        setSheetMode("edit");
      } else if (pending) {
        if (!nextOutput) {
          nextOutput = pending;
        } else if (nextOutput !== pending) {
          const alreadyIng = nextIngs.some((row) => row.product_id === pending);
          if (!alreadyIng) {
            const p = productById.get(pending);
            nextIngs = [
              ...nextIngs,
              { product_id: pending, quantity: "1", unit_code: p?.unit ?? "" },
            ];
          }
        }
        setSheetMode("edit");
      } else {
        setSheetMode("summary");
      }

      setOutputId(nextOutput);
      setIngs(nextIngs);
      setSheetOpen(true);
      onSheetOpenChange?.(true);
    },
    [ingredientsOnly, onSheetOpenChange, productById, products],
  );

  useEffect(() => {
    const rid = initialOpenRecipeId?.trim();
    if (!rid || loading) return;
    if (initialRecipeOpenedRef.current === rid) return;
    const r = recipes.find((x) => x.id === rid);
    if (!r) {
      toast.error("Ficha técnica não encontrada.");
      onSheetOpenChange?.(false);
      return;
    }
    initialRecipeOpenedRef.current = rid;
    openEditRecipe(r, null);
  }, [initialOpenRecipeId, loading, recipes, openEditRecipe, onSheetOpenChange]);

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

  const conversionCodeRowsForProduct = useCallback(
    (productId: string) => {
      const product = productById.get(productId);
      if (!product) return [];
      return (conversionsByProduct.get(productId) ?? []).map((r) => ({
        primary_unit_code: r.primary_unit_code,
        secondary_unit_code: r.secondary_unit_code,
        primary_qty: Number(r.primary_qty),
        secondary_qty: Number(r.secondary_qty),
      }));
    },
    [conversionsByProduct, productById],
  );

  const allowedUnitsForProduct = useCallback(
    (productId: string): string[] => {
      const product = productById.get(productId);
      if (!product) return [];
      return getAllowedUnitsForProductHub(
        product.unit,
        conversionCodeRowsForProduct(productId),
      );
    },
    [conversionCodeRowsForProduct, productById],
  );

  const handleIngredientConversionsChange = useCallback(
    async (productId: string, next: ProductUnitConversionDraft[]) => {
      const product = productById.get(productId);
      const hub = product?.unit?.trim() ?? next[0]?.primary_unit_code?.trim() ?? "";
      const prepared = prepareProductUnitConversionsForPersist(
        hub,
        next.map((r) => ({
          ...r,
          company_id: companyId,
          product_id: productId,
        })),
      );
      const res = await persistProductUnitConversions(
        companyId,
        productId,
        prepared,
      );
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível salvar a conversão.");
        return;
      }
      setProductConversions((prev) => {
        const others = prev.filter((r) => r.product_id !== productId);
        return [...others, ...prepared];
      });
      toast.success(
        prepared.length > next.length
          ? "Conversão salva (incluindo equivalentes em massa/volume)."
          : "Conversão salva no cadastro do produto.",
      );
    },
    [companyId, productById],
  );

  const toBaseQty = useCallback(
    (productId: string, qty: number, fromUnit: string): number | null => {
      const product = productById.get(productId);
      if (!product) return null;
      const raw = convertQuantityForProduct(
        qty,
        fromUnit,
        product.unit,
        product.unit,
        conversionCodeRowsForProduct(productId),
      );
      return raw == null ? null : roundHubQuantityForStock(raw);
    },
    [conversionCodeRowsForProduct, productById],
  );

  const fromBaseQty = useCallback(
    (productId: string, qty: number, toUnit: string): number | null => {
      const product = productById.get(productId);
      if (!product) return null;
      return convertQuantityForProduct(
        qty,
        product.unit,
        toUnit,
        product.unit,
        conversionCodeRowsForProduct(productId),
      );
    },
    [conversionCodeRowsForProduct, productById],
  );

  const formatQtyHint = (value: number) =>
    value.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const saveRecipe = async () => {
    const t = name.trim();
    if (!t) {
      toast.error("Informe o nome da receita.");
      return;
    }
    const y = parseFloat(batchYield);
    if (Number.isNaN(y) || y <= 0) {
      toast.error("Rendimento da receita inválido.");
      return;
    }
    const validIngs = ings.filter((x) => x.product_id && x.unit_code && x.quantity.trim() !== "");
    if (validIngs.length === 0) {
      toast.error("Adicione ao menos um ingrediente.");
      return;
    }

    const preparedRows: {
      recipe_id: string;
      product_id: string;
      quantity: number;
      input_quantity: number;
      input_unit_code: string;
    }[] = [];

    for (const x of validIngs) {
      const parsed = parseFloat(x.quantity.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error("Quantidade do ingrediente inválida.");
        return;
      }
      const allowedUnits = allowedUnitsForProduct(x.product_id).map((u) =>
        u.trim().toLowerCase(),
      );
      if (!allowedUnits.includes(x.unit_code.trim().toLowerCase())) {
        toast.error("Selecione uma unidade válida para o ingrediente.");
        return;
      }
      const baseQty = toBaseQty(x.product_id, parsed, x.unit_code);
      if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
        toast.error("Não foi possível converter a unidade do ingrediente.");
        return;
      }
      preparedRows.push({
        recipe_id: "",
        product_id: x.product_id,
        quantity: baseQty,
        input_quantity: parsed,
        input_unit_code: x.unit_code,
      });
    }

    setSaving(true);
    let rid = editingRecipeId;
    if (editingRecipeId) {
      const { error: upErr } = await supabase
        .from("recipes")
        .update({
          name: t,
          batch_yield: y,
          output_product_id: outputId || null,
          active: true,
        })
        .eq("id", editingRecipeId);
      if (upErr) {
        console.error(upErr);
        toast.error("Não foi possível atualizar a receita.");
        setSaving(false);
        return;
      }
      const { error: delIngErr } = await supabase
        .from("recipe_ingredients")
        .delete()
        .eq("recipe_id", editingRecipeId);
      if (delIngErr) {
        console.error(delIngErr);
        toast.error("Não foi possível atualizar os ingredientes.");
        setSaving(false);
        return;
      }
    } else {
      const { data: rec, error: re } = await supabase
        .from("recipes")
        .insert({
          company_id: companyId,
          name: t,
          batch_yield: y,
          output_product_id: outputId || null,
          active: true,
        })
        .select("id")
        .single();

      if (re || !rec?.id) {
        console.error(re);
        toast.error("Não foi possível salvar a receita.");
        setSaving(false);
        return;
      }
      rid = rec.id as string;
    }
    if (!rid) {
      toast.error("Receita inválida.");
      setSaving(false);
      return;
    }
    const rows = preparedRows.map((x) => ({
      ...x,
      recipe_id: rid,
    }));

    const { error: ie } = await supabase.from("recipe_ingredients").insert(rows);
    setSaving(false);
    if (ie) {
      console.error(ie);
      if (!editingRecipeId) {
        await supabase.from("recipes").delete().eq("id", rid);
      }
      toast.error("Falha ao salvar ingredientes.");
      return;
    }
    toast.success(
      ingredientsOnly
        ? "Insumos cadastrados."
        : editingRecipeId
          ? "Receita atualizada."
          : "Receita criada.",
    );
    setSheetOpen(false);
    onSheetOpenChange?.(false);
    setEditingRecipeId(null);
    setName("");
    setBatchYield("1");
    setOutputId("");
    setIngs([]);
    onStockChanged?.();
    void load();
  };

  const deleteRecipe = async () => {
    if (!editingRecipeId) return;
    setSaving(true);
    const { error } = await supabase.from("recipes").delete().eq("id", editingRecipeId);
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível excluir a receita.");
      return;
    }
    toast.success("Receita excluída.");
    setSheetOpen(false);
    setEditingRecipeId(null);
    setName("");
    setBatchYield("1");
    setOutputId("");
    setIngs([]);
    onStockChanged?.();
    void load();
  };

  const consume = async () => {
    if (!consumeRecipe) {
      toast.error("Selecione uma receita.");
      return;
    }
    const n = parseFloat(portions);
    if (Number.isNaN(n) || n <= 0) {
      toast.error("Informe a quantidade de porções.");
      return;
    }
    setConsuming(true);
    const { data, error } = await supabase.rpc("consume_recipe_stock", {
      p_recipe_id: consumeRecipe,
      p_portions: n,
    });
    setConsuming(false);
    const row = data as {
      ok?: boolean;
      error?: string;
      need?: number;
      have?: number;
      product_id?: string;
    };
    if (error) {
      toast.error(error.message || "Não foi possível baixar o estoque.");
      return;
    }
    if (!row?.ok) {
      if (row?.error === "forbidden") {
        toast.error("Sem permissão.");
        return;
      }
      if (row?.error === "missing_conversion") {
        toast.error(
          "Falta conversão de unidade para um ingrediente (cadastre no produto ou ajuste a unidade na receita).",
        );
        return;
      }
      if (row?.error === "insufficient_stock") {
        const need = row.need != null ? Number(row.need).toFixed(4) : "?";
        const have = row.have != null ? Number(row.have).toFixed(4) : "?";
        toast.error(`Estoque insuficiente (precisa ${need} un. de estoque; há ${have}).`);
        return;
      }
      toast.error("Não foi possível baixar o estoque (verifique saldos).");
      return;
    }
    toast.success("Estoque dos ingredientes atualizado.");
    onStockChanged?.();
    void load();
  };

  const handleSheetOpenChange = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setEditingRecipeId(null);
      onSheetOpenChange?.(false);
    } else {
      onSheetOpenChange?.(true);
    }
  };

  return (
    <div className={sheetOnly ? undefined : "space-y-6"}>
      {!sheetOnly ? (
      <>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ChefHat className="h-4 w-4" />
              Ficha Técnica
            </CardTitle>
            <CardDescription>
              Cadastre ingredientes por lote (rendimento) e depois use a baixa
              por porções para descontar insumos do estoque conforme o preparo.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const pid = linkContextProductId?.trim();
              const match = pid ? products.find((p) => p.id === pid) : undefined;
              setEditingRecipeId(null);
              setSheetMode("edit");
              if (match) {
                const base = match.name.trim();
                setName(base ? `${base} — ficha` : "Nova ficha técnica");
                setBatchYield("1");
                setOutputId(pid!);
                setIngs([]);
              } else {
                setName("");
                setBatchYield("1");
                setOutputId("");
                setIngs([]);
              }
              setSheetOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Nova ficha técnica
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {linkContextProductId ? (
            <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground">
              <span className="font-medium">Vincular produto: </span>
              <span>{productById.get(linkContextProductId)?.name ?? "—"}</span>
              <span className="text-muted-foreground">
                {" "}
                — escolha uma ficha na lista ou crie uma nova; o produto entra como saída (se a ficha
                ainda não tiver saída) ou como novo ingrediente.
              </span>
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : recipes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma ficha técnica cadastrada.
            </p>
          ) : (
            <ul className="space-y-3">
              {recipes.map((r) => (
                <li
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditRecipe(r, linkContextProductId)}
                  onKeyDown={(e) => e.key === "Enter" && openEditRecipe(r, linkContextProductId)}
                  className="cursor-pointer rounded-2xl border border-border/80 bg-gradient-to-br from-card to-muted/30 p-4 text-sm shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Rendimento base:{" "}
                        {Number(r.batch_yield).toLocaleString("pt-BR")} porção(ões)
                        {!r.active ? " · inativa" : ""}
                      </p>
                    </div>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {r.recipe_ingredients?.length ?? 0} itens
                    </span>
                  </div>
                  <ul className="mt-3 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {r.recipe_ingredients?.map((i) => (
                      <li key={i.id}>
                        {i.products?.name ?? "—"}:{" "}
                        {Number(i.input_quantity ?? i.quantity).toLocaleString("pt-BR")}{" "}
                        {i.input_unit_code ?? i.products?.unit} / lote
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Baixa por preparo</CardTitle>
          <CardDescription>
            Informe quantas porções foram produzidas; o sistema desconta os
            insumos proporcionalmente ao rendimento cadastrado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label>Ficha técnica</Label>
            <Select
              value={consumeRecipe || "__"}
              onValueChange={(v) =>
                setConsumeRecipe(v === "__" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__">—</SelectItem>
                {recipes
                  .filter((r) => r.active)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-2 sm:w-36">
            <Label>Porções</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={consuming}
            onClick={() => void consume()}
          >
            {consuming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Baixar estoque"
            )}
          </Button>
        </CardContent>
      </Card>
      </>
      ) : null}

      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl sm:max-w-lg lg:max-w-xl">
          <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
                <ChefHat className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1 space-y-1 pr-6">
                <SheetTitle className="text-xl font-semibold sm:text-2xl">
                  {ingredientsOnly
                    ? "Cadastrar insumos"
                    : editingRecipeId
                      ? sheetMode === "summary"
                        ? "Resumo da ficha técnica"
                        : "Editar ficha técnica"
                      : "Nova ficha técnica"}
                </SheetTitle>
                {ingredientsOnly && name.trim() ? (
                  <p className="text-sm text-muted-foreground">{name}</p>
                ) : null}
              </div>
              {editingRecipeId && !ingredientsOnly ? (
                <div className="flex shrink-0 gap-2">
                  {sheetMode === "summary" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSheetMode("edit")}
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Editar
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSheetMode("summary")}
                    >
                      Voltar
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void deleteRecipe()}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Excluir
                  </Button>
                </div>
              ) : null}
            </div>
          </SheetHeader>
          {editingRecipeId && sheetMode === "summary" && !ingredientsOnly ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
              <div className="space-y-4 p-6">
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Ficha técnica
                  </p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{name}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Rendimento: {Number(batchYield || 0).toLocaleString("pt-BR")} porções
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Ingredientes por porção
                  </p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {ings
                      .filter((row) => row.product_id && row.unit_code.trim())
                      .map((row, idx) => {
                        const p = products.find((x) => x.id === row.product_id);
                        return (
                          <li
                            key={`${row.product_id}-${idx}`}
                            className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                          >
                            <p className="font-medium">{p?.name ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">
                              {Number(row.quantity || 0).toLocaleString("pt-BR")}{" "}
                              · {systemUnitLabel(row.unit_code || p?.unit || "")}
                            </p>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
            <div className="space-y-4 p-6">
            {!ingredientsOnly ? (
              <>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rendimento (porções por lote)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={batchYield}
                onChange={(e) => setBatchYield(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Produto de saída (opcional)</Label>
              <div className="space-y-2">
                <ProductPicker
                  products={products}
                  value={outputId}
                  onChange={(id) => setOutputId(id)}
                  placeholder="Selecionar produto de saída"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setOutputId("")}
                >
                  Limpar seleção
                </Button>
              </div>
            </div>
              </>
            ) : null}
            <RecipeIngredientsAddPanel
              key={editingRecipeId ?? "new-recipe"}
              companyId={companyId}
              products={products}
              productById={productById}
              ings={ings}
              setIngs={setIngs}
              allowedUnitsForProduct={allowedUnitsForProduct}
              conversionsByProduct={conversionsByProduct}
              handleIngredientConversionsChange={handleIngredientConversionsChange}
              toBaseQty={toBaseQty}
              fromBaseQty={fromBaseQty}
              formatQtyHint={formatQtyHint}
            />
            </div>
          </div>
          )}
          <SheetFooter className="shrink-0 gap-2 border-t border-border bg-card px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSheetOpenChange(false)}
            >
              Cancelar
            </Button>
            {editingRecipeId && sheetMode === "summary" && !ingredientsOnly ? null : (
            <Button
              type="button"
              disabled={saving}
              onClick={() => void saveRecipe()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                ingredientsOnly
                  ? "Salvar"
                  : editingRecipeId
                    ? "Salvar alterações"
                    : "Salvar"
              )}
            </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

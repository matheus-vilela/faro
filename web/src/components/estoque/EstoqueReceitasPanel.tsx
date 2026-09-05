import { CreateProductSheet } from "@/components/CreateProductSheet";
import { RecipeMovementHistory } from "@/components/estoque/RecipeMovementHistory";
import { RecipeProducePanel } from "@/components/estoque/RecipeProducePanel";
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SECTION,
} from "@/components/products/productSheetStyles";
import { ProductUnitPickerWithConversion } from "@/components/products/ProductUnitPickerWithConversion";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { usePopoverListScrollFix } from "@/hooks/usePopoverListScrollFix";
import { useSheetListView } from "@/hooks/useSheetListView";
import { convertQuantityForProduct } from "@/lib/companyUnits/convert";
import { getAllowedUnitsForProductHub } from "@/lib/companyUnits/productAllowedUnits";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { createCatalogProduct } from "@/lib/createCatalogProduct";
import { undoProductRecipeMatch } from "@/lib/onboardingProductRecipeMatch";
import {
  isPlaceholderRecipeName,
  matchProductByTypedName,
} from "@/lib/outputProductDraft";
import {
  INTERMEDIATE_BADGE_CLASS,
  type TechnicalSheetKind,
} from "@/lib/productIntermediate";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import {
  saveProductTechnicalSheet,
  technicalSheetErrorMessage,
} from "@/lib/productTechnicalSheet";
import { flattenProductUnitConversionsDrafts } from "@/lib/productUnitConversionsJson";
import {
  persistProductUnitConversions,
  prepareProductUnitConversionsForPersist,
} from "@/lib/productUnitConversionsService";
import {
  recipeCanBeProduced,
  recipeKindFilterValue,
  recipeMatchesListFilters,
  recipeMatchingIngredientNames,
  type RecipeListKindFilter,
} from "@/lib/recipeListFilter";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import {
  ChefHat,
  ChevronsUpDown,
  Factory,
  History,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

type IngRow = { product_id: string; quantity: string; unit_code: string };

type NormalizedIngRow = {
  product_id: string;
  quantity: string;
  unit_code: string;
};

function normalizeIngsForCompare(ings: IngRow[]): NormalizedIngRow[] {
  return ings
    .filter(
      (x) => x.product_id && x.unit_code.trim() && x.quantity.trim() !== "",
    )
    .map((x) => ({
      product_id: x.product_id,
      quantity: x.quantity.replace(",", ".").trim(),
      unit_code: x.unit_code.trim().toLowerCase(),
    }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id, "pt-BR"));
}

function RecipeEditorForm({
  sheetKind,
  onSheetKindChange,
  disabled,
  ingredientsOnly,
  name,
  onNameChange,
  batchYield,
  onBatchYieldChange,
  outputId,
  onOutputIdChange,
  outputDraftName,
  onOutputDraftNameChange,
  products,
  ingredients,
}: {
  sheetKind: TechnicalSheetKind;
  onSheetKindChange: (next: TechnicalSheetKind) => void;
  disabled?: boolean;
  ingredientsOnly?: boolean;
  name: string;
  onNameChange: (value: string) => void;
  batchYield: string;
  onBatchYieldChange: (value: string) => void;
  outputId: string;
  onOutputIdChange: (id: string) => void;
  outputDraftName: string;
  onOutputDraftNameChange: (name: string) => void;
  products: Product[];
  ingredients: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <section className={PRODUCT_SHEET_SECTION}>
        <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Tipo
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          Como a ficha se comporta na venda e no estoque.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              {
                value: "sale" as const,
                title: "Ficha normal",
                description:
                  "Na venda, baixa os insumos na proporção da receita. Não se produz.",
                icon: ChefHat,
              },
              {
                value: "intermediate" as const,
                title: "Produção",
                description:
                  "Pode ser produzida: baixa insumos e entra o saldo. A venda baixa só o produto.",
                icon: Factory,
              },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = sheetKind === opt.value;
            const intermediate = opt.value === "intermediate";
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onSheetKindChange(opt.value)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition-colors disabled:opacity-60",
                  active
                    ? intermediate
                      ? "border-teal-500 bg-teal-500/10 ring-1 ring-teal-500"
                      : "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background hover:bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    active
                      ? intermediate
                        ? "bg-teal-500/15 text-teal-800 dark:text-teal-100"
                        : "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{opt.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {ingredientsOnly ? null : (
        <section className={PRODUCT_SHEET_SECTION}>
          <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Identificação
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            Nome, quanto o lote rende e o produto que sai desta ficha.
          </p>
          <div className="space-y-4">
            <div>
              <Label htmlFor="recipe-name">Nome</Label>
              <Input
                id="recipe-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                disabled={disabled}
                placeholder="Ex.: Molho de tomate"
                className={cn(PRODUCT_SHEET_INPUT, "mt-2")}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="recipe-yield">Rendimento do lote</Label>
                <Input
                  id="recipe-yield"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={batchYield}
                  onChange={(e) => onBatchYieldChange(e.target.value)}
                  disabled={disabled}
                  className={cn(PRODUCT_SHEET_INPUT, "mt-2")}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Quantas unidades essa receita produz.
                </p>
              </div>
              <div>
                <Label>
                  {sheetKind === "intermediate"
                    ? "Produto gerado"
                    : "Produto de saída"}
                </Label>
                <div className="mt-2">
                  <ProductPicker
                    products={products}
                    value={outputId}
                    onChange={(id) => {
                      onOutputIdChange(id);
                      if (id) onOutputDraftNameChange("");
                    }}
                    draftName={outputDraftName}
                    onDraftNameChange={(next) => {
                      onOutputDraftNameChange(next);
                      if (next) onOutputIdChange("");
                    }}
                    allowNamedDraft
                    placeholder={
                      sheetKind === "intermediate"
                        ? "Buscar ou informar o nome"
                        : "Buscar ou informar o nome (opcional)"
                    }
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {outputDraftName.trim()
                    ? `«${outputDraftName.trim()}» será cadastrado ao salvar a ficha.`
                    : sheetKind === "intermediate"
                      ? "É neste cadastro que entra o estoque na produção."
                      : "Busque um produto ou digite o nome de um novo."}
                </p>
                {outputId || outputDraftName.trim() ? (
                  <button
                    type="button"
                    className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => {
                      onOutputIdChange("");
                      onOutputDraftNameChange("");
                    }}
                  >
                    Remover produto
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      )}

      {ingredients}
    </div>
  );
}

function RecipeSearchMatchedIngredients({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="mt-1 min-w-0">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Contém o insumo:
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {names.map((name) => (
          <li
            key={name}
            className="truncate text-[0.65rem] text-muted-foreground"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ingsSnapshotsEqual(
  a: NormalizedIngRow[],
  b: NormalizedIngRow[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (row, i) =>
      row.product_id === b[i]!.product_id &&
      row.quantity === b[i]!.quantity &&
      row.unit_code === b[i]!.unit_code,
  );
}

export type EstoqueReceitasPanelHandle = {
  /** Pergunta ao utilizador se deseja salvar insumos não guardados antes de sair da ficha. */
  confirmLeaveIfDirty: () => Promise<"proceed" | "cancel">;
};

type RecipeRow = {
  id: string;
  name: string;
  batch_yield: number;
  active: boolean;
  recipe_type?: string | null;
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
  companyId,
  onProductCreated,
  enableCreateProduct = false,
  allowNamedDraft = false,
  draftName = "",
  onDraftNameChange,
}: {
  products: Product[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  companyId?: string;
  onProductCreated?: (product: Product) => void;
  /** Exibe «Cadastrar produto» na lista quando a busca não encontra itens. */
  enableCreateProduct?: boolean;
  /** Confirma o texto da busca como nome de um produto ainda não cadastrado. */
  allowNamedDraft?: boolean;
  draftName?: string;
  onDraftNameChange?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  usePopoverListScrollFix(open, listRef);
  const selected = products.find((p) => p.id === value);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products;
    return products.filter((p) => p.name.toLowerCase().includes(t));
  }, [products, q]);
  const searchActive = q.trim().length > 0;
  const typedName = q.trim();
  const exactTyped = allowNamedDraft
    ? matchProductByTypedName(products, typedName)
    : null;
  const showNamedDraftRow = allowNamedDraft && searchActive && !exactTyped;
  const showCreateRow = enableCreateProduct && !!companyId;
  const displayLabel = selected?.name || draftName.trim() || "";

  const confirmDraftName = (raw: string) => {
    const next = raw.trim();
    if (!next) return;
    const match = matchProductByTypedName(products, next);
    if (match) {
      onChange(match.id);
      onDraftNameChange?.("");
    } else {
      onChange("");
      onDraftNameChange?.(next);
    }
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next && !q && draftName.trim()) setQ(draftName);
          if (!next) setQ("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-between rounded-xl font-normal"
          >
            <span
              className={cn(
                "min-w-0 truncate text-left",
                !displayLabel && "text-muted-foreground",
              )}
            >
              {displayLabel
                ? draftName.trim() && !selected
                  ? `${displayLabel} (novo)`
                  : displayLabel
                : placeholder}
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
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !allowNamedDraft) return;
                  e.preventDefault();
                  if (filtered.length === 1 && !showNamedDraftRow) {
                    onChange(filtered[0]!.id);
                    onDraftNameChange?.("");
                    setOpen(false);
                    setQ("");
                    return;
                  }
                  confirmDraftName(typedName);
                }}
                placeholder={
                  allowNamedDraft
                    ? "Buscar ou informar o nome…"
                    : "Buscar produto..."
                }
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
                  onDraftNameChange?.("");
                  setOpen(false);
                  setQ("");
                }}
              >
                {p.name}
              </button>
            ))}
            {filtered.length === 0 && searchActive && !showNamedDraftRow ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Nenhum produto encontrado.
              </p>
            ) : null}
            {showNamedDraftRow ? (
              <div className="mt-1 border-t border-border p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm font-medium text-primary hover:bg-accent"
                  onClick={() => confirmDraftName(typedName)}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    Usar «{typedName}»
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · cadastra ao salvar
                    </span>
                  </span>
                </button>
              </div>
            ) : null}
            {showCreateRow ? (
              <div className="mt-1 border-t border-border p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm font-medium text-primary hover:bg-accent"
                  onClick={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    Cadastrar produto
                    {searchActive ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · «{q.trim()}»
                      </span>
                    ) : null}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      {companyId && enableCreateProduct ? (
        <CreateProductSheet
          open={createOpen}
          onOpenChange={setCreateOpen}
          companyId={companyId}
          defaultName={q.trim()}
          onSuccess={(product) => {
            onProductCreated?.(product);
            onChange(product.id);
            onDraftNameChange?.("");
            setQ("");
          }}
        />
      ) : null}
    </>
  );
}

type IngredientEditorProps = {
  companyId: string;
  products: Product[];
  productById: Map<string, Product>;
  ings: IngRow[];
  setIngs: Dispatch<SetStateAction<IngRow[]>>;
  allowedUnitsForProduct: (productId: string) => string[];
  conversionsByProduct: Map<string, ProductUnitConversionDraft[]>;
  handleIngredientConversionsChange: (
    productId: string,
    next: ProductUnitConversionDraft[],
  ) => Promise<void>;
  toBaseQty: (
    productId: string,
    qty: number,
    fromUnit: string,
  ) => number | null;
  fromBaseQty: (
    productId: string,
    qty: number,
    toUnit: string,
  ) => number | null;
  formatQtyHint: (value: number) => string;
  onProductCreated?: (product: Product) => void;
  /** Produto de saída da ficha — não aparece na lista de insumos. */
  excludeProductId?: string;
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
  onProductCreated,
  excludeProductId = "",
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
      queueMicrotask(() => setDraftUnitCode(""));
      return;
    }
    const p = productById.get(draftProductId);
    if (p) {
      queueMicrotask(() => setDraftUnitCode(p.unit.trim().toLowerCase()));
    }
  }, [draftProductId, productById]);

  const listedIngs = useMemo(
    () => ings.filter((r) => r.product_id && r.unit_code.trim()),
    [ings],
  );

  const pickerProducts = useMemo(() => {
    const excluded = excludeProductId.trim();
    if (!excluded) return products;
    return products.filter((p) => p.id !== excluded);
  }, [products, excludeProductId]);

  useEffect(() => {
    if (!draftProductId) return;
    const excluded = excludeProductId.trim();
    if (excluded && draftProductId === excluded) {
      queueMicrotask(() => setDraftProductId(""));
    }
  }, [draftProductId, excludeProductId]);

  const addIngredient = () => {
    const pid = draftProductId.trim();
    if (!pid) {
      toast.error("Selecione um produto.");
      return;
    }
    if (excludeProductId.trim() && pid === excludeProductId.trim()) {
      toast.error(
        "O produto desta ficha não pode ser adicionado como insumo de si mesmo.",
      );
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
    const allowed = allowedUnitsForProduct(pid).map((u) =>
      u.trim().toLowerCase(),
    );
    if (!allowed.includes(unit)) {
      toast.error("Selecione uma unidade válida para o produto.");
      return;
    }
    const baseQty = toBaseQty(pid, parsed, unit);
    if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
      toast.error(
        "Não foi possível converter a unidade. Cadastre uma conversão.",
      );
      return;
    }
    if (listedIngs.some((r) => r.product_id === pid)) {
      toast.error(
        "Este produto já está na ficha. Remova-o antes de adicionar de novo.",
      );
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
    // limpar o draftProductId
    setDraftProductId("");
  };

  return (
    <div className={PRODUCT_SHEET_SECTION}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Insumos
          </p>
          <p className="text-sm text-muted-foreground">
            Quanto de cada item entra em 1 receita (lote).
          </p>
        </div>
        {listedIngs.length > 0 ? (
          <Badge variant="secondary" className="h-6 shrink-0 px-2 font-normal">
            {listedIngs.length} {listedIngs.length === 1 ? "item" : "itens"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 space-y-3 rounded-xl border border-dashed border-border bg-muted/30 p-3 sm:p-4">
        <div>
          <Label>Adicionar insumo</Label>
          <div className="mt-2">
            <ProductPicker
              products={pickerProducts}
              value={draftProductId}
              onChange={setDraftProductId}
              placeholder="Selecionar produto"
              companyId={companyId}
              enableCreateProduct
              onProductCreated={onProductCreated}
            />
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-end gap-2">
          <div>
            <Label htmlFor="recipe-ing-qty">Qtd</Label>
            <Input
              id="recipe-ing-qty"
              type="text"
              inputMode="decimal"
              placeholder="1"
              value={draftQuantity}
              onChange={(e) => setDraftQuantity(e.target.value)}
              disabled={!draftProductId}
              className={cn(PRODUCT_SHEET_INPUT, "mt-2")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addIngredient();
                }
              }}
            />
          </div>
          <div className="min-w-0">
            <Label>Unidade</Label>
            <div className="mt-2">
              {draftProductId && draftProduct ? (
                <ProductUnitPickerWithConversion
                  companyId={companyId}
                  stockUnitCode={draftProduct.unit}
                  hubUnitCode={draftProduct.unit}
                  unitCodes={draftUnits}
                  value={draftUnitCode}
                  onValueChange={setDraftUnitCode}
                  conversions={conversionsByProduct.get(draftProductId) ?? []}
                  onConversionsChange={(next) =>
                    void handleIngredientConversionsChange(draftProductId, next)
                  }
                  onSecondaryUnitAdded={(code) => setDraftUnitCode(code)}
                  disabled={!draftProductId}
                  placeholder="Unidade"
                  triggerClassName="h-11 rounded-xl"
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled
                  className="h-11 w-full justify-between rounded-xl font-normal"
                >
                  <span className="text-muted-foreground">Unidade</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              )}
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl"
            aria-label="Adicionar insumo"
            onClick={addIngredient}
            disabled={!draftProductId}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {listedIngs.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
          Nenhum insumo na ficha ainda.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {ings.map((row, rowIndex) => {
            if (!row.product_id || !row.unit_code.trim()) return null;
            const product = productById.get(row.product_id);
            return (
              <li
                key={`${row.product_id}-${row.unit_code}-${rowIndex}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-3 shadow-sm"
              >
                <div className="flex h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/70 px-2">
                  <p className="tabular-nums text-sm font-semibold leading-tight text-foreground">
                    {Number(row.quantity).toLocaleString("pt-BR", {
                      maximumFractionDigits: 6,
                    })}
                  </p>
                  <p className="max-w-16 truncate text-[11px] text-muted-foreground">
                    {systemUnitLabel(row.unit_code)}
                  </p>
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {product?.name ?? "—"}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
  );
}

export const EstoqueReceitasPanel = forwardRef<
  EstoqueReceitasPanelHandle,
  {
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
    /** Renderiza o editor no fluxo (sem Sheet), ex.: coluna direita no dashboard. */
    embedInline?: boolean;
    /** Abre esta receita no sheet após carregar o catálogo. */
    initialOpenRecipeId?: string | null;
    /** Produto de saída da ficha (ex.: item EPOC) — oculto na lista de insumos. */
    contextOutputProductId?: string | null;
    onSheetOpenChange?: (open: boolean) => void;
    /**
     * Salva via RPC de ficha técnica do produto (catálogo, backfill).
     * Usado no diálogo «É ficha técnica» em Produtos.
     */
    technicalSheetOutputProductId?: string | null;
    technicalSheetKind?: TechnicalSheetKind;
    onTechnicalSheetSaved?: (
      recipeId: string | null,
      backfill?: {
        output_out_movements: number;
        ingredient_movements_created: number;
      },
    ) => void;
    /**
     * Ao abrir ficha nova (sheetOnly / auto-open), inclui este produto
     * como primeiro insumo (qty 1 na unidade do produto).
     */
    prefillIngredientProductId?: string | null;
  }
>(function EstoqueReceitasPanel(
  {
    companyId,
    onStockChanged,
    prefillNewRecipeOutputProductId,
    prefillNewRecipeAutoOpen = true,
    onPrefillConsumed,
    sheetOnly = false,
    ingredientsOnly = false,
    embedInline = false,
    initialOpenRecipeId,
    contextOutputProductId,
    onSheetOpenChange,
    technicalSheetOutputProductId,
    technicalSheetKind = "sale",
    onTechnicalSheetSaved,
    prefillIngredientProductId,
  },
  ref,
) {
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
  const [outputDraftName, setOutputDraftName] = useState("");
  const [ings, setIngs] = useState<IngRow[]>([]);
  const [sheetKind, setSheetKind] =
    useState<TechnicalSheetKind>(technicalSheetKind);
  const [listQuery, setListQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<RecipeListKindFilter>("all");
  const [detailTab, setDetailTab] = useState<
    "ficha" | "historico" | "producao"
  >("ficha");
  const listView = useSheetListView();
  const [linkContextProductId, setLinkContextProductId] = useState<
    string | null
  >(null);
  const [savedIngsSnapshot, setSavedIngsSnapshot] = useState<
    NormalizedIngRow[]
  >([]);
  const [unsavedLeaveOpen, setUnsavedLeaveOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const unsavedLeaveProceedRef = useRef<(() => void) | null>(null);
  const unsavedLeaveResolveRef = useRef<
    ((result: "proceed" | "cancel") => void) | null
  >(null);
  const prefillHandledRef = useRef(false);

  const technicalSheetPid = technicalSheetOutputProductId?.trim() ?? "";

  const isIngredientsDirty = useMemo(() => {
    if (!ingredientsOnly) return false;
    if (!editingRecipeId && !technicalSheetPid) return false;
    return !ingsSnapshotsEqual(
      normalizeIngsForCompare(ings),
      savedIngsSnapshot,
    );
  }, [
    ingredientsOnly,
    editingRecipeId,
    technicalSheetPid,
    ings,
    savedIngsSnapshot,
  ]);

  useEffect(() => {
    prefillHandledRef.current = false;
  }, [
    companyId,
    prefillNewRecipeOutputProductId,
    initialOpenRecipeId,
    technicalSheetOutputProductId,
    prefillIngredientProductId,
  ]);

  const ingredientExcludeProductId = useMemo(() => {
    for (const candidate of [
      technicalSheetPid,
      outputId.trim(),
      contextOutputProductId?.trim() ?? "",
    ]) {
      if (candidate) return candidate;
    }
    return "";
  }, [technicalSheetPid, outputId, contextOutputProductId]);

  useEffect(() => {
    if (!technicalSheetPid || loading || initialOpenRecipeId?.trim()) return;
    const match = products.find((p) => p.id === technicalSheetPid);
    if (!match) return;
    const base = match.name.trim();
    setName(base ? `${base} — ficha técnica` : "Ficha técnica");
    setBatchYield("1");
    setOutputId(technicalSheetPid);
    setOutputDraftName("");
    setSheetKind(technicalSheetKind);
    setIngs([]);
    setSavedIngsSnapshot([]);
  }, [
    technicalSheetPid,
    technicalSheetKind,
    loading,
    initialOpenRecipeId,
    products,
  ]);

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
    setOutputDraftName("");
    setIngs([]);
    setSheetKind("sale");
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

  /** Abre ficha nova com um insumo pré-selecionado (ex.: correlação compra → ficha). */
  useEffect(() => {
    const ingId = prefillIngredientProductId?.trim();
    if (!ingId) return;
    if (loading) return;
    if (initialOpenRecipeId?.trim() || technicalSheetPid) return;
    if (prefillNewRecipeOutputProductId?.trim() && prefillNewRecipeAutoOpen) {
      return;
    }
    const match = products.find((p) => p.id === ingId);
    if (!match) return;
    if (prefillHandledRef.current) return;
    prefillHandledRef.current = true;
    setEditingRecipeId(null);
    setSheetMode("edit");
    setName("");
    setBatchYield("1");
    setOutputId("");
    setOutputDraftName("");
    setSheetKind("sale");
    const unit = (match.unit ?? "un").trim() || "un";
    setIngs([
      {
        product_id: match.id,
        quantity: "1",
        unit_code: unit,
      },
    ]);
    setSavedIngsSnapshot([]);
    setSheetOpen(true);
    toast.message(
      `«${match.name}» já está como insumo. Escolha o produto de saída e complete a ficha.`,
    );
    onPrefillConsumed?.();
  }, [
    prefillIngredientProductId,
    products,
    loading,
    initialOpenRecipeId,
    technicalSheetPid,
    prefillNewRecipeOutputProductId,
    prefillNewRecipeAutoOpen,
    onPrefillConsumed,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, r] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("name"),
      supabase
        .from("recipes")
        .select(
          "id, name, batch_yield, active, output_product_id, recipe_type, recipe_ingredients(id, product_id, quantity, input_quantity, input_unit_code, products(name, unit))",
        )
        .eq("company_id", companyId)
        .order("name"),
    ]);
    setLoading(false);
    const productsList = (p.data ?? []) as Product[];
    setProducts(productsList);
    setRecipes((r.data ?? []) as unknown as RecipeRow[]);
    setProductConversions(
      flattenProductUnitConversionsDrafts(companyId, productsList),
    );
  }, [companyId]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const filteredRecipes = useMemo(
    () =>
      recipes.filter((r) =>
        recipeMatchesListFilters(
          r,
          listQuery,
          kindFilter,
          r.output_product_id
            ? productById.get(r.output_product_id)?.name
            : null,
        ),
      ),
    [recipes, listQuery, kindFilter, productById],
  );

  type RecipeSortKey = "name" | "kind" | "output" | "yield" | "ings";
  const {
    sorted: sortedRecipes,
    sortKey,
    sortAsc,
    onSort,
  } = useClientTableSort<RecipeRow, RecipeSortKey>(
    filteredRecipes,
    "name",
    (a, b, key) => {
      if (key === "kind") {
        return recipeKindFilterValue(a.recipe_type).localeCompare(
          recipeKindFilterValue(b.recipe_type),
        );
      }
      if (key === "output") {
        const an =
          (a.output_product_id && productById.get(a.output_product_id)?.name) ||
          "";
        const bn =
          (b.output_product_id && productById.get(b.output_product_id)?.name) ||
          "";
        return an.localeCompare(bn, "pt-BR");
      }
      if (key === "yield") {
        return Number(a.batch_yield) - Number(b.batch_yield);
      }
      if (key === "ings") {
        return (
          (a.recipe_ingredients?.length ?? 0) -
          (b.recipe_ingredients?.length ?? 0)
        );
      }
      return a.name.localeCompare(b.name, "pt-BR");
    },
    true,
  );

  const openEditRecipe = useCallback(
    (
      r: RecipeRow,
      linkProductId?: string | null,
      tab: "ficha" | "historico" | "producao" = "ficha",
    ) => {
      const pending = linkProductId?.trim() ?? "";
      const canProduce = recipeCanBeProduced(r.recipe_type);
      setEditingRecipeId(r.id);
      setDetailTab(tab === "producao" && !canProduce ? "ficha" : tab);
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
      } else if (embedInline && !ingredientsOnly) {
        setSheetMode("edit");
      } else {
        setSheetMode("summary");
      }

      setOutputId(nextOutput);
      setOutputDraftName("");
      setSheetKind(
        r.recipe_type === "PRODUCTION" ||
          productById.get(nextOutput)?.stock_control_type === "INTERMEDIATE"
          ? "intermediate"
          : "sale",
      );
      setIngs(nextIngs);
      setSavedIngsSnapshot(normalizeIngsForCompare(nextIngs));
      setSheetOpen(true);
      onSheetOpenChange?.(true);
    },
    [embedInline, ingredientsOnly, onSheetOpenChange, productById, products],
  );

  const proceedUnsavedLeave = useCallback(() => {
    setUnsavedLeaveOpen(false);
    unsavedLeaveResolveRef.current?.("proceed");
    unsavedLeaveResolveRef.current = null;
    const fn = unsavedLeaveProceedRef.current;
    unsavedLeaveProceedRef.current = null;
    fn?.();
  }, []);

  const cancelUnsavedLeave = useCallback(() => {
    setUnsavedLeaveOpen(false);
    unsavedLeaveResolveRef.current?.("cancel");
    unsavedLeaveResolveRef.current = null;
    unsavedLeaveProceedRef.current = null;
  }, []);

  const promptUnsavedLeave = useCallback(
    (proceed: () => void): boolean => {
      if (!isIngredientsDirty) {
        proceed();
        return true;
      }
      unsavedLeaveProceedRef.current = proceed;
      unsavedLeaveResolveRef.current = null;
      setUnsavedLeaveOpen(true);
      return false;
    },
    [isIngredientsDirty],
  );

  const confirmLeaveIfDirty = useCallback((): Promise<"proceed" | "cancel"> => {
    if (!isIngredientsDirty) return Promise.resolve("proceed");
    return new Promise((resolve) => {
      unsavedLeaveResolveRef.current = resolve;
      unsavedLeaveProceedRef.current = null;
      setUnsavedLeaveOpen(true);
    });
  }, [isIngredientsDirty]);

  useImperativeHandle(ref, () => ({ confirmLeaveIfDirty }), [
    confirmLeaveIfDirty,
  ]);

  const requestOpenEditRecipe = useCallback(
    (
      r: RecipeRow,
      linkProductId?: string | null,
      tab: "ficha" | "historico" | "producao" = "ficha",
    ) => {
      if (r.id === editingRecipeId) {
        const canProduce = recipeCanBeProduced(r.recipe_type);
        setDetailTab(tab === "producao" && !canProduce ? "ficha" : tab);
        return;
      }
      promptUnsavedLeave(() => openEditRecipe(r, linkProductId, tab));
    },
    [editingRecipeId, openEditRecipe, promptUnsavedLeave],
  );

  useEffect(() => {
    const rid = initialOpenRecipeId?.trim();
    if (!rid || loading) return;
    if (rid === editingRecipeId) return;
    const r = recipes.find((x) => x.id === rid);
    if (!r) {
      toast.error("Ficha técnica não encontrada.");
      onSheetOpenChange?.(false);
      return;
    }
    requestOpenEditRecipe(r, null);
  }, [
    initialOpenRecipeId,
    loading,
    recipes,
    editingRecipeId,
    requestOpenEditRecipe,
    onSheetOpenChange,
  ]);

  const handleSheetKindChange = useCallback((next: TechnicalSheetKind) => {
    setSheetKind(next);
    if (next !== "intermediate") {
      setDetailTab((tab) => (tab === "producao" ? "ficha" : tab));
    }
  }, []);

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
      const hub =
        product?.unit?.trim() ?? next[0]?.primary_unit_code?.trim() ?? "";
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

  const handleIngredientProductCreated = useCallback(
    (product: Product) => {
      setProducts((prev) => {
        if (prev.some((p) => p.id === product.id)) {
          return prev.map((p) => (p.id === product.id ? product : p));
        }
        return [...prev, product].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR"),
        );
      });
      void load();
    },
    [load],
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

  const saveRecipe = async (): Promise<boolean> => {
    const validIngs = ings.filter(
      (x) => x.product_id && x.unit_code && x.quantity.trim() !== "",
    );
    if (validIngs.length === 0) {
      toast.error("Adicione ao menos um ingrediente.");
      return false;
    }

    let outputProductId = technicalSheetPid || outputId.trim();
    let createdOutputId = "";
    const draftOutput = outputDraftName.trim();
    if (!outputProductId && draftOutput) {
      const existing = matchProductByTypedName(products, draftOutput);
      if (existing) {
        outputProductId = existing.id;
        setOutputId(existing.id);
        setOutputDraftName("");
      } else {
        setSaving(true);
        const created = await createCatalogProduct({
          companyId,
          name: draftOutput,
        });
        if (!created.product) {
          setSaving(false);
          toast.error(
            created.error ?? "Não foi possível cadastrar o produto de saída.",
          );
          return false;
        }
        setProducts((prev) => {
          if (prev.some((p) => p.id === created.product!.id)) return prev;
          return [...prev, created.product!].sort((a, b) =>
            a.name.localeCompare(b.name, "pt-BR"),
          );
        });
        outputProductId = created.product.id;
        createdOutputId = created.product.id;
        setOutputId(created.product.id);
        setOutputDraftName("");
      }
    }
    if (sheetKind === "intermediate" && !outputProductId) {
      toast.error(
        "Produto intermediário precisa do produto de saída — é nele que entra o estoque.",
      );
      return false;
    }

    if (outputProductId) {
      const rpcIngredients: Array<{
        product_id: string;
        input_quantity: number;
        input_unit_code: string;
      }> = [];

      for (const x of validIngs) {
        const parsed = parseFloat(x.quantity.replace(",", "."));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          toast.error("Quantidade do ingrediente inválida.");
          return false;
        }
        const allowedUnits = allowedUnitsForProduct(x.product_id).map((u) =>
          u.trim().toLowerCase(),
        );
        const unit = x.unit_code.trim().toLowerCase();
        if (!allowedUnits.includes(unit)) {
          toast.error("Selecione uma unidade válida para o ingrediente.");
          return false;
        }
        rpcIngredients.push({
          product_id: x.product_id,
          input_quantity: parsed,
          input_unit_code: unit,
        });
      }

      let yieldQty = 1;
      if (!ingredientsOnly) {
        const y = parseFloat(batchYield);
        if (Number.isNaN(y) || y <= 0) {
          toast.error("Rendimento da receita inválido.");
          return false;
        }
        yieldQty = y;
      }

      setSaving(true);
      const res = await saveProductTechnicalSheet(
        companyId,
        outputProductId,
        rpcIngredients,
        yieldQty,
        sheetKind,
      );
      setSaving(false);
      if (!res.ok) {
        if (createdOutputId) {
          await supabase.from("products").delete().eq("id", createdOutputId);
          setOutputId("");
          setOutputDraftName(draftOutput);
          setProducts((prev) => prev.filter((p) => p.id !== createdOutputId));
        }
        toast.error(technicalSheetErrorMessage(res.error));
        return false;
      }
      toast.success(
        sheetKind === "intermediate"
          ? "Produto intermediário salvo. Ele continua no catálogo; produza para entrar estoque e baixar os insumos."
          : "Ficha técnica salva. O prato sai do catálogo de produtos; novas saídas baixam os insumos na proporção informada.",
      );
      setSavedIngsSnapshot(normalizeIngsForCompare(validIngs));
      onTechnicalSheetSaved?.(res.recipe_id ?? null, res.backfill);
      onStockChanged?.();
      if (!technicalSheetPid) {
        const keepEditorOpen = ingredientsOnly && embedInline;
        if (!keepEditorOpen) {
          setSheetOpen(false);
          onSheetOpenChange?.(false);
          setEditingRecipeId(null);
          setName("");
          setBatchYield("1");
          setOutputId("");
          setOutputDraftName("");
          setIngs([]);
          setSheetKind("sale");
        }
        if (!(ingredientsOnly && embedInline)) {
          void load();
        }
      }
      return true;
    }

    const t = name.trim();
    if (!t) {
      toast.error("Informe o nome da receita.");
      return false;
    }
    const y = parseFloat(batchYield);
    if (Number.isNaN(y) || y <= 0) {
      toast.error("Rendimento da receita inválido.");
      return false;
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
        return false;
      }
      const allowedUnits = allowedUnitsForProduct(x.product_id).map((u) =>
        u.trim().toLowerCase(),
      );
      if (!allowedUnits.includes(x.unit_code.trim().toLowerCase())) {
        toast.error("Selecione uma unidade válida para o ingrediente.");
        return false;
      }
      const baseQty = toBaseQty(x.product_id, parsed, x.unit_code);
      if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
        toast.error("Não foi possível converter a unidade do ingrediente.");
        return false;
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
          recipe_type: sheetKind === "intermediate" ? "PRODUCTION" : "PREP",
        })
        .eq("id", editingRecipeId);
      if (upErr) {
        console.error(upErr);
        toast.error("Não foi possível atualizar a receita.");
        setSaving(false);
        return false;
      }
      const { error: delIngErr } = await supabase
        .from("recipe_ingredients")
        .delete()
        .eq("recipe_id", editingRecipeId);
      if (delIngErr) {
        console.error(delIngErr);
        toast.error("Não foi possível atualizar os ingredientes.");
        setSaving(false);
        return false;
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
          recipe_type: sheetKind === "intermediate" ? "PRODUCTION" : "PREP",
        })
        .select("id")
        .single();

      if (re || !rec?.id) {
        console.error(re);
        toast.error("Não foi possível salvar a receita.");
        setSaving(false);
        return false;
      }
      rid = rec.id as string;
    }
    if (!rid) {
      toast.error("Receita inválida.");
      setSaving(false);
      return false;
    }
    const rows = preparedRows.map((x) => ({
      ...x,
      company_id: companyId,
      recipe_id: rid,
    }));

    const { error: ie } = await supabase
      .from("recipe_ingredients")
      .insert(rows);
    setSaving(false);
    if (ie) {
      console.error(ie);
      if (!editingRecipeId) {
        await supabase.from("recipes").delete().eq("id", rid);
      }
      toast.error("Falha ao salvar ingredientes.");
      return false;
    }
    toast.success(
      ingredientsOnly
        ? "Insumos cadastrados."
        : editingRecipeId
          ? "Receita atualizada."
          : "Receita criada.",
    );
    setSavedIngsSnapshot(normalizeIngsForCompare(validIngs));
    const keepEditorOpen = ingredientsOnly && embedInline;
    if (!keepEditorOpen) {
      setSheetOpen(false);
      onSheetOpenChange?.(false);
      setEditingRecipeId(null);
      setName("");
      setBatchYield("1");
      setOutputId("");
      setOutputDraftName("");
      setIngs([]);
    }
    onStockChanged?.();
    const keepEditorOpenAfterSave = ingredientsOnly && embedInline;
    if (!keepEditorOpenAfterSave) {
      void load();
    }
    return true;
  };

  const saveRecipeFromUnsavedDialog = async () => {
    const ok = await saveRecipe();
    if (ok) proceedUnsavedLeave();
  };

  const deleteRecipe = async () => {
    if (!editingRecipeId) return;
    setSaving(true);
    const res = await undoProductRecipeMatch(
      supabase,
      companyId,
      editingRecipeId,
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível excluir a receita.");
      return;
    }
    toast.success(
      "Receita excluída. O produto de saída voltou ao estoque normal.",
    );
    setDeleteConfirmOpen(false);
    setSheetOpen(false);
    setEditingRecipeId(null);
    setName("");
    setBatchYield("1");
    setOutputId("");
    setOutputDraftName("");
    setIngs([]);
    onStockChanged?.();
    if (!(ingredientsOnly && embedInline)) {
      void load();
    }
  };

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      const close = () => {
        if (!embedInline) setSheetOpen(false);
        setEditingRecipeId(null);
        onSheetOpenChange?.(false);
      };
      if (
        ingredientsOnly &&
        (editingRecipeId || technicalSheetPid) &&
        isIngredientsDirty
      ) {
        promptUnsavedLeave(close);
        return;
      }
      close();
      return;
    }
    if (!embedInline) setSheetOpen(open);
    onSheetOpenChange?.(true);
  };

  return (
    <div
      className={cn(
        embedInline
          ? "flex h-full min-h-0 flex-col"
          : sheetOnly
            ? undefined
            : "space-y-6",
      )}
    >
      {!sheetOnly ? (
        <>
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  placeholder="Buscar ficha ou insumo…"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", "Todas"],
                    ["sale", "Ficha"],
                    ["production", "Produção"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={kindFilter === value ? "default" : "outline"}
                    onClick={() => setKindFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    const pid = linkContextProductId?.trim();
                    const match = pid
                      ? products.find((p) => p.id === pid)
                      : undefined;
                    setEditingRecipeId(null);
                    setSheetMode("edit");
                    if (match) {
                      const base = match.name.trim();
                      setName(base ? `${base} — ficha` : "Nova ficha técnica");
                      setBatchYield("1");
                      setOutputId(pid!);
                      setOutputDraftName("");
                      setIngs([]);
                    } else {
                      setName("");
                      setBatchYield("1");
                      setOutputId("");
                      setOutputDraftName("");
                      setIngs([]);
                    }
                    setSheetKind("sale");
                    setDetailTab("ficha");
                    setSheetOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Nova ficha
                </Button>
              </div>
            </div>

            {linkContextProductId ? (
              <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium">Vincular produto: </span>
                {productById.get(linkContextProductId)?.name ?? "—"}
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando…
              </div>
            ) : recipes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center">
                <p className="text-sm font-medium">Nenhuma ficha cadastrada</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crie uma ficha normal ou um produto intermediário.
                </p>
              </div>
            ) : sortedRecipes.length === 0 ? (
              <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
                Nenhuma ficha com “{listQuery.trim() || "este filtro"}”.
              </p>
            ) : listView === "cards" ? (
              <ul className="space-y-2">
                {sortedRecipes.map((r) => {
                  const outName = r.output_product_id
                    ? productById.get(r.output_product_id)?.name
                    : null;
                  const isProd = r.recipe_type === "PRODUCTION";
                  const matchedIngs = recipeMatchingIngredientNames(
                    r,
                    listQuery,
                  );
                  return (
                    <li
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        requestOpenEditRecipe(r, linkContextProductId)
                      }
                      onKeyDown={(e) =>
                        e.key === "Enter" &&
                        requestOpenEditRecipe(r, linkContextProductId)
                      }
                      className="cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{r.name}</p>
                          <RecipeSearchMatchedIngredients names={matchedIngs} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {outName ? `${outName} · ` : ""}
                            {Number(r.batch_yield).toLocaleString("pt-BR")}{" "}
                            rendimento · {r.recipe_ingredients?.length ?? 0}{" "}
                            insumos
                            {!r.active ? " · inativa" : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "h-6 px-2 text-[0.7rem] font-normal",
                              isProd ? INTERMEDIATE_BADGE_CLASS : "",
                            )}
                          >
                            {isProd ? "Produção" : "Ficha"}
                          </Badge>
                          {recipeCanBeProduced(r.recipe_type) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                requestOpenEditRecipe(
                                  r,
                                  linkContextProductId,
                                  "producao",
                                );
                              }}
                            >
                              Produzir
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <SortableTableHead
                        label="Ficha"
                        column="name"
                        sortKey={sortKey}
                        sortAsc={sortAsc}
                        onSort={onSort}
                      />
                      <SortableTableHead
                        label="Tipo"
                        column="kind"
                        sortKey={sortKey}
                        sortAsc={sortAsc}
                        onSort={onSort}
                      />
                      <SortableTableHead
                        label="Produto"
                        column="output"
                        sortKey={sortKey}
                        sortAsc={sortAsc}
                        onSort={onSort}
                      />
                      <SortableTableHead
                        label="Rendimento"
                        column="yield"
                        sortKey={sortKey}
                        sortAsc={sortAsc}
                        onSort={onSort}
                        align="right"
                      />
                      <SortableTableHead
                        label="Insumos"
                        column="ings"
                        sortKey={sortKey}
                        sortAsc={sortAsc}
                        onSort={onSort}
                        align="right"
                      />
                      <th className="w-28 px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRecipes.map((r) => {
                      const outName = r.output_product_id
                        ? productById.get(r.output_product_id)?.name
                        : null;
                      const isProd = r.recipe_type === "PRODUCTION";
                      const matchedIngs = recipeMatchingIngredientNames(
                        r,
                        listQuery,
                      );
                      return (
                        <tr
                          key={r.id}
                          className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                          onClick={() =>
                            requestOpenEditRecipe(r, linkContextProductId)
                          }
                        >
                          <td className="px-3 py-2.5">
                            <p className="font-medium">{r.name}</p>
                            <RecipeSearchMatchedIngredients
                              names={matchedIngs}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant="secondary"
                              className={cn(
                                "h-6 px-2 text-[0.7rem] font-normal",
                                isProd ? INTERMEDIATE_BADGE_CLASS : "",
                              )}
                            >
                              {isProd ? "Produção" : "Ficha"}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {outName ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {Number(r.batch_yield).toLocaleString("pt-BR")}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {r.recipe_ingredients?.length ?? 0}
                          </td>
                          <td
                            className="px-3 py-2.5 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {recipeCanBeProduced(r.recipe_type) ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  requestOpenEditRecipe(
                                    r,
                                    linkContextProductId,
                                    "producao",
                                  )
                                }
                              >
                                Produzir
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {embedInline ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm">
          {loading && !editingRecipeId && !technicalSheetPid ? (
            <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando ficha…
            </div>
          ) : editingRecipeId || (ingredientsOnly && technicalSheetPid) ? (
            <>
              <div className="shrink-0 border-b border-border bg-card px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                        sheetKind === "intermediate"
                          ? "border-teal-500/30 bg-teal-500/10"
                          : "border-border bg-muted",
                      )}
                    >
                      {sheetKind === "intermediate" ? (
                        <Factory className="h-5 w-5 text-teal-800 dark:text-teal-100" />
                      ) : (
                        <ChefHat className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {ingredientsOnly
                          ? sheetKind === "intermediate"
                            ? "Produto intermediário"
                            : "Cadastrar ficha"
                          : "Editar ficha técnica"}
                      </h3>
                      {ingredientsOnly && name.trim() ? (
                        <p className="truncate text-md font-bold text-foreground">
                          {name}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="shrink-0"
                    disabled={saving}
                    onClick={() => void saveRecipe()}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : ingredientsOnly ? (
                      sheetKind === "intermediate" ? (
                        "Salvar produção"
                      ) : (
                        "Salvar ficha"
                      )
                    ) : (
                      "Salvar alterações"
                    )}
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
                <div className="p-4">
                  <RecipeEditorForm
                    sheetKind={sheetKind}
                    onSheetKindChange={handleSheetKindChange}
                    disabled={saving}
                    ingredientsOnly={ingredientsOnly}
                    name={name}
                    onNameChange={setName}
                    batchYield={batchYield}
                    onBatchYieldChange={setBatchYield}
                    outputId={outputId}
                    onOutputIdChange={(id) => {
                      setOutputId(id);
                      if (id && isPlaceholderRecipeName(name)) {
                        const p = products.find((x) => x.id === id);
                        if (p?.name.trim()) setName(p.name);
                      }
                    }}
                    outputDraftName={outputDraftName}
                    onOutputDraftNameChange={(next) => {
                      setOutputDraftName(next);
                      if (next && isPlaceholderRecipeName(name)) setName(next);
                    }}
                    products={products}
                    ingredients={
                      <RecipeIngredientsAddPanel
                        key={editingRecipeId}
                        companyId={companyId}
                        products={products}
                        productById={productById}
                        ings={ings}
                        setIngs={setIngs}
                        allowedUnitsForProduct={allowedUnitsForProduct}
                        conversionsByProduct={conversionsByProduct}
                        handleIngredientConversionsChange={
                          handleIngredientConversionsChange
                        }
                        toBaseQty={toBaseQty}
                        fromBaseQty={fromBaseQty}
                        formatQtyHint={formatQtyHint}
                        onProductCreated={handleIngredientProductCreated}
                        excludeProductId={ingredientExcludeProductId}
                      />
                    }
                  />
                </div>
              </div>
              {/* <div className="shrink-0 border-t border-border bg-card px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSheetOpenChange(false)}
                >
                  Cancelar
                </Button>
              </div> */}
            </>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              Ficha técnica não encontrada.
            </p>
          )}
        </div>
      ) : (
        <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
          <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 shadow-2xl sm:max-w-lg lg:max-w-xl">
            <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
              <div
                className={cn(
                  "flex gap-3",
                  ingredientsOnly
                    ? "items-center justify-between"
                    : "items-start",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                      sheetKind === "intermediate"
                        ? "border-teal-500/30 bg-teal-500/10"
                        : "border-border bg-muted",
                    )}
                  >
                    {sheetKind === "intermediate" ? (
                      <Factory className="h-6 w-6 text-teal-800 dark:text-teal-100" />
                    ) : (
                      <ChefHat className="h-6 w-6 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1 pr-2">
                    <SheetTitle className="text-xl font-semibold sm:text-2xl">
                      {ingredientsOnly
                        ? sheetKind === "intermediate"
                          ? "Produto intermediário"
                          : "Cadastrar ficha"
                        : !editingRecipeId
                          ? "Nova ficha técnica"
                          : detailTab === "historico"
                            ? "Histórico"
                            : detailTab === "producao"
                              ? "Produzir"
                              : sheetMode === "summary"
                                ? name.trim() || "Ficha técnica"
                                : "Editar ficha técnica"}
                    </SheetTitle>
                    {ingredientsOnly && name.trim() ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {name}
                      </p>
                    ) : !ingredientsOnly &&
                      detailTab === "ficha" &&
                      !(editingRecipeId && sheetMode === "summary") ? (
                      <SheetDescription>
                        {editingRecipeId
                          ? "Ajuste tipo, identificação e o consumo da ficha."
                          : "Defina o tipo, o rendimento e os insumos."}
                      </SheetDescription>
                    ) : null}
                  </div>
                </div>
                {ingredientsOnly && editingRecipeId ? (
                  <Button
                    type="button"
                    className="shrink-0"
                    disabled={saving}
                    onClick={() => void saveRecipe()}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : sheetKind === "intermediate" ? (
                      "Salvar produção"
                    ) : (
                      "Salvar insumos"
                    )}
                  </Button>
                ) : editingRecipeId &&
                  !ingredientsOnly &&
                  detailTab === "ficha" ? (
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
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Excluir
                    </Button>
                  </div>
                ) : null}
              </div>
              {editingRecipeId && !ingredientsOnly ? (
                <div
                  className="mt-4 flex gap-1 border-t border-border pt-2"
                  role="tablist"
                  aria-label="Seções da ficha"
                >
                  {(
                    [
                      ["ficha", "Ficha", ChefHat],
                      ["historico", "Histórico", History],
                      ["producao", "Produzir", Factory],
                    ] as const
                  )
                    .filter(
                      ([id]) =>
                        id !== "producao" || sheetKind === "intermediate",
                    )
                    .map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={detailTab === id}
                      onClick={() => {
                        setDetailTab(id);
                      }}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-none border-b-2 px-2 py-2 text-sm font-medium",
                        detailTab === id
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </SheetHeader>
            {editingRecipeId &&
            !ingredientsOnly &&
            detailTab === "historico" ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted p-6">
                <RecipeMovementHistory
                  companyId={companyId}
                  recipeId={editingRecipeId}
                  outputProductId={outputId || null}
                  active={detailTab === "historico"}
                />
              </div>
            ) : editingRecipeId &&
              !ingredientsOnly &&
              detailTab === "producao" &&
              sheetKind === "intermediate" ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted p-6">
                <RecipeProducePanel
                  companyId={companyId}
                  mode="produce"
                  outputProductId={outputId}
                  outputName={
                    productById.get(outputId)?.name || name
                  }
                  outputUnit={productById.get(outputId)?.unit || "un"}
                  batchYield={parseFloat(batchYield) || 1}
                  recipeId={editingRecipeId}
                  ingredients={ings
                    .filter((row) => row.product_id && row.unit_code.trim())
                    .map((row) => {
                      const p = productById.get(row.product_id);
                      const qty = parseFloat(row.quantity.replace(",", "."));
                      return {
                        productId: row.product_id,
                        name: p?.name ?? "Insumo",
                        quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
                        unitLabel: systemUnitLabel(
                          row.unit_code || p?.unit || "un",
                        ),
                      };
                    })}
                  onProduced={() => {
                    onStockChanged?.();
                    void load();
                  }}
                />
              </div>
            ) : editingRecipeId &&
              sheetMode === "summary" &&
              !ingredientsOnly ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
                <div className="space-y-4 p-6">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {sheetKind === "intermediate"
                        ? "Produto intermediário"
                        : "Ficha técnica"}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground">
                      {name}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {sheetKind === "intermediate"
                        ? "Produção com estoque próprio · "
                        : "Na venda baixa os insumos · "}
                      rendimento{" "}
                      {Number(batchYield || 0).toLocaleString("pt-BR")} porções
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
                          const p = products.find(
                            (x) => x.id === row.product_id,
                          );
                          return (
                            <li
                              key={`${row.product_id}-${idx}`}
                              className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                            >
                              <p className="font-medium">{p?.name ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">
                                {Number(row.quantity || 0).toLocaleString(
                                  "pt-BR",
                                )}{" "}
                                ·{" "}
                                {systemUnitLabel(
                                  row.unit_code || p?.unit || "",
                                )}
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
                <div className="p-6">
                  <RecipeEditorForm
                    sheetKind={sheetKind}
                    onSheetKindChange={handleSheetKindChange}
                    disabled={saving}
                    ingredientsOnly={ingredientsOnly}
                    name={name}
                    onNameChange={setName}
                    batchYield={batchYield}
                    onBatchYieldChange={setBatchYield}
                    outputId={outputId}
                    onOutputIdChange={(id) => {
                      setOutputId(id);
                      if (id && isPlaceholderRecipeName(name)) {
                        const p = products.find((x) => x.id === id);
                        if (p?.name.trim()) setName(p.name);
                      }
                    }}
                    outputDraftName={outputDraftName}
                    onOutputDraftNameChange={(next) => {
                      setOutputDraftName(next);
                      if (next && isPlaceholderRecipeName(name)) setName(next);
                    }}
                    products={products}
                    ingredients={
                      <RecipeIngredientsAddPanel
                        key={editingRecipeId ?? "new-recipe"}
                        companyId={companyId}
                        products={products}
                        productById={productById}
                        ings={ings}
                        setIngs={setIngs}
                        allowedUnitsForProduct={allowedUnitsForProduct}
                        conversionsByProduct={conversionsByProduct}
                        handleIngredientConversionsChange={
                          handleIngredientConversionsChange
                        }
                        toBaseQty={toBaseQty}
                        fromBaseQty={fromBaseQty}
                        formatQtyHint={formatQtyHint}
                        onProductCreated={handleIngredientProductCreated}
                        excludeProductId={ingredientExcludeProductId}
                      />
                    }
                  />
                </div>
              </div>
            )}
            <SheetFooter className="shrink-0 gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl"
                onClick={() => handleSheetOpenChange(false)}
              >
                Cancelar
              </Button>
              {!ingredientsOnly &&
              detailTab === "ficha" &&
              !(editingRecipeId && sheetMode === "summary") ? (
                <Button
                  type="button"
                  className="h-11 rounded-xl"
                  disabled={saving}
                  onClick={() => void saveRecipe()}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingRecipeId ? (
                    "Salvar alterações"
                  ) : (
                    "Salvar"
                  )}
                </Button>
              ) : null}
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      <AlertDialog
        open={unsavedLeaveOpen}
        onOpenChange={(open) => {
          if (!open) cancelUnsavedLeave();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar insumos desta ficha?</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              Você adicionou ou alterou insumos em{" "}
              <strong className="text-foreground">
                {name.trim() || "esta ficha"}
              </strong>{" "}
              e ainda não salvou. Deseja salvar antes de continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={saving}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void saveRecipeFromUnsavedDialog();
              }}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Salvar insumos"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ficha técnica?</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              Isso remove a ficha
              {name.trim() ? ` «${name.trim()}»` : ""} e os insumos ligados. O
              produto de saída volta ao estoque normal e pode ser correlacionado
              de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={saving}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving || !editingRecipeId}
              onClick={(e) => {
                e.preventDefault();
                void deleteRecipe();
              }}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo…
                </>
              ) : (
                "Excluir ficha"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

EstoqueReceitasPanel.displayName = "EstoqueReceitasPanel";

import {
  CorrelationRecipeIngredientRow,
  recipeLineUnitIsAllowed,
  type RecipeComposerLine,
} from "@/components/products/CorrelationRecipeIngredientRow";
import { Button } from "@/components/ui/button";
import {
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  SearchSelect,
} from "@/components/ui/search-select";
import { useDebounce } from "@/hooks/useDebounce";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { createCatalogProduct } from "@/lib/createCatalogProduct";
import type { TechnicalSheetKind } from "@/lib/productIntermediate";
import type { ProductSetupPrimaryAction } from "@/lib/productSetupPrimaryAction";
import {
  fetchProductTechnicalSheet,
  saveProductTechnicalSheet,
} from "@/lib/productTechnicalSheet";
import { parseProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import { loadProductUnitConversionsByIds } from "@/lib/productUnitConversionsService";
import { searchProductsForUnify } from "@/lib/searchProductsForUnify";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type RecipeComposerHint = {
  id: string;
  name: string;
  unit: string;
  unitConversions?: unknown;
};

function parseQty(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function draftsFromHint(
  companyId: string,
  hint: RecipeComposerHint,
): ProductUnitConversionDraft[] {
  return parseProductUnitConversionsJson(
    hint.unitConversions,
    companyId,
    hint.id,
  );
}

export function CorrelationRecipeComposer({
  companyId,
  outputProductId,
  outputName,
  kind,
  suggestedIngredients = [],
  excludeProductIds = [],
  hidePrimaryAction = false,
  onPrimaryActionChange,
  onSaved,
}: {
  companyId: string;
  outputProductId: string;
  outputName: string;
  kind: TechnicalSheetKind;
  suggestedIngredients?: RecipeComposerHint[];
  excludeProductIds?: string[];
  hidePrimaryAction?: boolean;
  onPrimaryActionChange?: (action: ProductSetupPrimaryAction | null) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [lines, setLines] = useState<RecipeComposerLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [catalog, setCatalog] = useState<RecipeComposerHint[]>([]);
  const [conversionsByProduct, setConversionsByProduct] = useState<
    Record<string, ProductUnitConversionDraft[]>
  >({});

  useEffect(() => {
    let cancelled = false;
    void fetchProductTechnicalSheet(companyId, outputProductId).then((res) => {
      if (cancelled) return;
      if (res.data?.ingredients.length) {
        setLines(
          res.data.ingredients.map((ing) => ({
            productId: ing.product_id,
            name: ing.name,
            stockUnit: ing.unit,
            qty: String(ing.input_quantity),
            unitCode: ing.input_unit_code,
          })),
        );
      } else {
        setLines(
          suggestedIngredients
            .filter((row) => row.id !== outputProductId)
            .map((row) => ({
              productId: row.id,
              name: row.name,
              stockUnit: row.unit || "un",
              qty: "",
              unitCode: (row.unit || "un").toLowerCase(),
            })),
        );
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, outputProductId]);

  useEffect(() => {
    let cancelled = false;
    void searchProductsForUnify({
      companyId,
      excludeId: outputProductId,
      term: debounced,
      limit: 60,
    }).then((rows) => {
      if (cancelled) return;
      setCatalog(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          unit: String(row.unit ?? "un"),
          unitConversions: row.unit_conversions,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, debounced, outputProductId]);

  const lineIdsKey = lines.map((line) => line.productId).join("|");

  useEffect(() => {
    const missing = lines
      .map((line) => line.productId)
      .filter((id) => conversionsByProduct[id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void loadProductUnitConversionsByIds(companyId, missing).then((res) => {
      if (cancelled) return;
      setConversionsByProduct((prev) => ({ ...prev, ...res.byId }));
    });
    return () => {
      cancelled = true;
    };
    // Só busca ids ainda sem mapa; o próprio mapa não entra nas deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, lineIdsKey]);

  const taken = useMemo(
    () => new Set(lines.map((line) => line.productId)),
    [lines],
  );

  const addOptions = useMemo(() => {
    const extras = suggestedIngredients.filter(
      (row) =>
        row.id !== outputProductId &&
        !taken.has(row.id) &&
        !excludeProductIds.includes(row.id),
    );
    const seen = new Set(extras.map((row) => row.id));
    const fromCatalog = catalog.filter((row) => {
      if (taken.has(row.id) || seen.has(row.id)) return false;
      if (excludeProductIds.includes(row.id)) return false;
      return true;
    });
    return [...extras, ...fromCatalog].map((row) => ({
      value: row.id,
      label: row.name,
      description: systemUnitLabel(row.unit),
    }));
  }, [
    catalog,
    excludeProductIds,
    outputProductId,
    suggestedIngredients,
    taken,
  ]);

  const addLine = (hint: RecipeComposerHint) => {
    if (!hint.id || taken.has(hint.id) || hint.id === outputProductId) return;
    const drafts = draftsFromHint(companyId, hint);
    if (drafts.length > 0) {
      setConversionsByProduct((prev) => ({
        ...prev,
        [hint.id]: drafts,
      }));
    }
    setLines((prev) => [
      ...prev,
      {
        productId: hint.id,
        name: hint.name,
        stockUnit: hint.unit || "un",
        qty: "",
        unitCode: (hint.unit || "un").toLowerCase(),
      },
    ]);
  };

  const canSave =
    loaded &&
    lines.length > 0 &&
    lines.every(
      (line) =>
        parseQty(line.qty) != null &&
        recipeLineUnitIsAllowed(
          line.stockUnit,
          line.unitCode,
          conversionsByProduct[line.productId] ?? [],
        ),
    );

  const save = async () => {
    if (!canSave) return;
    const ingredients = lines.map((line) => ({
      product_id: line.productId,
      input_quantity: parseQty(line.qty) ?? 0,
      input_unit_code: line.unitCode.trim().toLowerCase(),
    }));
    setBusy(true);
    const res = await saveProductTechnicalSheet(
      companyId,
      outputProductId,
      ingredients,
      1,
      kind,
    );
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar a ficha.");
      return;
    }
    toast.success(
      kind === "intermediate"
        ? "Ficha de produção salva. Produza para entrar estoque e baixar os insumos."
        : "Ficha técnica salva. A venda baixa os insumos na proporção informada.",
    );
    await onSaved();
  };

  const actionLabel =
    kind === "intermediate" ? "Salvar produção" : "Salvar ficha";

  useEffect(() => {
    onPrimaryActionChange?.({
      label: actionLabel,
      disabled: busy || !canSave,
      busy,
      run: () => void save(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save fecha sobre lines atuais
  }, [actionLabel, busy, canSave, onPrimaryActionChange, lines, conversionsByProduct]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Receita: {outputName}.</p>
      {lines.length === 0 ? (
        <p className="rounded-lg border bg-background px-2.5 py-2 text-sm text-muted-foreground">
          Inclua pelo menos um insumo.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line) => (
            <CorrelationRecipeIngredientRow
              key={line.productId}
              companyId={companyId}
              line={line}
              conversions={conversionsByProduct[line.productId] ?? []}
              onQtyChange={(qty) =>
                setLines((prev) =>
                  prev.map((row) =>
                    row.productId === line.productId ? { ...row, qty } : row,
                  ),
                )
              }
              onUnitChange={(unitCode) =>
                setLines((prev) =>
                  prev.map((row) =>
                    row.productId === line.productId
                      ? { ...row, unitCode }
                      : row,
                  ),
                )
              }
              onConversionsChange={(next) =>
                setConversionsByProduct((prev) => ({
                  ...prev,
                  [line.productId]: next,
                }))
              }
              onRemove={() => {
                setLines((prev) =>
                  prev.filter((row) => row.productId !== line.productId),
                );
                setConversionsByProduct((prev) => {
                  const next = { ...prev };
                  delete next[line.productId];
                  return next;
                });
              }}
            />
          ))}
        </ul>
      )}
      <SearchSelect
        value=""
        onValueChange={(next) => {
          const hint =
            suggestedIngredients.find((row) => row.id === next) ??
            catalog.find((row) => row.id === next);
          if (hint) addLine(hint);
        }}
        options={addOptions}
        placeholder="Incluir insumo"
        searchPlaceholder="Buscar produto…"
        emptyMessage="Nenhum produto encontrado."
        onSearchChange={setSearch}
        onCreate={async (query) => {
          const created = await createCatalogProduct({
            companyId,
            name: query,
          });
          if (!created.product) {
            toast.error(created.error ?? "Não foi possível cadastrar.");
            return;
          }
          addLine({
            id: created.product.id,
            name: created.product.name,
            unit: String(created.product.unit ?? "un"),
            unitConversions: created.product.unit_conversions,
          });
        }}
        createLabel={(query) => `Cadastrar insumo «${query}»`}
        triggerClassName="h-8 bg-background"
        contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
      />
      {hidePrimaryAction ? null : (
        <Button
          type="button"
          size="sm"
          disabled={busy || !canSave}
          onClick={() => void save()}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

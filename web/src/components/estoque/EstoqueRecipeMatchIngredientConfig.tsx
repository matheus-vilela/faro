import { ProductUnitPickerWithConversion } from "@/components/products/ProductUnitPickerWithConversion";
import { ProductUnitConversionsSection } from "@/components/products/ProductUnitConversionsSection";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  convertQuantityForProduct,
  type UnitConversionCodeRow,
} from "@/lib/companyUnits/convert";
import { getAllowedUnitsForProductHub } from "@/lib/companyUnits/productAllowedUnits";
import {
  loadProductUnitConversions,
  persistProductUnitConversions,
  prepareProductUnitConversionsForPersist,
} from "@/lib/productUnitConversionsService";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import type { ProductRecipeMatchRow } from "@/lib/onboardingProductRecipeMatch";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { cn } from "@/lib/utils";
import { ChevronDown, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export type IngredientLinkConfig = {
  inputQuantity: number;
  inputUnitCode: string;
  stockQuantityPreview: number | null;
  isValid: boolean;
};

type Props = {
  companyId: string;
  ingredient: ProductRecipeMatchRow;
  onChange: (config: IngredientLinkConfig | null) => void;
};

function parseNum(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toCodeRows(drafts: ProductUnitConversionDraft[]): UnitConversionCodeRow[] {
  return drafts.map((r) => ({
    primary_qty: r.primary_qty,
    primary_unit_code: r.primary_unit_code,
    secondary_qty: r.secondary_qty,
    secondary_unit_code: r.secondary_unit_code,
  }));
}

export function EstoqueRecipeMatchIngredientConfig({
  companyId,
  ingredient,
  onChange,
}: Props) {
  const hubUnit = ingredient.unit.trim().toLowerCase() || "un";
  const [loading, setLoading] = useState(true);
  const [savingConversions, setSavingConversions] = useState(false);
  const [conversions, setConversions] = useState<ProductUnitConversionDraft[]>(
    [],
  );
  const [inputUnitCode, setInputUnitCode] = useState(hubUnit);
  const [consumeQty, setConsumeQty] = useState("1");

  const load = useCallback(async () => {
    setLoading(true);
    const { rows, error } = await loadProductUnitConversions(
      companyId,
      ingredient.product_id,
    );
    setLoading(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível carregar conversões do produto.");
      setConversions([]);
      return;
    }
    setConversions(rows);
  }, [companyId, ingredient.product_id]);

  useEffect(() => {
    setInputUnitCode(hubUnit);
    setConsumeQty("1");
    void load();
  }, [hubUnit, ingredient.product_id, load]);

  const conversionRows = useMemo(() => toCodeRows(conversions), [conversions]);

  const allowedUnits = useMemo(
    () => getAllowedUnitsForProductHub(hubUnit, conversionRows),
    [conversionRows, hubUnit],
  );

  const usesAlternateUnit = inputUnitCode.trim().toLowerCase() !== hubUnit;

  const hasConversionForSelectedUnit = useMemo(() => {
    if (!usesAlternateUnit) return true;
    const sec = inputUnitCode.trim().toLowerCase();
    return allowedUnits.some((u) => u === sec);
  }, [allowedUnits, inputUnitCode, usesAlternateUnit]);

  const handleConversionsChange = async (next: ProductUnitConversionDraft[]) => {
    const prepared = prepareProductUnitConversionsForPersist(hubUnit, next);
    setConversions(prepared);
    setSavingConversions(true);
    const res = await persistProductUnitConversions(
      companyId,
      ingredient.product_id,
      prepared,
    );
    setSavingConversions(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar a conversão.");
      void load();
      return;
    }
    toast.success(
      prepared.length > next.length
        ? "Conversão salva (incluindo equivalentes em massa/volume)."
        : "Conversão salva no cadastro do produto.",
    );
    const sec = inputUnitCode.trim().toLowerCase();
    if (
      sec !== hubUnit &&
      next.some((r) => r.secondary_unit_code.trim().toLowerCase() === sec)
    ) {
      setInputUnitCode(sec);
    }
  };

  const config = useMemo((): IngredientLinkConfig => {
    const qty = parseNum(consumeQty);
    if (qty == null || !hasConversionForSelectedUnit) {
      return {
        inputQuantity: 0,
        inputUnitCode: inputUnitCode.trim().toLowerCase(),
        stockQuantityPreview: null,
        isValid: false,
      };
    }

    const stockQty = convertQuantityForProduct(
      qty,
      inputUnitCode.trim().toLowerCase(),
      hubUnit,
      hubUnit,
      conversionRows,
    );

    return {
      inputQuantity: qty,
      inputUnitCode: inputUnitCode.trim().toLowerCase(),
      stockQuantityPreview: stockQty,
      isValid: stockQty != null && stockQty > 0,
    };
  }, [
    consumeQty,
    conversionRows,
    hasConversionForSelectedUnit,
    hubUnit,
    inputUnitCode,
  ]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current(config);
  }, [config]);

  const needsConversion =
    usesAlternateUnit && !hasConversionForSelectedUnit;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando unidades do insumo…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-foreground">Consumo na ficha</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {ingredient.name} · estoque em {systemUnitLabel(hubUnit)}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="recipe-match-consume-qty">Qtd</Label>
          <Input
            id="recipe-match-consume-qty"
            type="text"
            inputMode="decimal"
            value={consumeQty}
            onChange={(e) => setConsumeQty(e.target.value)}
            aria-invalid={!config.isValid}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="recipe-match-input-unit">Unidade</Label>
          <ProductUnitPickerWithConversion
            companyId={companyId}
            stockUnitCode={hubUnit}
            hubUnitCode={hubUnit}
            unitCodes={allowedUnits}
            value={inputUnitCode}
            onValueChange={(v) => setInputUnitCode(v.trim().toLowerCase())}
            conversions={conversions}
            onConversionsChange={(next) => void handleConversionsChange(next)}
            onSecondaryUnitAdded={(code) => setInputUnitCode(code)}
            disabled={savingConversions}
            triggerId="recipe-match-input-unit"
            triggerClassName="h-9"
          />
        </div>
      </div>

      {needsConversion ? (
        <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
          Cadastre a conversão na unidade (ex.: 1 {systemUnitLabel(hubUnit)} ={" "}
          1000 {systemUnitLabel(inputUnitCode)}).
        </p>
      ) : config.stockQuantityPreview != null && config.isValid ? (
        <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Baixa{" "}
          <strong className="font-medium text-foreground">
            {config.stockQuantityPreview.toLocaleString("pt-BR", {
              maximumFractionDigits: 6,
            })}{" "}
            {systemUnitLabel(hubUnit)}
          </strong>{" "}
          do estoque por porção.
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Informe quanto entra em 1 porção da ficha.
        </p>
      )}

      <Collapsible
        defaultOpen={needsConversion || conversions.length > 0}
        className="mt-4 border-t border-border/70 pt-3"
      >
        <CollapsibleTrigger
          className={cn(
            "group flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-muted-foreground",
            "hover:text-foreground",
          )}
        >
          Conversões de unidade
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <ProductUnitConversionsSection
            companyId={companyId}
            stockUnitCode={hubUnit}
            value={conversions}
            onChange={(next) => void handleConversionsChange(next)}
            disabled={savingConversions}
            compact
            sectionClassName="rounded-xl border border-border/60 bg-muted/20 p-3"
          />
          {savingConversions ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Salvando conversão…
            </p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

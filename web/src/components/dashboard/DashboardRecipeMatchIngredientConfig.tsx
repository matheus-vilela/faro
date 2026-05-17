import { ProductUnitConversionsSection } from "@/components/products/ProductUnitConversionsSection";
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
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
  type UnitConversionCodeRow,
} from "@/lib/companyUnits/convert";
import {
  loadProductUnitConversions,
  persistProductUnitConversions,
} from "@/lib/productUnitConversionsService";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import type { ProductRecipeMatchRow } from "@/lib/onboardingProductRecipeMatch";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

export function DashboardRecipeMatchIngredientConfig({
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

  const allowedUnits = useMemo(() => {
    const allowed = new Set<string>([hubUnit]);
    for (const c of conversionRows) {
      if (c.primary_unit_code.trim().toLowerCase() === hubUnit) {
        allowed.add(c.secondary_unit_code.trim().toLowerCase());
      }
    }
    for (const candidate of ["mg", "g", "kg", "ml", "l"]) {
      if (candidate === hubUnit) continue;
      if (getLockedSystemSecondaryQty(1, hubUnit, candidate) != null) {
        allowed.add(candidate);
      }
    }
    return [...allowed];
  }, [conversionRows, hubUnit]);

  const usesAlternateUnit = inputUnitCode.trim().toLowerCase() !== hubUnit;

  const hasConversionForSelectedUnit = useMemo(() => {
    if (!usesAlternateUnit) return true;
    const sec = inputUnitCode.trim().toLowerCase();
    return allowedUnits.some((u) => u === sec);
  }, [allowedUnits, inputUnitCode, usesAlternateUnit]);

  const handleConversionsChange = async (next: ProductUnitConversionDraft[]) => {
    setConversions(next);
    setSavingConversions(true);
    const res = await persistProductUnitConversions(
      companyId,
      ingredient.product_id,
      next,
    );
    setSavingConversions(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar a conversão.");
      void load();
      return;
    }
    toast.success("Conversão salva no cadastro do produto.");
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

  useEffect(() => {
    onChange(config);
  }, [config, onChange]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando unidades do insumo…
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-sky-500/25 bg-sky-500/5 p-4">
      <p className="text-sm font-medium text-foreground">
        Consumo de «{ingredient.name}» na ficha
      </p>
      <p className="text-xs text-muted-foreground">
        Estoque em{" "}
        <strong className="font-medium text-foreground">
          {systemUnitLabel(hubUnit)}
        </strong>
        . Cadastre conversões abaixo (mesmo fluxo da ficha do produto) e informe
        quanto a receita consome por porção.
      </p>

      <ProductUnitConversionsSection
        companyId={companyId}
        stockUnitCode={hubUnit}
        value={conversions}
        onChange={(next) => void handleConversionsChange(next)}
        disabled={savingConversions}
        sectionClassName="rounded-lg border border-border/60 bg-background/80 p-3"
      />

      {savingConversions ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Salvando conversão…
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="recipe-match-input-unit">Unidade na ficha</Label>
          <Select
            value={inputUnitCode}
            onValueChange={(v) => setInputUnitCode(v.trim().toLowerCase())}
          >
            <SelectTrigger id="recipe-match-input-unit" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedUnits.map((code) => (
                <SelectItem key={code} value={code}>
                  {code === hubUnit
                    ? `${systemUnitLabel(code)} (estoque)`
                    : systemUnitLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="recipe-match-consume-qty">
            Quantidade por porção ({systemUnitLabel(inputUnitCode)})
          </Label>
          <Input
            id="recipe-match-consume-qty"
            type="text"
            inputMode="decimal"
            value={consumeQty}
            onChange={(e) => setConsumeQty(e.target.value)}
          />
        </div>
      </div>

      {usesAlternateUnit && !hasConversionForSelectedUnit ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Cadastre uma conversão acima (ex.: 1 {systemUnitLabel(hubUnit)} = 1000{" "}
          {systemUnitLabel(inputUnitCode)}) para usar esta unidade na ficha.
        </p>
      ) : null}

      {config.stockQuantityPreview != null && config.isValid ? (
        <p className="text-xs text-muted-foreground">
          Equivale a{" "}
          <strong className="text-foreground">
            {config.stockQuantityPreview.toLocaleString("pt-BR", {
              maximumFractionDigits: 6,
            })}{" "}
            {systemUnitLabel(hubUnit)}
          </strong>{" "}
          baixados do estoque por porção vendida.
        </p>
      ) : null}
    </div>
  );
}

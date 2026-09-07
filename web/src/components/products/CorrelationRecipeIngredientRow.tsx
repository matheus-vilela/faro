import { ProductUnitPickerWithConversion } from "@/components/products/ProductUnitPickerWithConversion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UnitConversionCodeRow } from "@/lib/companyUnits/convert";
import { getAllowedUnitsForProductHub } from "@/lib/companyUnits/productAllowedUnits";
import {
  loadProductUnitConversions,
  persistProductUnitConversions,
  prepareProductUnitConversionsForPersist,
} from "@/lib/productUnitConversionsService";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export type RecipeComposerLine = {
  productId: string;
  name: string;
  stockUnit: string;
  qty: string;
  unitCode: string;
};

function toCodeRows(
  drafts: ProductUnitConversionDraft[],
): UnitConversionCodeRow[] {
  return drafts.map((r) => ({
    primary_qty: r.primary_qty,
    primary_unit_code: r.primary_unit_code,
    secondary_qty: r.secondary_qty,
    secondary_unit_code: r.secondary_unit_code,
  }));
}

export function recipeLineUnitIsAllowed(
  stockUnit: string,
  unitCode: string,
  conversions: ProductUnitConversionDraft[],
): boolean {
  const hub = stockUnit.trim().toLowerCase() || "un";
  const code = unitCode.trim().toLowerCase();
  return getAllowedUnitsForProductHub(hub, toCodeRows(conversions)).includes(
    code,
  );
}

export function CorrelationRecipeIngredientRow({
  companyId,
  line,
  conversions,
  onQtyChange,
  onUnitChange,
  onConversionsChange,
  onRemove,
}: {
  companyId: string;
  line: RecipeComposerLine;
  conversions: ProductUnitConversionDraft[];
  onQtyChange: (qty: string) => void;
  onUnitChange: (unitCode: string) => void;
  onConversionsChange: (next: ProductUnitConversionDraft[]) => void;
  onRemove?: () => void;
}) {
  const hub = line.stockUnit.trim().toLowerCase() || "un";
  const [saving, setSaving] = useState(false);

  const conversionRows = useMemo(() => toCodeRows(conversions), [conversions]);
  const allowedUnits = useMemo(
    () => getAllowedUnitsForProductHub(hub, conversionRows),
    [conversionRows, hub],
  );
  const unitCodes = useMemo(() => {
    const current = line.unitCode.trim().toLowerCase();
    if (current && !allowedUnits.includes(current)) {
      return [...allowedUnits, current];
    }
    return allowedUnits;
  }, [allowedUnits, line.unitCode]);

  const handleConversionsChange = async (
    next: ProductUnitConversionDraft[],
  ) => {
    const prepared = prepareProductUnitConversionsForPersist(
      hub,
      next.map((row) => ({
        ...row,
        company_id: companyId,
        product_id: line.productId,
      })),
    );
    onConversionsChange(prepared);
    setSaving(true);
    const res = await persistProductUnitConversions(
      companyId,
      line.productId,
      prepared,
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar a conversão.");
      const reload = await loadProductUnitConversions(
        companyId,
        line.productId,
      );
      onConversionsChange(reload.rows);
      return;
    }
    toast.success(
      prepared.length > next.length
        ? "Conversão salva (incluindo equivalentes em massa/volume)."
        : "Conversão salva no cadastro do insumo.",
    );
  };

  return (
    <li className="flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{line.name}</p>
      <Input
        value={line.qty}
        onChange={(e) => onQtyChange(e.target.value)}
        inputMode="decimal"
        placeholder="Qtde"
        className="h-8 w-20"
        aria-label={`Quantidade de ${line.name}`}
      />
      <ProductUnitPickerWithConversion
        companyId={companyId}
        stockUnitCode={hub}
        hubUnitCode={hub}
        unitCodes={unitCodes}
        value={line.unitCode}
        onValueChange={(next) => onUnitChange(next.trim().toLowerCase())}
        conversions={conversions}
        onConversionsChange={(next) => void handleConversionsChange(next)}
        onSecondaryUnitAdded={(code) => onUnitChange(code.trim().toLowerCase())}
        disabled={saving}
        size="sm"
        placeholder="Un."
        className="w-[12rem] shrink-0"
        triggerClassName="h-8 bg-background"
      />
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remover ${line.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </li>
  );
}

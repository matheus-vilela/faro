import { SearchSelect } from "@/components/ui/search-select";
import { UnitConversionDialog } from "@/components/units/UnitConversionDialog";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { cn } from "@/lib/utils";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { useMemo } from "react";
import { useProductUnitConversionQuickAdd } from "./useProductUnitConversionQuickAdd";

const NEW_CONVERSION = "__new_conversion__";

export interface ProductUnitPickerWithConversionProps {
  companyId: string;
  stockUnitCode: string;
  unitCodes: string[];
  value: string;
  onValueChange: (code: string) => void;
  conversions: ProductUnitConversionDraft[];
  onConversionsChange: (
    next: ProductUnitConversionDraft[],
  ) => void | Promise<void>;
  onSecondaryUnitAdded?: (secondaryUnitCode: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Rótulo extra quando o código é a unidade de estoque (ex.: «(estoque)»). */
  hubUnitCode?: string;
  className?: string;
  triggerClassName?: string;
  triggerId?: string;
  size?: "sm" | "default";
}

export function ProductUnitPickerWithConversion({
  companyId,
  stockUnitCode,
  unitCodes,
  value,
  onValueChange,
  conversions,
  onConversionsChange,
  onSecondaryUnitAdded,
  disabled,
  placeholder = "Unidade",
  hubUnitCode,
  className,
  triggerClassName,
  triggerId,
  size = "default",
}: ProductUnitPickerWithConversionProps) {
  const quickAdd = useProductUnitConversionQuickAdd({
    companyId,
    stockUnitCode,
    conversions,
    onConversionsChange,
    onSecondaryUnitAdded: (code) => {
      onSecondaryUnitAdded?.(code);
      onValueChange(code);
    },
  });

  const hub = (hubUnitCode ?? stockUnitCode).trim().toLowerCase();

  const options = useMemo(() => {
    const unique = [
      ...new Set(unitCodes.map((u) => u.trim().toLowerCase())),
    ].filter(Boolean);
    return unique.map((code) => ({
      value: code,
      label:
        code === hub
          ? `${systemUnitLabel(code)} (estoque)`
          : systemUnitLabel(code),
      keywords: code,
    }));
  }, [hub, unitCodes]);

  return (
    <div className={className}>
      <SearchSelect
        id={triggerId}
        value={value}
        onValueChange={(next) => {
          if (next === NEW_CONVERSION) {
            quickAdd.setDialogOpen(true);
            return;
          }
          onValueChange(next);
        }}
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Buscar unidade…"
        emptyMessage="Nenhuma unidade encontrada."
        disabled={disabled}
        size={size}
        triggerClassName={cn("w-full", triggerClassName)}
        trailingOptions={
          quickAdd.canAddConversion && !disabled
            ? [
                {
                  value: NEW_CONVERSION,
                  label: "Nova conversão",
                  description: "Cadastrar outra unidade",
                  accent: true,
                },
              ]
            : []
        }
      />

      <UnitConversionDialog
        open={quickAdd.dialogOpen}
        onOpenChange={quickAdd.setDialogOpen}
        primaryUnit={quickAdd.primaryForDialog}
        secondaryUnits={quickAdd.secondaryOptions}
        onSave={quickAdd.handleSave}
        saving={quickAdd.saving}
      />
    </div>
  );
}

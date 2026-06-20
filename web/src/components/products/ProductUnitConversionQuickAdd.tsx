import { Button } from "@/components/ui/button";
import { UnitConversionDialog } from "@/components/units/UnitConversionDialog";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Plus } from "lucide-react";
import { useProductUnitConversionQuickAdd } from "./useProductUnitConversionQuickAdd";

interface ProductUnitConversionQuickAddProps {
  companyId: string;
  stockUnitCode: string;
  conversions: ProductUnitConversionDraft[];
  onConversionsChange: (
    next: ProductUnitConversionDraft[],
  ) => void | Promise<void>;
  onSecondaryUnitAdded?: (secondaryUnitCode: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ProductUnitConversionQuickAdd({
  companyId,
  stockUnitCode,
  conversions,
  onConversionsChange,
  onSecondaryUnitAdded,
  disabled,
  className,
}: ProductUnitConversionQuickAddProps) {
  const {
    hub,
    dialogOpen,
    setDialogOpen,
    saving,
    canAddConversion,
    primaryForDialog,
    secondaryOptions,
    handleSave,
  } = useProductUnitConversionQuickAdd({
    companyId,
    stockUnitCode,
    conversions,
    onConversionsChange,
    onSecondaryUnitAdded,
  });

  if (!hub) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled || saving || !canAddConversion}
        onClick={() => setDialogOpen(true)}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Nova conversão
      </Button>

      <UnitConversionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        primaryUnit={primaryForDialog}
        secondaryUnits={secondaryOptions}
        onSave={handleSave}
        saving={saving}
      />
    </>
  );
}

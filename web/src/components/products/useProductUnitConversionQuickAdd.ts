import { isLockedSystemConversionPair } from "@/lib/companyUnits/convert";
import { prepareProductUnitConversionsForPersist } from "@/lib/productUnitConversionsService";
import { SYSTEM_PRODUCT_UNITS } from "@/lib/companyUnits/systemUnits";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { useMemo, useState } from "react";

export function useProductUnitConversionQuickAdd({
  companyId,
  stockUnitCode,
  conversions,
  onConversionsChange,
  onSecondaryUnitAdded,
}: {
  companyId: string;
  stockUnitCode: string;
  conversions: ProductUnitConversionDraft[];
  onConversionsChange: (
    next: ProductUnitConversionDraft[],
  ) => void | Promise<void>;
  onSecondaryUnitAdded?: (secondaryUnitCode: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const hub = stockUnitCode.trim();

  const primaryMeta = useMemo(() => {
    const c = hub.toLowerCase();
    return SYSTEM_PRODUCT_UNITS.find((u) => u.code.toLowerCase() === c) ?? null;
  }, [hub]);

  const secondaryOptions = useMemo(() => {
    const c = hub.toLowerCase();
    if (!c) return [];
    const used = new Set(
      conversions.map((v) => v.secondary_unit_code.trim().toLowerCase()),
    );
    return SYSTEM_PRODUCT_UNITS.filter(
      (u) =>
        u.code.toLowerCase() !== c &&
        !used.has(u.code.toLowerCase()) &&
        !isLockedSystemConversionPair(hub, u.code),
    ).map((u) => ({ code: u.code, label: u.label }));
  }, [conversions, hub]);

  const primaryForDialog = primaryMeta
    ? { code: primaryMeta.code, label: primaryMeta.label }
    : hub
      ? { code: hub, label: hub }
      : null;

  const canAddConversion = Boolean(hub) && secondaryOptions.length > 0;

  const handleSave = async (payload: {
    primary_qty: number;
    secondary_unit_code: string;
    secondary_qty: number;
  }) => {
    if (!hub) return;
    const next = prepareProductUnitConversionsForPersist(hub, [
      ...conversions,
      {
        company_id: companyId,
        primary_qty: payload.primary_qty,
        primary_unit_code: hub,
        secondary_qty: payload.secondary_qty,
        secondary_unit_code: payload.secondary_unit_code,
      },
    ]);
    setSaving(true);
    try {
      await onConversionsChange(next);
      setDialogOpen(false);
      onSecondaryUnitAdded?.(payload.secondary_unit_code.trim().toLowerCase());
    } finally {
      setSaving(false);
    }
  };

  return {
    hub,
    dialogOpen,
    setDialogOpen,
    saving,
    canAddConversion,
    primaryForDialog,
    secondaryOptions,
    handleSave,
  };
}

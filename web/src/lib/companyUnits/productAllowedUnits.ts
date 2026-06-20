import {
  getLockedSystemSecondaryQty,
  type UnitConversionCodeRow,
} from "@/lib/companyUnits/convert";

const SYSTEM_MASS_VOLUME = ["mg", "g", "kg", "ml", "l"] as const;

/** Unidades selecionáveis na ficha/receita para um produto (hub + conversões + sistema). */
export function getAllowedUnitsForProductHub(
  hubUnitCode: string,
  conversions: UnitConversionCodeRow[],
): string[] {
  const hub = hubUnitCode.trim().toLowerCase();
  if (!hub) return [];
  const allowed = new Set<string>([hub]);
  for (const c of conversions) {
    if (c.primary_unit_code.trim().toLowerCase() === hub) {
      allowed.add(c.secondary_unit_code.trim().toLowerCase());
    }
  }
  for (const candidate of SYSTEM_MASS_VOLUME) {
    if (candidate === hub) continue;
    if (getLockedSystemSecondaryQty(1, hub, candidate) != null) {
      allowed.add(candidate);
    }
  }
  return [...allowed];
}

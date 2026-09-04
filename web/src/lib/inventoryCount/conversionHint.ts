import {
  convertQuantityWithHubCodes,
  type UnitConversionCodeRow,
} from "@/lib/companyUnits/convert";
import { getAllowedUnitsForProductHub } from "@/lib/companyUnits/productAllowedUnits";
import { formatProductConversionQty } from "@/lib/companyUnits/productConversionRows";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";

export type PublicCountUnitOption = {
  code: string;
  label: string;
  hint: string | null;
};

export function conversionHintForUnit(
  unitCode: string,
  hubCode: string,
  conversions: UnitConversionCodeRow[],
): string | null {
  const unit = unitCode.trim().toLowerCase();
  const hub = hubCode.trim().toLowerCase();
  if (!unit || !hub || unit === hub) return null;
  const qtyInHub = convertQuantityWithHubCodes(
    1,
    unit,
    hub,
    hub,
    conversions,
  );
  if (qtyInHub == null || !Number.isFinite(qtyInHub) || qtyInHub <= 0) {
    return null;
  }
  return `1 ${unit} = ${formatProductConversionQty(qtyInHub)} ${hub}`;
}

export function allowedUnitsForPublicCount(
  hubCode: string,
  conversions: UnitConversionCodeRow[],
): PublicCountUnitOption[] {
  const hub = hubCode.trim().toLowerCase();
  if (!hub) return [];
  return getAllowedUnitsForProductHub(hub, conversions).map((code) => ({
    code,
    label: `${systemUnitLabel(code)} (${code})`,
    hint: conversionHintForUnit(code, hub, conversions),
  }));
}

export function convertTypedQtyToHub(
  qty: number,
  fromUnit: string,
  hubCode: string,
  conversions: UnitConversionCodeRow[],
): number | null {
  return convertQuantityWithHubCodes(
    qty,
    fromUnit,
    hubCode,
    hubCode,
    conversions,
  );
}

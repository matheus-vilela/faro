import { formatProductConversionQty } from "@/lib/companyUnits/productConversionRows";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";

export const DEFAULT_UNITS_PER_PACK = 12;

const MASS_VOLUME = new Set(["mg", "g", "kg", "ml", "l"]);

/** Pack-like units, preferred first when choosing the calculator label. */
export const PACK_UNIT_PRIORITY = [
  "cx",
  "pct",
  "fd",
  "saco",
  "bandeja",
  "maco",
  "lata",
  "barrica",
  "tambor",
  "galao",
  "pote",
  "rolo",
  "bisnaga",
] as const;

const PACK_UNIT_SET = new Set<string>(PACK_UNIT_PRIORITY);

export type PackCountAllowedUnit = {
  code: string;
  hint?: string | null;
  qty_in_hub?: number | string | null;
};

export type PackCountLabels = {
  title: string;
  packs: string;
  perPack: string;
  loose: string;
};

export type PackCountContext = {
  packCode: string;
  hubIsPack: boolean;
  unitsPerPack: number;
  fromConversion: boolean;
  labels: PackCountLabels;
};

const HINT_QTY_RE = /^1\s+\S+\s+=\s+([0-9]+(?:[.,][0-9]+)?)\s+\S+$/i;

export function isPackUnitCode(code: string | undefined | null): boolean {
  if (code == null || code === "") return false;
  return PACK_UNIT_SET.has(code.trim().toLowerCase());
}

export function isMassVolumeUnitCode(code: string | undefined | null): boolean {
  if (code == null || code === "") return false;
  return MASS_VOLUME.has(code.trim().toLowerCase());
}

export function packCountLabels(packCode: string): PackCountLabels {
  const code = packCode.trim().toLowerCase();
  const loose = "Avulsas (soltas)";
  switch (code) {
    case "cx":
      return {
        title: "Contar em caixas",
        packs: "Caixas",
        perPack: "Por caixa",
        loose,
      };
    case "pct":
      return {
        title: "Contar em pacotes",
        packs: "Pacotes",
        perPack: "Por pacote",
        loose,
      };
    case "fd":
      return {
        title: "Contar em fardos",
        packs: "Fardos",
        perPack: "Por fardo",
        loose,
      };
    case "saco":
      return {
        title: "Contar em sacos",
        packs: "Sacos",
        perPack: "Por saco",
        loose,
      };
    default: {
      const label = systemUnitLabel(code);
      return {
        title: `Contar em ${label.toLowerCase()}`,
        packs: label,
        perPack: `Por ${label.toLowerCase()}`,
        loose,
      };
    }
  }
}

function unitCode(u: PackCountAllowedUnit): string {
  return u.code.trim().toLowerCase();
}

function pickPackCode(
  hub: string,
  units: PackCountAllowedUnit[],
): string {
  if (isPackUnitCode(hub)) return hub;
  const codes = new Set(units.map(unitCode).filter(Boolean));
  for (const pack of PACK_UNIT_PRIORITY) {
    if (codes.has(pack)) return pack;
  }
  for (const u of units) {
    const c = unitCode(u);
    if (c && c !== hub && !isMassVolumeUnitCode(c)) return c;
  }
  return "cx";
}

function parseHintQty(hint: string | null | undefined): number | null {
  if (hint == null || hint.trim() === "") return null;
  const m = HINT_QTY_RE.exec(hint.trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function snapPackFactor(n: number): number {
  const nearestInt = Math.round(n);
  if (Math.abs(n - nearestInt) < 1e-6) return nearestInt;
  return Number(n.toFixed(4));
}

function asPositiveQty(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value.replace(",", "."))
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function qtyInHubOf(
  units: PackCountAllowedUnit[],
  code: string,
): number | null {
  const found = units.find((u) => unitCode(u) === code);
  if (!found) return null;
  return asPositiveQty(found.qty_in_hub) ?? parseHintQty(found.hint);
}

/**
 * Units per pack from allowed_units. When the hub is already the pack,
 * invert the "each" unit (1 un = 1/N cx → N).
 */
export function unitsPerPackFromAllowedUnits(
  hubCode: string,
  packCode: string,
  units: PackCountAllowedUnit[],
): { value: number; fromConversion: boolean } {
  const hub = hubCode.trim().toLowerCase();
  const pack = packCode.trim().toLowerCase();

  if (pack === hub) {
    const each = units.find((u) => {
      const c = unitCode(u);
      return c && c !== hub && !isPackUnitCode(c) && !isMassVolumeUnitCode(c);
    });
    const qty = each ? qtyInHubOf(units, unitCode(each)) : null;
    if (qty != null && qty > 0) {
      const inverted = 1 / qty;
      if (Number.isFinite(inverted) && inverted > 0) {
        return { value: snapPackFactor(inverted), fromConversion: true };
      }
    }
    return { value: DEFAULT_UNITS_PER_PACK, fromConversion: false };
  }

  const qty = qtyInHubOf(units, pack);
  if (qty != null && qty > 0) {
    return { value: snapPackFactor(qty), fromConversion: true };
  }
  return { value: DEFAULT_UNITS_PER_PACK, fromConversion: false };
}

export function resolvePackCountContext(
  hubCode: string,
  units: PackCountAllowedUnit[],
): PackCountContext {
  const hub = hubCode.trim().toLowerCase();
  const packCode = pickPackCode(hub, units);
  const { value, fromConversion } = unitsPerPackFromAllowedUnits(
    hub,
    packCode,
    units,
  );
  return {
    packCode,
    hubIsPack: isPackUnitCode(hub),
    unitsPerPack: value,
    fromConversion,
    labels: packCountLabels(packCode),
  };
}

export function packCountTotal(input: {
  boxes: number;
  perBox: number;
  loose: number;
  hubIsPack: boolean;
}): number | null {
  const boxes = input.boxes;
  const perBox = input.perBox;
  const loose = input.loose;
  if (
    !Number.isFinite(boxes) ||
    !Number.isFinite(perBox) ||
    !Number.isFinite(loose) ||
    boxes < 0 ||
    loose < 0 ||
    perBox <= 0
  ) {
    return null;
  }
  const raw = input.hubIsPack
    ? boxes + loose / perBox
    : boxes * perBox + loose;
  if (!Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

export function formatPackCountQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

export function formatPackCountExpression(input: {
  boxes: number;
  perBox: number;
  loose: number;
  hubIsPack: boolean;
}): string {
  const boxes = formatProductConversionQty(input.boxes);
  const perBox = formatProductConversionQty(input.perBox);
  const loose = formatProductConversionQty(input.loose);
  const hasLoose = input.loose > 0;
  if (input.hubIsPack) {
    if (hasLoose) return `${boxes} + ${loose} ÷ ${perBox} =`;
    return `${boxes} =`;
  }
  if (hasLoose) return `${boxes} × ${perBox} + ${loose} =`;
  return `${boxes} × ${perBox} =`;
}

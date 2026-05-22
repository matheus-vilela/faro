import {
  convertQuantityWithHubCodes,
  expandMassVolumeConversionSiblings,
  normalizeProductConversionRowsToPrimaryOne,
  type UnitConversionCodeRow,
} from "@/lib/companyUnits/convert";
import { toProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

const FACTOR_EPS = 1e-6;

export type MergeUnitResolution =
  | { kind: "same"; factor: 1 }
  | {
      kind: "auto";
      factor: number;
      bridgeUnit: string;
    }
  | { kind: "manual" }
  | { kind: "ambiguous" };

export function prepareProductConversionsForMerge(
  hubCode: string,
  rows: UnitConversionCodeRow[],
): UnitConversionCodeRow[] {
  const hub = hubCode.trim();
  if (!hub) return [];
  const hubRows = rows.filter(
    (r) =>
      r.primary_unit_code.trim().toLowerCase() === hub.toLowerCase() &&
      r.secondary_unit_code.trim().toLowerCase() !== hub.toLowerCase(),
  );
  const normalized = normalizeProductConversionRowsToPrimaryOne(hubRows, hub);
  return expandMassVolumeConversionSiblings(hub, normalized);
}

function collectBridgeUnitCodes(
  winnerHub: string,
  winnerRows: UnitConversionCodeRow[],
  loserHub: string,
  loserRows: UnitConversionCodeRow[],
): string[] {
  const codes = new Set<string>();
  const add = (c: string) => {
    const t = c.trim();
    if (t) codes.add(t);
  };
  add(winnerHub);
  add(loserHub);
  for (const r of winnerRows) {
    add(r.primary_unit_code);
    add(r.secondary_unit_code);
  }
  for (const r of loserRows) {
    add(r.primary_unit_code);
    add(r.secondary_unit_code);
  }
  return [...codes];
}

/**
 * Fator para converter quantidades do hub do produto removido para o hub do que permanece:
 * qty_winner = qty_loser * factor
 */
export function resolveMergeUnitFactor(params: {
  winnerHub: string;
  winnerConversions: UnitConversionCodeRow[];
  loserHub: string;
  loserConversions: UnitConversionCodeRow[];
}): MergeUnitResolution {
  const winnerHub = params.winnerHub.trim();
  const loserHub = params.loserHub.trim();
  if (!winnerHub || !loserHub) return { kind: "manual" };
  if (winnerHub.toLowerCase() === loserHub.toLowerCase()) {
    return { kind: "same", factor: 1 };
  }

  const wConv = prepareProductConversionsForMerge(
    winnerHub,
    params.winnerConversions,
  );
  const lConv = prepareProductConversionsForMerge(
    loserHub,
    params.loserConversions,
  );
  const bridges = collectBridgeUnitCodes(
    winnerHub,
    wConv,
    loserHub,
    lConv,
  );

  let found: { factor: number; bridgeUnit: string } | null = null;

  const winnerNorm = winnerHub.toLowerCase();
  const loserNorm = loserHub.toLowerCase();

  for (const bridge of bridges) {
    const bridgeNorm = bridge.trim().toLowerCase();
    if (bridgeNorm === winnerNorm || bridgeNorm === loserNorm) {
      continue;
    }

    const inBridgePerLoserHub = convertQuantityWithHubCodes(
      1,
      loserHub,
      bridge,
      loserHub,
      lConv,
    );
    const inBridgePerWinnerHub = convertQuantityWithHubCodes(
      1,
      winnerHub,
      bridge,
      winnerHub,
      wConv,
    );
    if (
      inBridgePerLoserHub == null ||
      inBridgePerWinnerHub == null ||
      !Number.isFinite(inBridgePerLoserHub) ||
      !Number.isFinite(inBridgePerWinnerHub) ||
      inBridgePerWinnerHub <= 0
    ) {
      continue;
    }
    const factor = inBridgePerLoserHub / inBridgePerWinnerHub;
    if (!Number.isFinite(factor) || factor <= 0) continue;

    if (found != null && Math.abs(found.factor - factor) > FACTOR_EPS) {
      return { kind: "ambiguous" };
    }
    found = { factor, bridgeUnit: bridge };
  }

  if (found) {
    return {
      kind: "auto",
      factor: found.factor,
      bridgeUnit: found.bridgeUnit,
    };
  }
  return { kind: "manual" };
}

/** Regras do produto removido expressas na unidade de estoque do que permanece. */
export function rebaseLoserConversionsToWinnerHub(
  loserRows: UnitConversionCodeRow[],
  loserHub: string,
  winnerHub: string,
  loserToWinnerFactor: number,
): UnitConversionCodeRow[] {
  const hub = winnerHub.trim();
  const loseHub = loserHub.trim().toLowerCase();
  const f = loserToWinnerFactor;
  if (!hub || !loseHub || !Number.isFinite(f) || f <= 0) return [];

  const out: UnitConversionCodeRow[] = [];
  for (const r of loserRows) {
    if (r.primary_unit_code.trim().toLowerCase() !== loseHub) continue;
    const sec = r.secondary_unit_code.trim();
    if (!sec || sec.toLowerCase() === hub.toLowerCase()) continue;
    const p = Number(r.primary_qty);
    const s = Number(r.secondary_qty);
    if (!Number.isFinite(p) || !Number.isFinite(s) || p <= 0 || s <= 0) {
      continue;
    }
    const secondaryQty = s / (p * f);
    if (!Number.isFinite(secondaryQty) || secondaryQty <= 0) continue;
    out.push({
      primary_unit_code: hub,
      primary_qty: 1,
      secondary_unit_code: sec,
      secondary_qty: secondaryQty,
    });
  }
  return out;
}

function dedupeConversionsBySecondary(
  rows: UnitConversionCodeRow[],
  hubCode: string,
): UnitConversionCodeRow[] {
  const hub = hubCode.trim().toLowerCase();
  const bySec = new Map<string, UnitConversionCodeRow>();
  for (const r of rows) {
    if (r.primary_unit_code.trim().toLowerCase() !== hub) continue;
    const sec = r.secondary_unit_code.trim().toLowerCase();
    if (!sec || sec === hub) continue;
    bySec.set(sec, r);
  }
  return [...bySec.values()].sort((a, b) =>
    a.secondary_unit_code.localeCompare(b.secondary_unit_code, "pt-BR"),
  );
}

export function buildMergedUnitConversionsForMerge(params: {
  winnerHub: string;
  winnerConversions: UnitConversionCodeRow[];
  loserHub: string;
  loserConversions: UnitConversionCodeRow[];
  loserToWinnerFactor: number;
}): UnitConversionCodeRow[] {
  const winnerHub = params.winnerHub.trim();
  const wBase = prepareProductConversionsForMerge(
    winnerHub,
    params.winnerConversions,
  );
  const lBase = prepareProductConversionsForMerge(
    params.loserHub,
    params.loserConversions,
  );
  const rebasedLoser = rebaseLoserConversionsToWinnerHub(
    lBase,
    params.loserHub,
    winnerHub,
    params.loserToWinnerFactor,
  );
  const merged = dedupeConversionsBySecondary(
    [...wBase, ...rebasedLoser],
    winnerHub,
  );
  return expandMassVolumeConversionSiblings(winnerHub, merged);
}

export function draftsToConversionRows(
  drafts: ProductUnitConversionDraft[],
): UnitConversionCodeRow[] {
  return drafts.map((r) => ({
    primary_unit_code: r.primary_unit_code,
    secondary_unit_code: r.secondary_unit_code,
    primary_qty: Number(r.primary_qty),
    secondary_qty: Number(r.secondary_qty),
  }));
}

export function mergedConversionsToJson(
  rows: UnitConversionCodeRow[],
): ReturnType<typeof toProductUnitConversionsJson> {
  return toProductUnitConversionsJson(rows);
}

export function convertLoserQuantityToWinner(
  qty: number,
  factor: number,
): number | null {
  if (!Number.isFinite(qty) || !Number.isFinite(factor) || factor <= 0) {
    return null;
  }
  const out = qty * factor;
  return Number.isFinite(out) ? out : null;
}

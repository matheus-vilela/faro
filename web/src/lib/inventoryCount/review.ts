import { formatMoneyPtBr } from "@/lib/formatMoneyPtBr";

export type CountReviewPoint = {
  listingId: string | null;
  listingName: string;
  groupName: string;
  countedQty: number | null;
};

export type CountReviewProduct = {
  productId: string;
  name: string;
  unit: string;
  expectedQty: number;
  countedQty: number | null;
  unitCost: number;
  impact: number;
  variationPct: number | null;
  inBand: boolean | null;
  tolerancePct: number;
  points: CountReviewPoint[];
  missingPoints: { listingName: string; groupName: string }[];
  updatesStock: boolean;
  lineIds: string[];
};

export function countUnitCost(params: {
  average_cost?: number | null;
  last_unit_value?: number | null;
}): number {
  const avg = Number(params.average_cost);
  if (Number.isFinite(avg) && avg > 0) return avg;
  const last = Number(params.last_unit_value);
  if (Number.isFinite(last) && last > 0) return last;
  return 0;
}

export function countVariationPct(
  expected: number,
  counted: number | null,
): number | null {
  if (counted == null) return null;
  if (expected === 0) return counted === 0 ? 0 : 100;
  return ((counted - expected) / Math.abs(expected)) * 100;
}

export function countQtyInBand(
  expected: number,
  counted: number | null,
  tolerancePct: number,
): boolean | null {
  if (counted == null) return null;
  if (expected === 0) return Math.abs(counted) <= 0.0001;
  return Math.abs(counted - expected) <= (Math.abs(expected) * Math.max(tolerancePct, 0)) / 100;
}

export function formatCountImpact(value: number): string {
  return formatMoneyPtBr(value);
}

type RawLine = {
  id: string;
  product_id: string;
  expected_qty: number;
  counted_qty: number | null;
  tolerance_pct: number;
  listing_id?: string | null;
  listing_name?: string | null;
  group_name?: string | null;
  product_name: string;
  product_unit: string;
  average_cost?: number | null;
  last_unit_value?: number | null;
};

export type RequiredCountPoint = {
  productId: string;
  listingId: string;
  listingName: string;
  groupName: string;
};

export function aggregateCountReview(params: {
  lines: RawLine[];
  requiredPoints: RequiredCountPoint[];
}): CountReviewProduct[] {
  const byProduct = new Map<string, RawLine[]>();
  for (const line of params.lines) {
    const list = byProduct.get(line.product_id) ?? [];
    list.push(line);
    byProduct.set(line.product_id, list);
  }

  const requiredByProduct = new Map<string, RequiredCountPoint[]>();
  for (const point of params.requiredPoints) {
    const list = requiredByProduct.get(point.productId) ?? [];
    list.push(point);
    requiredByProduct.set(point.productId, list);
  }

  const out: CountReviewProduct[] = [];
  for (const [productId, lines] of byProduct) {
    const first = lines[0];
    const expectedQty = Math.max(...lines.map((l) => l.expected_qty));
    const anyNull = lines.some((l) => l.counted_qty == null);
    const countedQty = anyNull
      ? null
      : lines.reduce((sum, l) => sum + (l.counted_qty ?? 0), 0);
    const unitCost = countUnitCost({
      average_cost: first.average_cost,
      last_unit_value: first.last_unit_value,
    });
    const sessionListingIds = new Set(
      lines.map((l) => l.listing_id).filter((id): id is string => Boolean(id)),
    );
    const required = requiredByProduct.get(productId) ?? [];
    const missingPoints = required
      .filter((p) => !sessionListingIds.has(p.listingId))
      .map((p) => ({ listingName: p.listingName, groupName: p.groupName }));
    const updatesStock = countedQty != null && missingPoints.length === 0;
    const variation = countVariationPct(expectedQty, countedQty);
    const tolerancePct = first.tolerance_pct;
    out.push({
      productId,
      name: first.product_name,
      unit: first.product_unit,
      expectedQty,
      countedQty,
      unitCost,
      impact:
        countedQty == null ? 0 : Math.abs(countedQty - expectedQty) * unitCost,
      variationPct: variation,
      inBand: countQtyInBand(expectedQty, countedQty, tolerancePct),
      tolerancePct,
      points: lines.map((l) => ({
        listingId: l.listing_id ?? null,
        listingName: (l.listing_name ?? "").trim() || "Listagem",
        groupName: (l.group_name ?? "").trim(),
        countedQty: l.counted_qty,
      })),
      missingPoints,
      updatesStock,
      lineIds: lines.map((l) => l.id),
    });
  }
  return out;
}

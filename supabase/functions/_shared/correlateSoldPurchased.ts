/**
 * Normaliza JSON da IA da correlação vendido × comprado.
 * Mantido em _shared para a edge function persistir só IDs válidos.
 */
export type CorrelateKind = "same_item" | "recipe" | "unmatched";

export type CorrelateAssignment = {
  soldId: string;
  kind: CorrelateKind;
  purchasedIds: string[];
  ingredientLabels: Record<string, string>;
  confidence: number;
  reasonPt: string;
};

function asIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return String(o.id ?? o.purchased ?? o.purchased_id ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function ingredientLabelsFrom(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? o.purchased ?? o.purchased_id ?? "").trim();
    const label = String(o.label ?? o.hint ?? o.name ?? "").trim();
    if (id) out[id] = label || "Insumo";
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return n / 100;
  return Math.min(1, Math.max(0, n));
}

export function parseCorrelateAssignments(
  raw: unknown,
  soldIds: Set<string>,
  purchasedIds: Set<string>,
): CorrelateAssignment[] {
  const list = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { assignments?: unknown }).assignments)
      ? (raw as { assignments: unknown[] }).assignments
      : [];
  const out: CorrelateAssignment[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const soldId = String(r.sold ?? r.sold_id ?? "").trim();
    if (!soldIds.has(soldId)) continue;
    const kindRaw = String(r.kind ?? "").trim().toLowerCase();
    const kind: CorrelateKind =
      kindRaw === "recipe" || kindRaw === "ficha" || kindRaw === "ficha_tecnica"
        ? "recipe"
        : kindRaw === "unmatched" || kindRaw === "none" || kindRaw === "skip"
          ? "unmatched"
          : "same_item";
    const fromPurchased = asIdList(r.purchased).filter((id) => purchasedIds.has(id));
    const labels = ingredientLabelsFrom(r.ingredients);
    const fromIngredients = Object.keys(labels).filter((id) => purchasedIds.has(id));
    const ranked =
      kind === "recipe"
        ? [...fromIngredients, ...fromPurchased.filter((id) => !labels[id])]
        : fromPurchased;
    const unique: string[] = [];
    for (const id of ranked) {
      if (!unique.includes(id)) unique.push(id);
    }
    out.push({
      soldId,
      kind: unique.length === 0 && kind !== "unmatched" ? "unmatched" : kind,
      purchasedIds: unique,
      ingredientLabels: labels,
      confidence: clamp01(Number(r.confidence ?? 0)),
      reasonPt: String(r.reason_pt ?? r.reason ?? "").trim(),
    });
  }
  return out;
}

export function finalizeCorrelateAssignments(
  soldIds: string[],
  parsed: CorrelateAssignment[],
): CorrelateAssignment[] {
  const bySold = new Map<string, CorrelateAssignment>();
  for (const row of parsed) {
    const prev = bySold.get(row.soldId);
    if (!prev || row.confidence > prev.confidence) bySold.set(row.soldId, row);
  }

  const sameItem = [...bySold.values()]
    .filter((row) => row.kind === "same_item" && row.purchasedIds[0])
    .sort((a, b) => b.confidence - a.confidence);
  const usedSame = new Set<string>();
  for (const row of sameItem) {
    const available = row.purchasedIds.filter((id) => !usedSame.has(id));
    if (!available[0]) {
      bySold.set(row.soldId, {
        ...row,
        kind: "unmatched",
        purchasedIds: [],
        reasonPt: row.reasonPt || "A compra candidata já foi usada em outro vínculo.",
      });
      continue;
    }
    usedSame.add(available[0]);
    bySold.set(row.soldId, { ...row, purchasedIds: available });
  }

  for (const row of bySold.values()) {
    if (row.kind !== "recipe") continue;
    const ingredients = row.purchasedIds.filter((id) => !usedSame.has(id));
    bySold.set(row.soldId, {
      ...row,
      purchasedIds: ingredients,
      reasonPt:
        ingredients.length === 0
          ? row.reasonPt ||
            "Parece ficha técnica; nenhum insumo livre na lista de compras."
          : row.reasonPt,
    });
  }

  return soldIds.map((soldId) => {
    const row = bySold.get(soldId);
    if (row) return row;
    return {
      soldId,
      kind: "unmatched" as const,
      purchasedIds: [],
      ingredientLabels: {},
      confidence: 0,
      reasonPt: "A IA não devolveu este item; ficou sem par.",
    };
  });
}

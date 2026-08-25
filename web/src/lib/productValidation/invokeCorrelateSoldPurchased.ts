import {
  finalizeAiAssignments,
  mapAiAssignmentsToValidationResult,
  parseAiCorrelationRaw,
  type AiCorrelationAssignment,
} from "@/lib/productValidation/aiCorrelation";
import type { ProductValidationResult } from "@/lib/productValidation/types";
import { compareTurnoverDesc, type ProductSetupItem } from "@/lib/productSetupQueue";
import { formatSupabaseFunctionError, supabase } from "@/lib/supabase";

function isSoldSide(item: ProductSetupItem): boolean {
  return (
    item.kind === "sold_unlinked" || item.kind === "recipe_without_ingredients"
  );
}

function isPurchaseSide(item: ProductSetupItem): boolean {
  return item.kind === "purchase_unlinked";
}

export function splitQueueForCorrelation(items: ProductSetupItem[]): {
  sold: ProductSetupItem[];
  purchased: ProductSetupItem[];
  leftover: ProductSetupItem[];
} {
  return {
    sold: items.filter(isSoldSide),
    purchased: items.filter(isPurchaseSide),
    leftover: items.filter((item) => !isSoldSide(item) && !isPurchaseSide(item)),
  };
}

function coerceAssignments(
  raw: unknown,
  soldIds: string[],
  purchasedIds: Set<string>,
): AiCorrelationAssignment[] {
  const list = Array.isArray(raw) ? raw : [];
  const looksFinal =
    list[0] &&
    typeof list[0] === "object" &&
    "soldId" in (list[0] as object);
  if (looksFinal) {
    const parsed = (list as AiCorrelationAssignment[]).filter((row) =>
      soldIds.includes(row.soldId),
    );
    return finalizeAiAssignments(soldIds, parsed);
  }
  return finalizeAiAssignments(
    soldIds,
    parseAiCorrelationRaw({ assignments: raw }, new Set(soldIds), purchasedIds),
  );
}

/** Depois de confirmar um vínculo, tira do resultado o que já saiu da fila — sem nova chamada à IA. */
export function filterValidationToQueue(
  result: ProductValidationResult,
  items: ProductSetupItem[],
): ProductValidationResult {
  const ids = new Set(items.map((row) => row.productId));
  const { leftover } = splitQueueForCorrelation(items);
  const sameItem = result.sameItem
    .filter((row) => row.band === "high" && ids.has(row.sold.productId))
    .map((row) => ({
      ...row,
      candidates: row.candidates.filter((c) => ids.has(c.purchase.productId)),
    }))
    .filter((row) => row.candidates.length > 0);
  const recipes = result.recipes
    .filter((row) => row.band === "high" && ids.has(row.sold.productId))
    .map((row) => ({
      ...row,
      ingredients: row.ingredients.filter((i) =>
        ids.has(i.purchase.productId),
      ),
    }));
  const covered = new Set<string>();
  for (const row of sameItem) {
    covered.add(row.sold.productId);
    const first = row.candidates[0]?.purchase.productId;
    if (first) covered.add(first);
  }
  for (const row of recipes) {
    covered.add(row.sold.productId);
    for (const ing of row.ingredients) covered.add(ing.purchase.productId);
  }
  const residual = items.filter((row) => !covered.has(row.productId));
  const leftoverKeys = new Set(leftover.map((row) => row.key));
  const residualMerged = [
    ...leftover,
    ...residual.filter((row) => !leftoverKeys.has(row.key)),
  ].sort(compareTurnoverDesc);
  const unmatchedSold = (result.unmatchedSold ?? []).filter((row) =>
    ids.has(row.productId),
  );
  return {
    sameItem,
    recipes,
    residual: residualMerged,
    unmatchedSold,
    stats: {
      sold: items.filter(isSoldSide).length,
      purchases: items.filter(isPurchaseSide).length,
      sameItem: sameItem.length,
      recipes: recipes.length,
      residual: residualMerged.length,
    },
  };
}

export async function invokeCorrelateSoldPurchased(input: {
  companyId: string;
  items: ProductSetupItem[];
}): Promise<
  | { ok: true; result: ProductValidationResult; runId: string | null }
  | { ok: false; error: string }
> {
  const { sold, purchased, leftover } = splitQueueForCorrelation(input.items);
  if (sold.length === 0) {
    return {
      ok: true,
      runId: null,
      result: {
        sameItem: [],
        recipes: [],
        residual: leftover.concat(purchased),
        unmatchedSold: [],
        stats: {
          sold: 0,
          purchases: purchased.length,
          sameItem: 0,
          recipes: 0,
          residual: leftover.length + purchased.length,
        },
      },
    };
  }

  const { data, error } = await supabase.functions.invoke(
    "correlate-sold-purchased",
    {
      body: {
        company_id: input.companyId,
        sold: sold.map((row) => ({
          product_id: row.productId,
          name: row.name,
          unit: row.unit,
          quantity: row.quantity,
          recipe_id: row.recipeId ?? null,
        })),
        purchased: purchased.map((row) => ({
          product_id: row.productId,
          name: row.name,
          unit: row.unit,
          quantity: row.quantity,
        })),
      },
    },
  );

  if (error) {
    return { ok: false, error: formatSupabaseFunctionError(error) };
  }
  const payload = data as {
    ok?: boolean;
    error?: string;
    run_id?: string;
    assignments?: unknown;
  };
  if (!payload?.ok) {
    const code = payload?.error ?? "correlate_failed";
    const messages: Record<string, string> = {
      openai_not_configured:
        "A IA não está configurada neste ambiente (OPENAI_API_KEY).",
      unauthorized: "Sessão expirada. Entre novamente.",
      forbidden: "Sem permissão para esta unidade.",
    };
    return { ok: false, error: messages[code] ?? code };
  }

  const soldIds = sold.map((row) => row.productId);
  const purchasedIds = new Set(purchased.map((row) => row.productId));
  const assignments = coerceAssignments(
    payload.assignments,
    soldIds,
    purchasedIds,
  );
  return {
    ok: true,
    runId: payload.run_id ? String(payload.run_id) : null,
    result: mapAiAssignmentsToValidationResult({
      sold,
      purchased,
      leftover,
      assignments,
    }),
  };
}

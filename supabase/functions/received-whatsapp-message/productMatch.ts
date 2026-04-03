import type { ExtractedExpenseItem } from "./openaiExpense.ts";

export type ProductRow = { id: string; name: string };

/** Só vínculo automático por similaridade se ≥ este valor (95%). */
export const AUTO_LINK_MIN_SIMILARITY = 0.95;

export type ItemWithProductMatch = ExtractedExpenseItem & {
  productId?: string | null;
  productMatch?: {
    resolvedProductId: string | null;
    /** Preenchido só se similaridade ≥ AUTO_LINK_MIN_SIMILARITY (ou alias/nome exato). */
    suggestedProductId: string | null;
    suggestedProductName: string | null;
    /** Melhor score encontrado; abaixo de 95% não há sugestão de produto existente. */
    suggestedScore: number;
    needsConfirmation: boolean;
  };
};

export type ResolveProductMatchesResult = {
  items: ItemWithProductMatch[];
  requiresProductConfirmation: boolean;
};

/** Mesma ideia da função SQL normalize_invoice_product_label. */
export function normalizeInvoiceProductLabel(raw: string): string {
  const t = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return t.replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

/** 0..1 — 1 = igual. */
export function stringSimilarity(a: string, b: string): number {
  const x = normalizeInvoiceProductLabel(a);
  const y = normalizeInvoiceProductLabel(b);
  if (x.length === 0 && y.length === 0) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 1;
  const d = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  return 1 - d / maxLen;
}

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function resolveProductMatches(
  supabase: SupabaseClient,
  companyId: string,
  items: ExtractedExpenseItem[],
): Promise<ResolveProductMatchesResult> {
  const { data: aliasRows, error: aliasErr } = await supabase
    .from("product_invoice_line_aliases")
    .select("normalized_label, product_id")
    .eq("company_id", companyId);

  if (aliasErr) {
    console.error("[productMatch] aliases:", aliasErr.message);
  }

  const aliasMap = new Map<string, string>();
  for (const row of (aliasRows ?? []) as Array<{
    normalized_label: string;
    product_id: string;
  }>) {
    aliasMap.set(row.normalized_label, row.product_id);
  }

  const { data: prodRows, error: prodErr } = await supabase
    .from("products")
    .select("id, name")
    .eq("company_id", companyId);

  if (prodErr) {
    console.error("[productMatch] products:", prodErr.message);
  }

  const products = (prodRows ?? []) as ProductRow[];
  const out: ItemWithProductMatch[] = [];
  let requiresProductConfirmation = false;

  for (const it of items) {
    const name = (it.productName ?? "").trim() || "Item";
    const nl = normalizeInvoiceProductLabel(name);

    let resolvedId: string | null = null;
    let suggestedId: string | null = null;
    let suggestedName: string | null = null;
    let bestScore = 0;

    const fromAlias = aliasMap.get(nl);
    if (fromAlias) {
      resolvedId = fromAlias;
    } else {
      for (const p of products) {
        const pn = normalizeInvoiceProductLabel(p.name);
        if (pn === nl) {
          resolvedId = p.id;
          break;
        }
        const sc = stringSimilarity(name, p.name);
        if (sc > bestScore) {
          bestScore = sc;
          suggestedId = p.id;
          suggestedName = p.name;
        }
      }
      if (
        !resolvedId &&
        suggestedId != null &&
        bestScore >= AUTO_LINK_MIN_SIMILARITY
      ) {
        resolvedId = suggestedId;
      }
    }

    const needsConfirmation = resolvedId == null;
    if (needsConfirmation) {
      requiresProductConfirmation = true;
    }

    const strongEnough = bestScore >= AUTO_LINK_MIN_SIMILARITY;
    const suggestedIdOut =
      strongEnough && suggestedId != null ? suggestedId : null;
    const suggestedNameOut =
      strongEnough && suggestedName != null ? suggestedName : null;

    out.push({
      ...it,
      productId: resolvedId,
      productMatch: {
        resolvedProductId: resolvedId,
        suggestedProductId: suggestedIdOut,
        suggestedProductName: suggestedNameOut,
        suggestedScore: Math.round(bestScore * 1000) / 1000,
        needsConfirmation,
      },
    });
  }

  return { items: out, requiresProductConfirmation };
}

export async function upsertProductInvoiceAlias(
  supabase: SupabaseClient,
  companyId: string,
  invoiceLineProductName: string,
  productId: string,
): Promise<void> {
  const nl = normalizeInvoiceProductLabel(invoiceLineProductName);
  if (!nl) return;
  const { error } = await supabase.from("product_invoice_line_aliases").upsert(
    {
      company_id: companyId,
      normalized_label: nl,
      product_id: productId,
    },
    { onConflict: "company_id,normalized_label" },
  );
  if (error) {
    console.error("[productMatch] upsert alias:", error.message);
  }
}

/**
 * Embeddings OpenAI para RAG no match de produtos (importação NF-e).
 * Modelo padrão: text-embedding-3-small (1536 dimensões — alinhado a products.name_embedding).
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const EMBEDDING_MODEL_DEFAULT = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

export function embeddingModelFromEnv(): string {
  try {
    const m =
      typeof Deno !== "undefined"
        ? Deno.env.get("OPENAI_EMBEDDING_MODEL")?.trim()
        : "";
    return m || EMBEDDING_MODEL_DEFAULT;
  } catch {
    return EMBEDDING_MODEL_DEFAULT;
  }
}

/** Serialização para RPC `match_products_by_name_embedding` (cast ::vector no Postgres). */
export function vectorToPgText(vec: number[]): string {
  if (!vec.length) return "[]";
  return `[${vec.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}

export async function embedTextsOpenAI(
  apiKey: string,
  texts: string[],
  model: string,
): Promise<number[][]> {
  if (!apiKey.trim() || texts.length === 0) return [];
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts.map((t) => (t.length > 8000 ? t.slice(0, 8000) : t)),
      dimensions: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = await res.json();
  const arr = data?.data as Array<{ embedding?: number[]; index?: number }> | undefined;
  if (!Array.isArray(arr) || !arr.length) {
    throw new Error("OpenAI embeddings: resposta sem data[]");
  }
  const sorted = [...arr].sort(
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
  );
  return sorted.map((d) => {
    const e = d.embedding;
    if (!Array.isArray(e) || e.length !== EMBEDDING_DIM) {
      throw new Error(
        `OpenAI embeddings: dimensão inesperada ${Array.isArray(e) ? e.length : 0} (esperado ${EMBEDDING_DIM})`,
      );
    }
    return e;
  });
}

/** Garante embeddings para produtos ativos da empresa que ainda não têm `name_embedding`. */
export async function ensureCompanyProductNameEmbeddings(
  supabase: SupabaseClient,
  companyId: string,
  apiKey: string,
  model: string,
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  const batchSize = 48;

  for (;;) {
    const { data: rows, error: qErr } = await supabase
      .from("products")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .is("name_embedding", null)
      .limit(batchSize);

    if (qErr) {
      console.error("[productEmbedding] list null embeddings:", qErr.message);
      errors += 1;
      break;
    }
    const list = (rows ?? []) as Array<{ id: string; name: string }>;
    if (list.length === 0) break;

    let embeddings: number[][];
    try {
      embeddings = await embedTextsOpenAI(
        apiKey,
        list.map((r) => (r.name ?? "").trim() || "—"),
        model,
      );
    } catch (e) {
      console.error("[productEmbedding] embed batch:", e);
      errors += 1;
      break;
    }

    for (let i = 0; i < list.length; i += 1) {
      const row = list[i]!;
      const emb = embeddings[i];
      if (!emb) {
        errors += 1;
        continue;
      }
      const vecText = vectorToPgText(emb);
      const { error: uErr } = await supabase.rpc("products_set_name_embedding", {
        p_product_id: row.id,
        p_company_id: companyId,
        p_embedding_text: vecText,
      });
      if (uErr) {
        console.error("[productEmbedding] rpc set:", row.id, uErr.message);
        errors += 1;
      } else {
        updated += 1;
      }
    }
  }

  return { updated, errors };
}

/** Mescla scores lexicais com vizinhos por cosseno (RAG leve). */
export async function augmentScoredListWithVectorNeighbors(params: {
  supabase: SupabaseClient;
  companyId: string;
  invoiceLineName: string;
  scoredList: Array<{
    product: {
      id: string;
      name: string;
      unit: string | null;
      barcode?: string | null;
      ncm?: string | null;
    };
    score: number;
    detail: string;
  }>;
  productById: Map<string, { id: string; name: string; unit: string | null; barcode?: string | null; ncm?: string | null }>;
  openaiKey: string;
  model: string;
  matchCount?: number;
}): Promise<void> {
  const {
    supabase,
    companyId,
    invoiceLineName,
    scoredList,
    productById,
    openaiKey,
    model,
    matchCount = 24,
  } = params;
  if (!openaiKey.trim() || !invoiceLineName.trim()) return;

  let queryVec: number[];
  try {
    const vecs = await embedTextsOpenAI(openaiKey, [invoiceLineName.trim()], model);
    queryVec = vecs[0]!;
  } catch (e) {
    console.error("[productEmbedding] query embed:", e);
    return;
  }

  const { data, error } = await supabase.rpc("match_products_by_name_embedding", {
    p_company_id: companyId,
    p_query_embedding: vectorToPgText(queryVec),
    p_match_count: matchCount,
  });
  if (error) {
    console.error("[productEmbedding] match rpc:", error.message);
    return;
  }

  const rows = (data ?? []) as Array<{
    product_id: string;
    product_name: string;
    product_unit: string | null;
    product_barcode: string | null;
    product_ncm: string | null;
    distance: number;
  }>;

  const byProductId = new Map(scoredList.map((s) => [s.product.id, s]));

  for (const r of rows) {
    const D = Number(r.distance);
    if (!Number.isFinite(D)) continue;
    // Cosine distance em [0, 2] aprox.; mapear para score 0–100
    const semantic = Math.max(0, Math.min(100, (1 - D / 2) * 100));
    if (semantic < 12) continue;

    const existing = byProductId.get(r.product_id);
    if (existing) {
      const merged = Math.max(existing.score, semantic * 0.92);
      if (merged > existing.score + 0.01) {
        existing.score = merged;
        existing.detail = `${existing.detail}; RAG ${semantic.toFixed(0)}`;
      }
      continue;
    }
    const p = productById.get(r.product_id);
    if (!p) continue;
    scoredList.push({
      product: p,
      score: semantic * 0.88,
      detail: `RAG semântico ${semantic.toFixed(0)} (cos dist ${D.toFixed(3)})`,
    });
    byProductId.set(r.product_id, scoredList[scoredList.length - 1]!);
  }

  scoredList.sort((a, b) => b.score - a.score);
}

/** Atualiza embedding do produto recém-criado (para o RAG ver na mesma importação). */
export async function embedSingleProductIfMissing(
  supabase: SupabaseClient,
  companyId: string,
  productId: string,
  productName: string,
): Promise<void> {
  let apiKey = "";
  try {
    apiKey =
      typeof Deno !== "undefined" ? Deno.env.get("OPENAI_API_KEY") ?? "" : "";
  } catch {
    return;
  }
  if (!apiKey.trim()) return;
  const model = embeddingModelFromEnv();
  try {
    const vec = (await embedTextsOpenAI(apiKey, [productName.trim() || "—"], model))[0]!;
    const { error } = await supabase.rpc("products_set_name_embedding", {
      p_product_id: productId,
      p_company_id: companyId,
      p_embedding_text: vectorToPgText(vec),
    });
    if (error) console.error("[productEmbedding] single rpc:", error.message);
  } catch (e) {
    console.error("[productEmbedding] single:", e);
  }
}

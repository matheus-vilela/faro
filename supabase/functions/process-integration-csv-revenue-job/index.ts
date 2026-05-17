/**
 * Processa `integration_csv_revenue_import_jobs` em **várias invocações** (cursor
 * `csv_resume_row_index` + auto-disparo com `resume: true` e `EdgeRuntime.waitUntil`),
 * até percorrer todo o CSV: coluna "Total recebido(R$)" + `data_consumo`.
 * Lançamento: **venda de produto** (`entry_mode: product_sale`), produto pelo nome
 * (coluna Produto / Nome do produto, igual ao cadastro), **quantidade** na coluna **Quant.** (aliases),
 * **gross_amount** = total da coluna "Total recebido(R$)", **pricing_mode: total**.
 * Título da receita: nome do produto na linha.
 * Categoria financeira (folha RECEITA OPERACIONAL): heurísticas PT-BR + opcionalmente um único
 * prompt OpenAI por chunk (`OPENAI_API_KEY`, `OPENAI_REVENUE_CLASSIFY_MODEL`) mapeando o rótulo
 * da linha para uma folha existente (ex.: vendas de bebidas, taxa de serviço, delivery).
 * Produtos auto-criados: `stock_control_type`, `product_operational_config` (AUTO/CONFIGURADO) e
 * vínculo em `product_category_assignments` alinhados ao tipo inferido e ao catálogo da empresa.
 *
 * Autenticação: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 * Corpo inicial (webhook): `{ "job_id" }` ou `{ "record": { "id" } }`.
 * Continuação (interna): `{ "job_id", "resume": true }`.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  batchClassifyRevenueLeavesWithOpenAi,
  classifyRevenueCategoryHeuristic,
  deriveOperationalTypeForAutoProduct,
  filterOperationalRevenueLeaves,
  leafById,
  mapOperationalTypeToStockControl,
  needsOpenAiRefinement,
  pickDefaultRevenueLeaf,
  suggestCompanyProductCatalogCategoryId,
  type RevenueOperationalLeaf,
  type StoredRevenueCat,
} from "../_shared/epocCsvRevenueClassification.ts";
import { sanitizeCatalogProductName } from "../_shared/productImport/canonicalName.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COL_TOTAL_RECEBIDO = "Total recebido(R$)";
/** Cabeçalhos aceites para o nome da linha (título do lançamento e match de produto). */
const COL_PRODUTO_ALIASES = [
  "Produto",
  "Nome do produto",
  "Nome Produto",
  "Descrição",
  "Descricao",
];
/** Coluna de quantidade vendida (normalização ignora acentos e espaços no cabeçalho). */
const COL_QUANT_ALIASES = [
  "Quant.",
  "Quant",
  "Quantidade",
  "Qtd.",
  "Qtd",
  "QTDE",
  "Qtde",
  "Qtde.",
];
/**
 * Linhas por invocação: cada linha válida faz RPC `create_revenue_entry` (pesado no Postgres).
 * Valores altos aumentam risco de `statement_timeout` no pool ou no RPC.
 */
const ROWS_HARD_CAP = 20;
/** Orçamento de tempo por invocação (ms); acima disso agenda continuação. */
const TIME_BUDGET_MS = 14_000;
/**
 * Não iniciar nova linha (antes de criar produto/receita) se o orçamento estiver no fim.
 * Não aplica-se se já criámos produto nesta iteração (precisamos do RPC para não ficar órfão).
 */
const TIME_RESERVE_BEFORE_ROW_MS = 5000;
/** Máximo de diagnósticos gravados no metadata em chunks intermediários (evita UPDATE gigante). */
const DIAGNOSTICS_METADATA_CHUNK_CAP = 350;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeHeaderLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

/** Remove NBSP e zero-width; útil em células exportadas do EPOC. */
function sanitizeCell(s: string): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
}

/** Nome de produto para comparar CSV ↔ cadastro (acentos e espaços colapsados). */
function normalizeCatalogName(s: string): string {
  return sanitizeCell(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferUnitFromProductName(
  productName: string,
  catalog: Array<{ id: string; name: string; unit?: string | null }>,
): string {
  const n = normalizeCatalogName(productName);
  if (/\b(kg|quilo|quilos)\b/.test(n)) return "kg";
  if (/\b(g|grama|gramas)\b/.test(n)) return "g";
  if (/\b(l|litro|litros)\b/.test(n)) return "l";
  if (/\b(ml|mililitro|mililitros)\b/.test(n)) return "ml";

  const unitCount = new Map<string, number>();
  for (const p of catalog) {
    const u = sanitizeCell(p.unit ?? "").toLowerCase();
    if (!u) continue;
    unitCount.set(u, (unitCount.get(u) ?? 0) + 1);
  }
  let best = "un";
  let bestCount = -1;
  for (const [u, c] of unitCount.entries()) {
    if (c > bestCount) {
      best = u;
      bestCount = c;
    }
  }
  return best;
}

/** Índice da coluna de quantidade: aliases exactos, depois heurística no cabeçalho já normalizado. */
function resolveQuantColumnIndex(normHeaders: string[]): number {
  for (const alias of COL_QUANT_ALIASES) {
    const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i]!;
    if (h === "quant" || h === "qtd" || h === "qtde" || h === "qty") return i;
    if (h.startsWith("quantidade")) return i;
    if (h.startsWith("qtd")) return i;
    if (h.startsWith("qtde")) return i;
  }
  return -1;
}

/** Índice da coluna de produto: aliases exactos, depois cabeçalho contém "produto" / "descricao". */
function resolveProductColumnIndex(normHeaders: string[]): number {
  for (const alias of COL_PRODUTO_ALIASES) {
    const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i]!;
    if (h.includes("produto")) return i;
    if (h.includes("descricao")) return i;
  }
  return -1;
}

function parseCsvSemicolon(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0]!
    .split(";")
    .map((c) => c.trim().replace(/^"|"$/g, ""));
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    rows.push(lines[i]!.split(";").map((c) => c.trim().replace(/^"|"$/g, "")));
  }
  return { headers, rows };
}

function csvEscapeCell(v: string): string {
  const s = String(v ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const needsQuote = /[",;\n]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needsQuote ? `"${esc}"` : esc;
}

type IgnoredRowReason =
  | "gross_amount_invalid"
  | "entry_date_invalid"
  | "product_name_empty"
  | "quantity_invalid"
  | "product_ambiguous"
  | "product_create_failed";

type IgnoredRowDiagnostic = {
  row_index: number;
  entry_date_raw: string;
  product_name_raw: string;
  quantity_raw: string;
  total_received_raw: string;
  reason: IgnoredRowReason;
  details: string;
  action: string;
};

function diagnosticsToCsv(rows: IgnoredRowDiagnostic[]): string {
  const header = [
    "row_index",
    "data_consumo",
    "produto",
    "quantidade",
    "total_recebido",
    "motivo",
    "detalhe",
    "acao_tomada",
  ];
  const lines = [header.map(csvEscapeCell).join(";")];
  for (const r of rows) {
    lines.push(
      [
        String(r.row_index),
        r.entry_date_raw,
        r.product_name_raw,
        r.quantity_raw,
        r.total_received_raw,
        r.reason,
        r.details,
        r.action,
      ]
        .map(csvEscapeCell)
        .join(";"),
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseFlexibleDate(s: string): string | null {
  const t = sanitizeCell(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return parseBrDate(t);
}

function parseBrDate(s: string): string | null {
  const t = s.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!d || !mo || !y || mo > 12 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseBrMoney(s: string): number | null {
  const t = sanitizeCell(s);
  if (!t) return null;
  let x = t.replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(x)) {
    x = x.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{2}$/.test(x)) {
    x = x.replace(",", ".");
  } else if (/^\d+\.\d{2}$/.test(x)) {
    /* ok */
  } else {
    x = x.replace(/\./g, "").replace(",", ".");
  }
  const v = Number(x);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 100) / 100;
}

/** Quantidade > 0 (inteiro ou decimal PT-BR / en). */
function parseBrQuantity(s: string): number | null {
  const t = sanitizeCell(s);
  if (!t) return null;
  let x = t.replace(/\s/g, "");
  if (/^\d+$/.test(x)) {
    const v = Number(x);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }
  if (/^\d{1,3}(\.\d{3})*,\d+$/.test(x)) {
    x = x.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d+$/.test(x)) {
    x = x.replace(",", ".");
  } else if (/^\d+\.\d+$/.test(x)) {
    /* ok */
  } else {
    x = x.replace(/\./g, "").replace(",", ".");
  }
  const v = Number(x);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * 10_000) / 10_000;
}

async function loadProductCatalog(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<
  | {
      ok: true;
      catalog: Array<{ id: string; name: string; unit?: string | null }>;
    }
  | { ok: false; message: string }
> {
  const { data, error } = await admin
    .from("products")
    .select("id, name, unit")
    .eq("company_id", companyId);
  if (error) {
    console.error(
      "[process-integration-csv-revenue-job] products",
      error.message,
    );
    return { ok: false, message: error.message };
  }
  const catalog = (data ?? []) as Array<{
    id: string;
    name: string;
    unit?: string | null;
  }>;
  return { ok: true, catalog };
}

/**
 * Resolve produto por nome igual ao cadastro (case-insensitive, acentos, espaços),
 * uma linha por match exato após normalização — evita depender do ilike do PostgREST.
 */
function resolveProductIdFromCatalog(
  displayName: string,
  catalog: Array<{ id: string; name: string; unit?: string | null }>,
  cache: Map<string, string | null>,
): string | null {
  const cacheKey = normalizeCatalogName(displayName);
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  if (!cacheKey) {
    cache.set(cacheKey, null);
    return null;
  }
  const matches = catalog.filter(
    (p) => normalizeCatalogName(p.name) === cacheKey,
  );
  if (matches.length === 1) {
    cache.set(cacheKey, matches[0]!.id);
    return matches[0]!.id;
  }
  if (matches.length > 1) {
    cache.set(cacheKey, null);
    return null;
  }
  cache.set(cacheKey, null);
  return null;
}

function extractJobId(body: Record<string, unknown>): string | null {
  if (typeof body.job_id === "string" && body.job_id.trim())
    return body.job_id.trim();
  const rec = body.record as Record<string, unknown> | undefined;
  if (rec && typeof rec.id === "string" && rec.id.trim()) return rec.id.trim();
  if (body.type === "INSERT" && rec?.id) return String(rec.id);
  const nested = body.body ?? body.payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    if (typeof n.job_id === "string" && n.job_id.trim()) return n.job_id.trim();
    const nr = n.record as Record<string, unknown> | undefined;
    if (nr && typeof nr.id === "string" && nr.id.trim()) return nr.id.trim();
  }
  return null;
}

/** Folhas de receita operacional (DRE), exceto deduções. */
async function loadOperationalRevenueLeaves(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<
  | { ok: true; leaves: RevenueOperationalLeaf[] }
  | { ok: false; message: string }
> {
  const { data: rows, error } = await admin
    .from("company_categories")
    .select(
      "id, parent_id, name, ordem, natureza, tipo, ativo, papel_receita_dre",
    )
    .eq("company_id", companyId)
    .eq("natureza", "RECEITA")
    .eq("tipo", "OPERACIONAL")
    .order("ordem", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { ok: false, message: error.message };
  const list = (rows ?? []) as Array<{
    id: string;
    parent_id: string | null;
    name: string;
    ordem?: number | null;
    ativo?: boolean | null;
    papel_receita_dre?: string | null;
  }>;
  const leaves = filterOperationalRevenueLeaves(list);
  if (!leaves.length) {
    return {
      ok: false,
      message:
        "Nao ha categoria de receita operacional (folha) na empresa. Cadastre em Configuracoes > Categorias.",
    };
  }
  return { ok: true, leaves };
}

function scheduleResume(
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  jobId: string,
): void {
  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-integration-csv-revenue-job`;
  const next = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId, resume: true }),
  }).catch((e) =>
    console.error("[process-integration-csv-revenue-job] resume fetch", e),
  );
  try {
    if (
      typeof EdgeRuntime !== "undefined" &&
      typeof EdgeRuntime.waitUntil === "function"
    ) {
      EdgeRuntime.waitUntil(next);
    } else {
      void next;
    }
  } catch {
    void next;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(
      { ok: false, error: "Configuração do servidor incompleta" },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: "Não autorizado" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const jobId = extractJobId(body);
  if (!jobId) {
    return json(
      {
        ok: false,
        error: "Informe job_id ou payload de webhook com record.id",
      },
      400,
    );
  }

  const isResume = body.resume === true || body.phase === "resume";

  let jobRow: Record<string, unknown> | null = null;

  if (!isResume) {
    const { data: claimed, error: claimErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "PROCESSING",
        updated_at: new Date().toISOString(),
        csv_resume_row_index: 0,
      })
      .eq("id", jobId)
      .eq("status", "PENDING")
      .select("*")
      .maybeSingle();

    if (claimErr) {
      return json({ ok: false, error: claimErr.message }, 500);
    }
    if (!claimed) {
      const { data: existing } = await admin
        .from("integration_csv_revenue_import_jobs")
        .select("id, status")
        .eq("id", jobId)
        .maybeSingle();
      if (existing?.status === "COMPLETED") {
        return json({ ok: true, skipped: true, reason: "already_completed" });
      }
      return json(
        {
          ok: false,
          error: "Job não está PENDING (em processamento ou inexistente).",
        },
        409,
      );
    }
    jobRow = claimed as Record<string, unknown>;
  } else {
    const { data: existing, error: loadErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("status", "PROCESSING")
      .maybeSingle();
    if (loadErr) {
      return json({ ok: false, error: loadErr.message }, 500);
    }
    if (!existing) {
      return json(
        {
          ok: false,
          error:
            "Job não encontrado ou não está em PROCESSING (retomada inválida).",
        },
        409,
      );
    }
    jobRow = existing as Record<string, unknown>;
  }

  const job = jobRow as {
    id: string;
    company_id: string;
    storage_bucket: string;
    storage_path: string;
    requested_by: string;
    csv_resume_row_index?: number;
    metadata?: Record<string, unknown> | null;
  };

  const fail = async (msg: string) => {
    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "FAILED",
        error_message: msg.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return json({ ok: false, error: msg }, 422);
  };

  try {
    const leavesLoad = await loadOperationalRevenueLeaves(
      admin,
      job.company_id,
    );
    if (!leavesLoad.ok) {
      return await fail(leavesLoad.message);
    }
    const leaves = leavesLoad.leaves;
    const defaultLeaf = pickDefaultRevenueLeaf(leaves);
    if (!defaultLeaf) {
      return await fail(
        "Nao ha categoria de receita operacional (folha) na empresa. Cadastre em Configuracoes > Categorias.",
      );
    }

    const { data: productCatalogCategories } = await admin
      .from("company_product_categories")
      .select("id, name")
      .eq("company_id", job.company_id);

    const { data: fileBlob, error: dlErr } = await admin.storage
      .from(job.storage_bucket)
      .download(job.storage_path);
    if (dlErr || !fileBlob) {
      return await fail(dlErr?.message ?? "Falha ao baixar CSV do Storage.");
    }
    const text = await fileBlob.text();
    const { headers, rows } = parseCsvSemicolon(text);
    if (headers.length === 0) {
      return await fail("CSV sem cabeçalho.");
    }

    const normHeaders = headers.map(normalizeHeaderLabel);
    const targetNorm = normalizeHeaderLabel(COL_TOTAL_RECEBIDO);
    const totalCol = normHeaders.indexOf(targetNorm);
    if (totalCol < 0) {
      return await fail(
        `Coluna "${COL_TOTAL_RECEBIDO}" não encontrada no CSV (cabeçalhos: ${headers.slice(0, 12).join("; ")}…).`,
      );
    }

    const dataConsumoIdx = normHeaders.indexOf(
      normalizeHeaderLabel("data_consumo"),
    );
    if (dataConsumoIdx < 0) {
      return await fail('Coluna "data_consumo" não encontrada no CSV.');
    }

    const quantCol = resolveQuantColumnIndex(normHeaders);
    if (quantCol < 0) {
      return await fail(
        `Coluna de quantidade não encontrada (tente nomes como Quant., Quantidade, Qtd). Cabeçalhos: ${headers.slice(0, 15).join("; ")}…`,
      );
    }
    const produtoCol = resolveProductColumnIndex(normHeaders);
    if (produtoCol < 0) {
      return await fail(
        `Coluna de produto não encontrada (tente Produto, Nome do produto, Descrição). Cabeçalhos: ${headers.slice(0, 15).join("; ")}…`,
      );
    }

    const productCatalogLoad = await loadProductCatalog(admin, job.company_id);
    if (!productCatalogLoad.ok) {
      return await fail(
        `Falha ao ler o catálogo de produtos: ${productCatalogLoad.message}`,
      );
    }
    const productCatalog = [...productCatalogLoad.catalog];

    const startOffset = Math.max(0, Number(job.csv_resume_row_index ?? 0) || 0);
    if (startOffset > rows.length) {
      return await fail("Cursor de retomada inválido (fora do CSV).");
    }

    const priorMeta =
      job.metadata &&
      typeof job.metadata === "object" &&
      !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};

    const batchByDate = new Map<string, string>();
    const bbd = priorMeta.batch_by_reference_date;
    if (bbd && typeof bbd === "object" && !Array.isArray(bbd)) {
      for (const [k, v] of Object.entries(bbd as Record<string, unknown>)) {
        if (typeof v === "string") batchByDate.set(k, v);
      }
    }

    let createdChunk = 0;
    let skippedChunk = 0;
    let skipNoProductChunk = 0;
    let skipNoQtyChunk = 0;
    let skipNoNameChunk = 0;
    const prevCreated =
      Number(priorMeta.revenue_entries_created_total ?? 0) || 0;
    const prevSkipped = Number(priorMeta.rows_skipped_total ?? 0) || 0;
    const prevSkipNoProduct =
      Number(priorMeta.rows_skipped_no_product ?? 0) || 0;
    const prevSkipNoQty = Number(priorMeta.rows_skipped_no_quantity ?? 0) || 0;
    const prevSkipNoName =
      Number(priorMeta.rows_skipped_no_product_name ?? 0) || 0;
    const prevProductsAutoCreated =
      Number(priorMeta.products_auto_created_total ?? 0) || 0;
    const prevDiagnosticsTruncated =
      priorMeta.ignored_rows_report_truncated === true;
    const maxDiagnostics = 2000;
    const priorDiagnostics = Array.isArray(priorMeta.ignored_rows_diagnostics)
      ? (priorMeta.ignored_rows_diagnostics as IgnoredRowDiagnostic[])
      : [];
    const diagnostics: IgnoredRowDiagnostic[] = [...priorDiagnostics];
    let diagnosticsTruncated = prevDiagnosticsTruncated;
    let productsAutoCreatedChunk = 0;

    const productIdCache = new Map<string, string | null>();

    const priorCatByProduct =
      priorMeta.epoc_revenue_category_by_product &&
      typeof priorMeta.epoc_revenue_category_by_product === "object" &&
      !Array.isArray(priorMeta.epoc_revenue_category_by_product)
        ? (priorMeta.epoc_revenue_category_by_product as Record<
            string,
            StoredRevenueCat
          >)
        : {};
    const catByKey: Record<string, StoredRevenueCat> = { ...priorCatByProduct };

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
    const openaiClassifyModel =
      Deno.env.get("OPENAI_REVENUE_CLASSIFY_MODEL")?.trim() || "gpt-4o-mini";

    const chunkEndExclusive = Math.min(
      rows.length,
      startOffset + ROWS_HARD_CAP,
    );
    const pendingHeuristic = new Map<
      string,
      { raw: string; pick: ReturnType<typeof classifyRevenueCategoryHeuristic> }
    >();
    const uncertainKeysOrder: string[] = [];
    const uncertainLabels: string[] = [];

    for (let pi = startOffset; pi < chunkEndExclusive; pi++) {
      const row = rows[pi]!;
      const totalCell = sanitizeCell(row[totalCol] ?? "");
      if (parseBrMoney(totalCell) == null) continue;
      const rawDate = sanitizeCell(row[dataConsumoIdx] ?? "");
      if (!parseFlexibleDate(rawDate)) continue;
      const rawP =
        produtoCol >= 0
          ? sanitizeCell(row[produtoCol] ?? "").replace(/\s+/g, " ")
          : "";
      if (!rawP) continue;
      if (parseBrQuantity(sanitizeCell(row[quantCol] ?? "")) == null) continue;

      const k = normalizeCatalogName(rawP);
      if (!k || catByKey[k]) continue;
      if (pendingHeuristic.has(k)) continue;

      const h = classifyRevenueCategoryHeuristic(rawP, leaves, defaultLeaf);
      if (!needsOpenAiRefinement(h)) {
        catByKey[k] = {
          subcategory_id: h.subcategoryId,
          category_id: h.categoryId,
          confidence: h.confidence,
          reason: h.reason,
          src: "heuristic",
        };
      } else {
        pendingHeuristic.set(k, { raw: rawP, pick: h });
        uncertainKeysOrder.push(k);
        uncertainLabels.push(rawP);
      }
    }

    if (uncertainLabels.length && openaiApiKey) {
      const aiMap = await batchClassifyRevenueLeavesWithOpenAi({
        apiKey: openaiApiKey,
        model: openaiClassifyModel,
        leaves,
        labels: uncertainLabels,
      });
      for (let i = 0; i < uncertainKeysOrder.length; i++) {
        const k = uncertainKeysOrder[i]!;
        const lid = aiMap.get(i);
        const leaf = lid ? leafById(leaves, lid) : null;
        if (leaf) {
          catByKey[k] = {
            subcategory_id: leaf.id,
            category_id: leaf.parent_id,
            confidence: 0.86,
            reason: "openai_batch",
            src: "openai",
          };
        } else {
          const ph = pendingHeuristic.get(k)!;
          catByKey[k] = {
            subcategory_id: ph.pick.subcategoryId,
            category_id: ph.pick.categoryId,
            confidence: ph.pick.confidence,
            reason: ph.pick.reason,
            src: "default",
          };
        }
      }
    } else {
      for (const k of uncertainKeysOrder) {
        const ph = pendingHeuristic.get(k)!;
        catByKey[k] = {
          subcategory_id: ph.pick.subcategoryId,
          category_id: ph.pick.categoryId,
          confidence: ph.pick.confidence,
          reason: ph.pick.reason,
          src: "heuristic",
        };
      }
    }

    const pushDiagnostic = (d: IgnoredRowDiagnostic) => {
      if (diagnostics.length >= maxDiagnostics) {
        diagnosticsTruncated = true;
        return;
      }
      diagnostics.push(d);
    };

    const t0 = Date.now();
    let idx = startOffset;
    while (idx < rows.length) {
      if (idx - startOffset >= ROWS_HARD_CAP) break;
      if (Date.now() - t0 >= TIME_BUDGET_MS) break;

      let createdNewProductThisIteration = false;

      const row = rows[idx]!;
      const totalCell = sanitizeCell(row[totalCol] ?? "");
      const gross = parseBrMoney(totalCell);
      if (gross == null) {
        skippedChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: "",
          product_name_raw: "",
          quantity_raw: "",
          total_received_raw: totalCell,
          reason: "gross_amount_invalid",
          details: `Valor invalido em "${COL_TOTAL_RECEBIDO}"`,
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

      const rawDate = sanitizeCell(row[dataConsumoIdx] ?? "");
      const entryDate = parseFlexibleDate(rawDate);
      if (!entryDate) {
        skippedChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: "",
          quantity_raw: "",
          total_received_raw: totalCell,
          reason: "entry_date_invalid",
          details: 'Data invalida em "data_consumo"',
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

      const rawProdutoForMatch =
        produtoCol >= 0
          ? sanitizeCell(row[produtoCol] ?? "").replace(/\s+/g, " ")
          : "";
      if (!rawProdutoForMatch) {
        skippedChunk += 1;
        skipNoNameChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: rawProdutoForMatch,
          quantity_raw: "",
          total_received_raw: totalCell,
          reason: "product_name_empty",
          details: "Nome do produto vazio",
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

      const qtyCell = sanitizeCell(row[quantCol] ?? "");
      const quantity = parseBrQuantity(qtyCell);
      if (quantity == null) {
        skippedChunk += 1;
        skipNoQtyChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: rawProdutoForMatch,
          quantity_raw: qtyCell,
          total_received_raw: totalCell,
          reason: "quantity_invalid",
          details: `Quantidade invalida na coluna ${headers[quantCol] ?? "quantidade"}`,
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

      if (Date.now() - t0 >= TIME_BUDGET_MS - TIME_RESERVE_BEFORE_ROW_MS) {
        break;
      }

      const lineCatKey = normalizeCatalogName(rawProdutoForMatch);
      const scRowForLine = catByKey[lineCatKey];
      const rowSubcategoryId = scRowForLine?.subcategory_id ?? defaultLeaf.id;
      const rowCategoryId = scRowForLine?.category_id ?? defaultLeaf.parent_id;

      let productId = resolveProductIdFromCatalog(
        rawProdutoForMatch,
        productCatalog,
        productIdCache,
      );
      if (!productId) {
        const normName = normalizeCatalogName(rawProdutoForMatch);
        const ambiguous = productCatalog.filter(
          (p) => normalizeCatalogName(p.name) === normName,
        );
        if (ambiguous.length > 1) {
          skippedChunk += 1;
          skipNoProductChunk += 1;
          pushDiagnostic({
            row_index: idx + 1,
            entry_date_raw: rawDate,
            product_name_raw: rawProdutoForMatch,
            quantity_raw: qtyCell,
            total_received_raw: totalCell,
            reason: "product_ambiguous",
            details: `Mais de um produto com o mesmo nome normalizado (${ambiguous.length})`,
            action: "linha ignorada; consolidar nomes duplicados no cadastro",
          });
          idx += 1;
          continue;
        }

        const inferredUnit = inferUnitFromProductName(
          rawProdutoForMatch,
          productCatalog,
        );
        const leafForAutoCreate =
          leaves.find((l) => l.id === rowSubcategoryId) ?? defaultLeaf;
        const autoOpType = deriveOperationalTypeForAutoProduct(
          leafForAutoCreate.name,
          rawProdutoForMatch,
        );
        const autoStock = mapOperationalTypeToStockControl(autoOpType);
        const catalogName =
          sanitizeCatalogProductName(rawProdutoForMatch) ||
          sanitizeCatalogProductName("Produto");
        const { data: createdProduct, error: createErr } = await admin
          .from("products")
          .insert({
            company_id: job.company_id,
            name: catalogName,
            unit: inferredUnit,
            min_quantity: 0,
            current_quantity: 0,
            is_active: true,
            stock_control_type: autoStock,
          })
          .select("id, name, unit")
          .single();
        if (createErr || !createdProduct?.id) {
          skippedChunk += 1;
          skipNoProductChunk += 1;
          pushDiagnostic({
            row_index: idx + 1,
            entry_date_raw: rawDate,
            product_name_raw: rawProdutoForMatch,
            quantity_raw: qtyCell,
            total_received_raw: totalCell,
            reason: "product_create_failed",
            details:
              createErr?.message ?? "Falha ao criar produto automaticamente",
            action: "linha ignorada",
          });
          idx += 1;
          continue;
        }
        createdNewProductThisIteration = true;

        productCatalog.push(
          createdProduct as { id: string; name: string; unit?: string | null },
        );
        productsAutoCreatedChunk += 1;
        productIdCache.set(
          normalizeCatalogName(rawProdutoForMatch),
          createdProduct.id as string,
        );
        productId = String(createdProduct.id);
      }
      if (!productId) {
        skippedChunk += 1;
        skipNoProductChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: rawProdutoForMatch,
          quantity_raw: qtyCell,
          total_received_raw: totalCell,
          reason: "product_create_failed",
          details:
            "Produto nao encontrado e criacao automatica nao retornou id",
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

      let batchId = batchByDate.get(entryDate);
      if (!batchId) {
        const { data: batchRow, error: batchErr } = await admin
          .from("company_revenue_integration_import_batches")
          .insert({
            company_id: job.company_id,
            provider: "epoc",
            reference_date: entryDate,
            status: "running",
            metadata: {
              csv_import_job_id: job.id,
              source: "process-integration-csv-revenue-job",
            },
          })
          .select("id")
          .single();
        if (batchErr || !batchRow?.id) {
          return await fail(
            batchErr?.message ?? "Falha ao criar lote de importação.",
          );
        }
        batchId = batchRow.id as string;
        batchByDate.set(entryDate, batchId);
      }

      const title = rawProdutoForMatch;

      const { data: entryId, error: rpcErr } = await admin.rpc(
        "create_revenue_entry",
        {
          p_payload: {
            company_id: job.company_id,
            entry_date: entryDate,
            title,
            entry_mode: "product_sale",
            revenue_type: "operational",
            category_id: rowCategoryId,
            subcategory_id: rowSubcategoryId,
            gross_amount: gross,
            product_id: productId,
            recipe_id: null,
            quantity,
            pricing_mode: "total",
            unit_value: null,
            _csv_import_job_id: job.id,
            integration_import_batch_id: batchId,
          },
        },
      );
      if (rpcErr) {
        return await fail(rpcErr.message ?? "Falha ao criar receita.");
      }
      if (!entryId) {
        return await fail("RPC create_revenue_entry não devolveu id.");
      }

      if (createdNewProductThisIteration && productId) {
        const leafForAutoCreate =
          leaves.find((l) => l.id === rowSubcategoryId) ?? defaultLeaf;
        const autoOpType = deriveOperationalTypeForAutoProduct(
          leafForAutoCreate.name,
          rawProdutoForMatch,
        );
        const { error: pocErr } = await admin
          .from("product_operational_config")
          .insert({
            company_id: job.company_id,
            product_id: productId,
            suggested_operational_type: autoOpType,
            suggested_score: 0.82,
            suggestion_reasons: {
              epoc_csv_revenue_import: true,
              revenue_category: scRowForLine?.reason ?? null,
            },
            final_operational_type: autoOpType,
            final_decision_source: "AUTO",
            configuration_status: "CONFIGURADO",
            configuration_completeness: {},
          });
        if (pocErr && !/duplicate key/i.test(pocErr.message)) {
          console.error(
            "[process-integration-csv-revenue-job] product_operational_config",
            pocErr.message,
          );
        }

        const sugPc = suggestCompanyProductCatalogCategoryId(
          rawProdutoForMatch,
          (productCatalogCategories ?? []) as { id: string; name: string }[],
        );
        if (sugPc) {
          const { error: pcaErr } = await admin
            .from("product_category_assignments")
            .insert({
              product_id: productId,
              category_id: sugPc.categoryId,
            });
          if (pcaErr && !/duplicate key/i.test(pcaErr.message)) {
            console.error(
              "[process-integration-csv-revenue-job] product_category_assignments",
              pcaErr.message,
            );
          }
        }
      }

      createdChunk += 1;
      idx += 1;
    }

    const nextOffset = idx;
    const now = new Date().toISOString();
    const batchMapObj = Object.fromEntries(batchByDate);
    const done = nextOffset >= rows.length;
    const sliceDiagForMeta =
      !done && diagnostics.length > DIAGNOSTICS_METADATA_CHUNK_CAP;
    const diagnosticsForMeta = sliceDiagForMeta
      ? diagnostics.slice(-DIAGNOSTICS_METADATA_CHUNK_CAP)
      : diagnostics;

    const newMeta: Record<string, unknown> = {
      ...priorMeta,
      epoc_revenue_category_by_product: catByKey,
      batch_by_reference_date: batchMapObj,
      csv_total_data_rows: rows.length,
      revenue_entries_created_total: prevCreated + createdChunk,
      rows_skipped_total: prevSkipped + skippedChunk,
      rows_skipped_no_product: prevSkipNoProduct + skipNoProductChunk,
      rows_skipped_no_quantity: prevSkipNoQty + skipNoQtyChunk,
      rows_skipped_no_product_name: prevSkipNoName + skipNoNameChunk,
      products_auto_created_total:
        prevProductsAutoCreated + productsAutoCreatedChunk,
      ignored_rows_diagnostics: diagnosticsForMeta,
      ignored_rows_report_truncated: diagnosticsTruncated || sliceDiagForMeta,
    };

    if (!done) {
      await admin
        .from("integration_csv_revenue_import_jobs")
        .update({
          csv_resume_row_index: nextOffset,
          metadata: newMeta,
          updated_at: now,
        })
        .eq("id", jobId);

      scheduleResume(supabaseUrl, serviceKey, anonKey, jobId);

      return json({
        ok: true,
        job_id: jobId,
        phase: "chunk",
        next_row_index: nextOffset,
        total_rows: rows.length,
        revenue_entries_created_this_chunk: createdChunk,
        rows_skipped_this_chunk: skippedChunk,
        products_auto_created_this_chunk: productsAutoCreatedChunk,
        revenue_entries_created_total: prevCreated + createdChunk,
        continuing: true,
      });
    }

    const batchIdList = [...new Set(Object.values(batchMapObj))];
    if (batchIdList.length) {
      await admin
        .from("company_revenue_integration_import_batches")
        .update({ status: "completed", updated_at: now })
        .in("id", batchIdList);
    }

    let ignoredReportPath: string | null = null;
    if (diagnostics.length > 0) {
      const reportCsv = diagnosticsToCsv(diagnostics);
      const reportPath = `epoc/ignored-rows/${job.company_id}/${job.id}/ignored-rows-report.csv`;
      const { error: upReportErr } = await admin.storage
        .from(job.storage_bucket)
        .upload(reportPath, new Blob([reportCsv], { type: "text/csv" }), {
          upsert: true,
          contentType: "text/csv",
        });
      if (!upReportErr) {
        ignoredReportPath = reportPath;
        newMeta.ignored_rows_report_storage_bucket = job.storage_bucket;
        newMeta.ignored_rows_report_storage_path = reportPath;
      } else {
        newMeta.ignored_rows_report_upload_error = upReportErr.message;
      }
    }

    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "COMPLETED",
        error_message: null,
        csv_resume_row_index: rows.length,
        metadata: newMeta,
        updated_at: now,
      })
      .eq("id", jobId);

    return json({
      ok: true,
      job_id: jobId,
      phase: "completed",
      total_rows: rows.length,
      revenue_entries_created_this_chunk: createdChunk,
      rows_skipped_this_chunk: skippedChunk,
      revenue_entries_created_total: prevCreated + createdChunk,
      rows_skipped_total: prevSkipped + skippedChunk,
      products_auto_created_total:
        prevProductsAutoCreated + productsAutoCreatedChunk,
      ignored_rows_report_storage_path: ignoredReportPath,
      ignored_rows_report_truncated: diagnosticsTruncated,
      batches: batchIdList.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "FAILED",
        error_message: msg.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return json({ ok: false, error: msg }, 500);
  }
});

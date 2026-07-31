/**
 * Processa `integration_csv_revenue_import_jobs` em **várias invocações** (cursor
 * `csv_resume_row_index` + continuação via fila pgmq `csv_revenue_import_continue`),
 * até percorrer todo o CSV: coluna "Total recebido(R$)" + `data_consumo`.
 * Lançamento: **venda de produto** (`entry_mode: product_sale`).
 * Produto: coluna **Codigo** → `products.sku` (acha ou cria com unit=un).
 * Categoria de catálogo: coluna **Grupo** → `company_product_categories` (acha ou cria).
 * Fluxo de produto: apenas por Codigo + Grupo (sem match por nome).
 * Quantidade na coluna Quant.; gross_amount = "Total recebido(R$)"; pricing_mode: total.
 * Categoria financeira (folha RECEITA OPERACIONAL): heurísticas PT-BR (sem IA).
 *
 * Autenticação: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 * Corpo inicial: `{ "job_id" }` ou `{ "record": { "id" } }`.
 * Continuação: mensagem na fila pgmq + `{ "consume_queue": true }` (consumer).
 * Compatível: `{ "job_id", "resume": true }` (retomada direta).
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  deleteCsvRevenueImportContinueMessage,
  enqueueCsvRevenueImportContinue,
  readCsvRevenueImportContinueMessages,
} from "../_shared/csvRevenueImportQueue.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildEpocImportJobFlowDiagnostic } from "../_shared/epocFlowDiagnostic.ts";
import {
  classifyRevenueCategoryHeuristic,
  filterOperationalRevenueLeaves,
  pickDefaultRevenueLeaf,
  type RevenueOperationalLeaf,
  type StoredRevenueCat,
} from "../_shared/epocCsvRevenueClassification.ts";
import {
  patchOnboardingPdv,
  resolveOnboardingCsvJobPatchEnabled,
} from "../_shared/onboardingPdvPatch.ts";
import {
  ensureEpocProductBySku,
  loadSkuProductCacheFromMetadata,
  skuProductCacheToMetadata,
} from "../_shared/epocCsvProductBySku.ts";
import { epocProductLineKey } from "../_shared/epocCsvProductResolution.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COL_TOTAL_RECEBIDO = "Total recebido(R$)";
/** Cabeçalhos aceites para o nome do produto (só rótulo do lançamento). */
const COL_PRODUTO_ALIASES = [
  "Produto",
  "Nome do produto",
  "Nome Produto",
  "Descrição",
  "Descricao",
];
/** Código EPOC → `products.sku`. */
const COL_CODIGO_ALIASES = ["Codigo", "Código", "Cod.", "Cod", "SKU"];
/** Grupo EPOC → categoria de catálogo de produto. */
const COL_GRUPO_ALIASES = ["Grupo", "Grupos", "Grupo produto", "Grupo Produto"];
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
/** Lease de chunk: evita webhook + resume processando o mesmo offset em paralelo. */
const CHUNK_LEASE_MS = 120_000;

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

/** Nome de produto para título do lançamento. */
function normalizeCatalogName(s: string): string {
  return sanitizeCell(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function resolveCodigoColumnIndex(normHeaders: string[]): number {
  for (const alias of COL_CODIGO_ALIASES) {
    const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i]!;
    if (h === "codigo" || h === "cod" || h === "sku") return i;
    if (h.startsWith("codigo") || h.startsWith("cod")) return i;
  }
  return -1;
}

function resolveGrupoColumnIndex(normHeaders: string[]): number {
  for (const alias of COL_GRUPO_ALIASES) {
    const j = normHeaders.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i]!;
    if (h === "grupo" || h.startsWith("grupo")) return i;
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
  | "epoc_product_unresolved"
  | "unit_conversion_failed"
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

async function tryClaimCsvJobChunk(
  admin: ReturnType<typeof createClient>,
  jobId: string,
  startOffset: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const until = new Date(Date.now() + CHUNK_LEASE_MS).toISOString();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("integration_csv_revenue_import_jobs")
    .update({
      chunk_lease_expires_at: until,
      updated_at: nowIso,
    })
    .eq("id", jobId)
    .eq("status", "PROCESSING")
    .eq("csv_resume_row_index", startOffset)
    .or(`chunk_lease_expires_at.is.null,chunk_lease_expires_at.lt.${nowIso}`)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data?.id) {
    return { ok: false, reason: "chunk_lease_busy" };
  }
  return { ok: true };
}

async function releaseCsvJobChunkLease(
  admin: ReturnType<typeof createClient>,
  jobId: string,
): Promise<void> {
  await admin
    .from("integration_csv_revenue_import_jobs")
    .update({
      chunk_lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

function intFromEnv(
  name: string,
  defaultVal: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function enqueueCsvRevenueContinue(
  admin: ReturnType<typeof createClient>,
  jobId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<void> {
  const enqueue = await enqueueCsvRevenueImportContinue(admin, jobId, {
    triggerWorker: true,
    supabaseUrl,
    serviceKey,
    logTag: "[process-integration-csv-revenue-job]",
  });
  if (!enqueue.ok) {
    console.error("[process-integration-csv-revenue-job] fila_continuacao_falhou", {
      job_id: jobId,
      error: enqueue.error ?? null,
    });
  }
}

async function runCsvRevenueImportForJob(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  _anonKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
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
  /** Quando true, não enfileira continuação — o caller encadeia chunks na mesma invocação. */
  const deferContinueEnqueue = body.defer_continue_enqueue === true;

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

  const jobMetaEarly =
    job.metadata &&
    typeof job.metadata === "object" &&
    !Array.isArray(job.metadata)
      ? (job.metadata as Record<string, unknown>)
      : {};
  const patchOnboardingEnabled = await resolveOnboardingCsvJobPatchEnabled(
    admin,
    job.company_id,
    jobMetaEarly,
  );
  const onboardingPdvJobFields = {
    csv_import_job_id: job.id,
    csv_storage_path: job.storage_path,
  };

  const fail = async (msg: string) => {
    await releaseCsvJobChunkLease(admin, jobId);
    const priorForFail =
      job.metadata &&
      typeof job.metadata === "object" &&
      !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
    const flowDiagnostic = buildEpocImportJobFlowDiagnostic({
      status: "FAILED",
      errorMessage: msg,
      csvTotalRows: Number(priorForFail.csv_total_data_rows ?? 0) || 0,
      revenueCreated: Number(priorForFail.revenue_entries_created_total ?? 0) || 0,
      rowsSkipped: Number(priorForFail.rows_skipped_total ?? 0) || 0,
      rowsSkippedNoProduct:
        Number(priorForFail.rows_skipped_no_product ?? 0) || 0,
    });
    if (patchOnboardingEnabled) {
      await patchOnboardingPdv(
        admin,
        job.company_id,
        {
          import_status: "failed",
          import_error: msg.slice(0, 500),
          sync: false,
          ...onboardingPdvJobFields,
        },
        "[process-integration-csv-revenue-job]",
      );
    }
    await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        status: "FAILED",
        error_message: msg.slice(0, 2000),
        metadata: {
          ...priorForFail,
          flow_diagnostic: flowDiagnostic,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return json({ ok: false, error: msg, flow_diagnostic: flowDiagnostic }, 422);
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

    if (rows.length === 0) {
      await releaseCsvJobChunkLease(admin, jobId);
      const priorMetaEmpty =
        job.metadata &&
        typeof job.metadata === "object" &&
        !Array.isArray(job.metadata)
          ? (job.metadata as Record<string, unknown>)
          : {};
      const onboardingEmpty = patchOnboardingEnabled;
      if (onboardingEmpty) {
        await patchOnboardingPdv(
          admin,
          job.company_id,
          {
            sales_total: 0,
            sales_sync: 0,
            import_status: "completed",
            sync: false,
            ...onboardingPdvJobFields,
          },
          "[process-integration-csv-revenue-job]",
        );
      }
      const flowDiagnostic = buildEpocImportJobFlowDiagnostic({
        status: "COMPLETED",
        csvTotalRows: 0,
        revenueCreated: 0,
        rowsSkipped: 0,
      });
      const nowEmpty = new Date().toISOString();
      await admin
        .from("integration_csv_revenue_import_jobs")
        .update({
          status: "COMPLETED",
          error_message: null,
          csv_resume_row_index: 0,
          metadata: {
            ...priorMetaEmpty,
            csv_total_data_rows: 0,
            revenue_entries_created_total: 0,
            rows_skipped_total: 0,
            import_skipped_empty_csv: true,
            flow_diagnostic: flowDiagnostic,
          },
          updated_at: nowEmpty,
        })
        .eq("id", jobId);
      return json({
        ok: true,
        job_id: jobId,
        phase: "completed",
        total_rows: 0,
        revenue_entries_created_total: 0,
        rows_skipped_total: 0,
        skipped_empty_csv: true,
        flow_diagnostic: flowDiagnostic,
      });
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
    const codigoCol = resolveCodigoColumnIndex(normHeaders);
    if (codigoCol < 0) {
      return await fail(
        `Coluna Codigo não encontrada (necessário para identificar/criar o produto). Cabeçalhos: ${headers.slice(0, 15).join("; ")}…`,
      );
    }
    const grupoCol = resolveGrupoColumnIndex(normHeaders);

    const startOffset = Math.max(0, Number(job.csv_resume_row_index ?? 0) || 0);
    if (startOffset > rows.length) {
      return await fail("Cursor de retomada inválido (fora do CSV).");
    }

    const chunkClaim = await tryClaimCsvJobChunk(admin, jobId, startOffset);
    if (!chunkClaim.ok) {
      console.warn(
        "[process-integration-csv-revenue-job] chunk_lease_skip",
        { job_id: jobId, start_offset: startOffset, reason: chunkClaim.reason },
      );
      return json({
        ok: true,
        skipped: true,
        reason: chunkClaim.reason,
        job_id: jobId,
        start_offset: startOffset,
      });
    }

    const priorMeta =
      job.metadata &&
      typeof job.metadata === "object" &&
      !Array.isArray(job.metadata)
        ? { ...(job.metadata as Record<string, unknown>) }
        : {};

    /**
     * Total estável para o card do onboarding:
     * - preferir `metadata.linhas_dados` (contagem do epoc-sync-csv na exportação);
     * - senão `csv_total_data_rows` já gravado em chunks anteriores;
     * - senão `rows.length` do CSV atual.
     * Em chunks de continuação NÃO rebaixar o total (evita salto se outro sync
     * sobrescrever o ficheiro/job a meio do import).
     */
    const metaLinhas = Number(priorMeta.linhas_dados ?? 0) || 0;
    const metaCsvTotal = Number(priorMeta.csv_total_data_rows ?? 0) || 0;
    const stableSalesTotal = Math.max(
      metaLinhas,
      metaCsvTotal,
      rows.length,
    );

    const onboardingCsvJob = patchOnboardingEnabled;
    if (onboardingCsvJob) {
      const obNow = await admin
        .from("companies")
        .select("onboarding_pdv")
        .eq("id", job.company_id)
        .maybeSingle();
      const prevOb =
        obNow.data?.onboarding_pdv &&
          typeof obNow.data.onboarding_pdv === "object" &&
          !Array.isArray(obNow.data.onboarding_pdv)
          ? (obNow.data.onboarding_pdv as Record<string, unknown>)
          : {};
      const trackedJobId =
        typeof prevOb.csv_import_job_id === "string"
          ? prevOb.csv_import_job_id.trim()
          : "";
      // Job antigo/paralelo não pode mexer no card (evita 80→20 e fecho com total errado).
      const isTrackedJob = !trackedJobId || trackedJobId === jobId;
      if (!isTrackedJob) {
        console.warn(
          "[process-integration-csv-revenue-job] onboarding_patch_ignorado_job_nao_rastreado",
          { job_id: jobId, tracked: trackedJobId, start_offset: startOffset },
        );
      } else {
        const prevTotal = Math.max(0, Math.floor(Number(prevOb.sales_total) || 0));
        const prevSync = Math.max(0, Math.floor(Number(prevOb.sales_sync) || 0));
        // Monotónico: nunca diminuir sales_sync (worker atrasado não regride o UI).
        const nextSync = Math.max(prevSync, startOffset);
        const progressPatch: {
          sales_sync: number;
          import_status: "processing";
          sales_total?: number;
          csv_import_job_id: string;
          csv_storage_path: string;
        } = {
          sales_sync: nextSync,
          import_status: "processing",
          ...onboardingPdvJobFields,
        };
        if (startOffset === 0 || prevTotal <= 0) {
          progressPatch.sales_total = Math.max(prevTotal, stableSalesTotal);
        } else if (stableSalesTotal > prevTotal) {
          progressPatch.sales_total = stableSalesTotal;
        }

        await patchOnboardingPdv(
          admin,
          job.company_id,
          progressPatch,
          "[process-integration-csv-revenue-job]",
        );
      }
    }

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
    const prevRecipesAutoCreated =
      Number(priorMeta.recipes_auto_created_total ?? 0) || 0;
    const prevDiagnosticsTruncated =
      priorMeta.ignored_rows_report_truncated === true;
    const maxDiagnostics = 2000;
    const priorDiagnostics = Array.isArray(priorMeta.ignored_rows_diagnostics)
      ? (priorMeta.ignored_rows_diagnostics as IgnoredRowDiagnostic[])
      : [];
    const diagnostics: IgnoredRowDiagnostic[] = [...priorDiagnostics];
    let diagnosticsTruncated = prevDiagnosticsTruncated;
    let productsAutoCreatedChunk = 0;
    let recipesAutoCreatedChunk = 0;

    const chunkEndExclusive = Math.min(
      rows.length,
      startOffset + ROWS_HARD_CAP,
    );

    const skuProductCache = loadSkuProductCacheFromMetadata(priorMeta);
    const productCategoryCache = new Map<string, string>();
    const createdProductIdsThisChunk = new Set<string>();

    const catByKey: Record<string, StoredRevenueCat> = {};
    const priorCat = priorMeta.epoc_revenue_category_by_product;
    if (priorCat && typeof priorCat === "object" && !Array.isArray(priorCat)) {
      for (const [k, v] of Object.entries(priorCat as Record<string, unknown>)) {
        if (!k || !v || typeof v !== "object" || Array.isArray(v)) continue;
        const row = v as Record<string, unknown>;
        const subId =
          typeof row.subcategory_id === "string" ? row.subcategory_id.trim() : "";
        if (!subId) continue;
        catByKey[k] = {
          subcategory_id: subId,
          category_id:
            typeof row.category_id === "string" ? row.category_id : null,
          confidence: Number(row.confidence ?? 0) || 0,
          reason: typeof row.reason === "string" ? row.reason : "",
          src:
            row.src === "openai" || row.src === "default" || row.src === "heuristic"
              ? row.src
              : "heuristic",
        };
      }
    }

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

      const k = epocProductLineKey(rawP);
      if (!k || catByKey[k]) continue;

      const h = classifyRevenueCategoryHeuristic(rawP, leaves, defaultLeaf);
      catByKey[k] = {
        subcategory_id: h.subcategoryId,
        category_id: h.categoryId,
        confidence: h.confidence,
        reason: h.reason,
        src: "heuristic",
      };
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
    let lastProgressPatchAt = startOffset;
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

      const lineKey = epocProductLineKey(rawProdutoForMatch);
      const scRowForLine = catByKey[lineKey];
      const rowSubcategoryId = scRowForLine?.subcategory_id ?? defaultLeaf.id;
      const rowCategoryId = scRowForLine?.category_id ?? defaultLeaf.parent_id;

      const rawCodigo = sanitizeCell(row[codigoCol] ?? "");
      if (!rawCodigo) {
        skippedChunk += 1;
        skipNoProductChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: rawProdutoForMatch,
          quantity_raw: qtyCell,
          total_received_raw: totalCell,
          reason: "epoc_product_unresolved",
          details: "Codigo do produto vazio",
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

      const rawGrupo =
        grupoCol >= 0
          ? sanitizeCell(row[grupoCol] ?? "").replace(/\s+/g, " ")
          : "";

      const ensured = await ensureEpocProductBySku({
        admin,
        companyId: job.company_id,
        sku: rawCodigo,
        name: rawProdutoForMatch,
        grupoName: rawGrupo || null,
        skuCache: skuProductCache,
        categoryCache: productCategoryCache,
      });
      if (!ensured.productId) {
        skippedChunk += 1;
        skipNoProductChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: rawProdutoForMatch,
          quantity_raw: qtyCell,
          total_received_raw: totalCell,
          reason: "epoc_product_unresolved",
          details: ensured.error ?? "Falha ao criar/identificar produto pelo Codigo.",
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }
      const productId = ensured.productId;
      if (ensured.created) {
        createdNewProductThisIteration = true;
        productsAutoCreatedChunk += 1;
        createdProductIdsThisChunk.add(productId);
      } else if (createdProductIdsThisChunk.has(productId)) {
        createdNewProductThisIteration = true;
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

      const { data: stockQty, error: convErr } = await admin.rpc(
        "product_sale_qty_in_stock_unit",
        {
          p_product_id: productId,
          p_sale_quantity: quantity,
          p_sale_unit_code: "un",
        },
      );
      if (convErr || stockQty == null || Number(stockQty) <= 0) {
        skippedChunk += 1;
        pushDiagnostic({
          row_index: idx + 1,
          entry_date_raw: rawDate,
          product_name_raw: rawProdutoForMatch,
          quantity_raw: qtyCell,
          total_received_raw: totalCell,
          reason: "unit_conversion_failed",
          details:
            convErr?.message ??
            "Quantidade em UN sem conversão para a unidade de estoque do produto (cadastre conversões no produto)",
          action: "linha ignorada",
        });
        idx += 1;
        continue;
      }

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
            sale_unit_code: "un",
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
        const { error: pocErr } = await admin
          .from("product_operational_config")
          .insert({
            company_id: job.company_id,
            product_id: productId,
            suggested_operational_type: "PRODUTO_REVENDA",
            suggested_score: 1,
            suggestion_reasons: {
              epoc_csv_revenue_import: true,
              by_sku: true,
            },
            final_operational_type: "PRODUTO_REVENDA",
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
      }

      createdChunk += 1;
      idx += 1;

      // Atualiza o card antes do fim do chunk (evita UI presa em 0/N durante o 1.º lote).
      if (
        onboardingCsvJob &&
        idx - lastProgressPatchAt >= 5
      ) {
        lastProgressPatchAt = idx;
        await patchOnboardingPdv(
          admin,
          job.company_id,
          {
            sales_sync: idx,
            import_status: "processing",
            ...onboardingPdvJobFields,
          },
          "[process-integration-csv-revenue-job]",
        ).catch(() => undefined);
      }
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
      epoc_product_id_by_sku: skuProductCacheToMetadata(skuProductCache),
      batch_by_reference_date: batchMapObj,
      csv_total_data_rows: Math.max(
        Number(priorMeta.csv_total_data_rows ?? 0) || 0,
        Number(priorMeta.linhas_dados ?? 0) || 0,
        rows.length,
      ),
      revenue_entries_created_total: prevCreated + createdChunk,
      rows_skipped_total: prevSkipped + skippedChunk,
      rows_skipped_no_product: prevSkipNoProduct + skipNoProductChunk,
      rows_skipped_no_quantity: prevSkipNoQty + skipNoQtyChunk,
      rows_skipped_no_product_name: prevSkipNoName + skipNoNameChunk,
      products_auto_created_total:
        prevProductsAutoCreated + productsAutoCreatedChunk,
      recipes_auto_created_total:
        prevRecipesAutoCreated + recipesAutoCreatedChunk,
      ignored_rows_diagnostics: diagnosticsForMeta,
      ignored_rows_report_truncated: diagnosticsTruncated || sliceDiagForMeta,
    };

    if (!done) {
      // Sem avanço de cursor: evita loop infinito de continuação (lease/timeout).
      if (nextOffset <= startOffset) {
        return await fail(
          "Importação sem progresso neste chunk (cursor não avançou). Tente Retomar importação.",
        );
      }
      if (onboardingCsvJob) {
        const { data: obMid } = await admin
          .from("companies")
          .select("onboarding_pdv")
          .eq("id", job.company_id)
          .maybeSingle();
        const midOb =
          obMid?.onboarding_pdv &&
            typeof obMid.onboarding_pdv === "object" &&
            !Array.isArray(obMid.onboarding_pdv)
            ? (obMid.onboarding_pdv as Record<string, unknown>)
            : {};
        const trackedMid =
          typeof midOb.csv_import_job_id === "string"
            ? midOb.csv_import_job_id.trim()
            : "";
        if (!trackedMid || trackedMid === jobId) {
          const prevSyncMid = Math.max(
            0,
            Math.floor(Number(midOb.sales_sync) || 0),
          );
          await patchOnboardingPdv(
            admin,
            job.company_id,
            {
              sales_sync: Math.max(prevSyncMid, nextOffset),
              import_status: "processing",
              ...onboardingPdvJobFields,
            },
            "[process-integration-csv-revenue-job]",
          );
        }
      }
      await admin
        .from("integration_csv_revenue_import_jobs")
        .update({
          csv_resume_row_index: nextOffset,
          metadata: newMeta,
          chunk_lease_expires_at: null,
          updated_at: now,
        })
        .eq("id", jobId);

      if (!deferContinueEnqueue) {
        await enqueueCsvRevenueContinue(admin, jobId, supabaseUrl, serviceKey);
      }

      return json({
        ok: true,
        job_id: jobId,
        phase: "chunk",
        next_row_index: nextOffset,
        total_rows: rows.length,
        revenue_entries_created_this_chunk: createdChunk,
        rows_skipped_this_chunk: skippedChunk,
        products_auto_created_this_chunk: productsAutoCreatedChunk,
        recipes_auto_created_this_chunk: recipesAutoCreatedChunk,
        revenue_entries_created_total: prevCreated + createdChunk,
        continuing: true,
        continue_enqueued: !deferContinueEnqueue,
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

    if (onboardingCsvJob) {
      const { data: obEnd } = await admin
        .from("companies")
        .select("onboarding_pdv")
        .eq("id", job.company_id)
        .maybeSingle();
      const endOb =
        obEnd?.onboarding_pdv &&
          typeof obEnd.onboarding_pdv === "object" &&
          !Array.isArray(obEnd.onboarding_pdv)
          ? (obEnd.onboarding_pdv as Record<string, unknown>)
          : {};
      const trackedEnd =
        typeof endOb.csv_import_job_id === "string"
          ? endOb.csv_import_job_id.trim()
          : "";
      if (!trackedEnd || trackedEnd === jobId) {
        const prevTotalEnd = Math.max(
          0,
          Math.floor(Number(endOb.sales_total) || 0),
        );
        const finalTotal = Math.max(
          prevTotalEnd,
          Number(newMeta.csv_total_data_rows ?? 0) || 0,
          Number(priorMeta.linhas_dados ?? 0) || 0,
          rows.length,
        );
        await patchOnboardingPdv(
          admin,
          job.company_id,
          {
            sales_total: finalTotal,
            sales_sync: finalTotal,
            import_status: "completed",
            sync: false,
            ...onboardingPdvJobFields,
          },
          "[process-integration-csv-revenue-job]",
        );
      } else {
        console.warn(
          "[process-integration-csv-revenue-job] complete_onboarding_ignorado_job_nao_rastreado",
          { job_id: jobId, tracked: trackedEnd },
        );
      }
    }

    const flowDiagnostic = buildEpocImportJobFlowDiagnostic({
      status: "COMPLETED",
      csvTotalRows: rows.length,
      revenueCreated: prevCreated + createdChunk,
      rowsSkipped: prevSkipped + skippedChunk,
      rowsSkippedNoProduct: prevSkipNoProduct + skipNoProductChunk,
    });
    newMeta.flow_diagnostic = flowDiagnostic;

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
      recipes_auto_created_total:
        prevRecipesAutoCreated + recipesAutoCreatedChunk,
      ignored_rows_report_storage_path: ignoredReportPath,
      ignored_rows_report_truncated: diagnosticsTruncated,
      batches: batchIdList.length,
      flow_diagnostic: flowDiagnostic,
    });
  } catch (e) {
    await releaseCsvJobChunkLease(admin, jobId);
    const msg = e instanceof Error ? e.message : String(e);
    if (patchOnboardingEnabled && jobRow?.company_id) {
      await patchOnboardingPdv(
        admin,
        String(jobRow.company_id),
        {
          import_status: "failed",
          import_error: msg.slice(0, 500),
          sync: false,
          csv_import_job_id: jobId,
          csv_storage_path:
            typeof jobRow.storage_path === "string"
              ? jobRow.storage_path
              : null,
        },
        "[process-integration-csv-revenue-job]",
      );
    }
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
}

async function consumeCsvRevenueImportQueue(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
): Promise<Response> {
  const maxMessages = intFromEnv("CSV_REVENUE_IMPORT_QUEUE_MAX", 1, 1, 5);
  /** Chunks encadeados na mesma invocação (evita depender só de waitUntil). */
  const maxChain = intFromEnv("CSV_REVENUE_IMPORT_INLINE_CHAIN", 8, 1, 40);
  const queueVtSeconds = intFromEnv(
    "CSV_REVENUE_IMPORT_QUEUE_VT",
    300,
    30,
    3600,
  );
  const messages = await readCsvRevenueImportContinueMessages(
    admin,
    maxMessages,
    queueVtSeconds,
  );
  const outcomes: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    const jobId = String(msg.message?.job_id ?? "").trim();
    if (!jobId) {
      await deleteCsvRevenueImportContinueMessage(admin, msg.msg_id);
      continue;
    }

    let lastStatus = 0;
    let data: Record<string, unknown> = {};
    let leaseBusy = false;
    let chainCount = 0;

    while (chainCount < maxChain) {
      chainCount += 1;
      const deferContinue = chainCount < maxChain;
      const res = await runCsvRevenueImportForJob(
        admin,
        supabaseUrl,
        serviceKey,
        anonKey,
        {
          job_id: jobId,
          resume: true,
          defer_continue_enqueue: deferContinue,
        },
      );
      lastStatus = res.status;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }

      leaseBusy =
        data.skipped === true && data.reason === "chunk_lease_busy";
      if (!res.ok || leaseBusy) break;
      if (data.continuing !== true) break;
      // Continua o próximo chunk na mesma invocação.
    }

    // Se ainda há trabalho e o último passo usou defer, enfileira 1 continuação.
    if (
      !leaseBusy &&
      lastStatus >= 200 &&
      lastStatus < 300 &&
      data.continuing === true &&
      data.continue_enqueued !== true
    ) {
      await enqueueCsvRevenueContinue(admin, jobId, supabaseUrl, serviceKey);
      data = { ...data, continue_enqueued: true, chained_chunks: chainCount };
    } else {
      data = { ...data, chained_chunks: chainCount };
    }

    if (lastStatus >= 200 && lastStatus < 300 && !leaseBusy) {
      await deleteCsvRevenueImportContinueMessage(admin, msg.msg_id);
    }

    outcomes.push({
      msg_id: msg.msg_id,
      job_id: jobId,
      status: lastStatus,
      body: data,
    });
  }

  return json({
    ok: true,
    consumed: outcomes.length,
    queue_vt_seconds: queueVtSeconds,
    inline_chain_max: maxChain,
    outcomes,
  });
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

  if (body.consume_queue === true) {
    return consumeCsvRevenueImportQueue(
      admin,
      supabaseUrl,
      serviceKey,
      anonKey,
    );
  }

  const orchestrated = body.orchestrated === true;

  // Com orchestrated=true o worker já faz self-call; chain inline longo + download
  // do CSV em cada chunk estoura o timeout do orquestrador e o job fica em 0/N.
  const maxInline = orchestrated
    ? intFromEnv("CSV_REVENUE_IMPORT_ORCHESTRATED_CHAIN", 2, 1, 6)
    : intFromEnv("CSV_REVENUE_IMPORT_INLINE_CHAIN", 8, 1, 40);
  const first = await runCsvRevenueImportForJob(
    admin,
    supabaseUrl,
    serviceKey,
    anonKey,
    { ...body, defer_continue_enqueue: true },
  );
  let firstBody: Record<string, unknown> = {};
  try {
    firstBody = (await first.clone().json()) as Record<string, unknown>;
  } catch {
    firstBody = {};
  }

  if (first.status < 200 || first.status >= 300 || firstBody.ok === false) {
    return first;
  }
  if (firstBody.continuing !== true || firstBody.skipped === true) {
    return first;
  }

  const jobIdForChain = extractJobId(body) ||
    (typeof firstBody.job_id === "string" ? firstBody.job_id : "");
  if (!jobIdForChain) {
    await enqueueCsvRevenueContinue(
      admin,
      String(firstBody.job_id ?? ""),
      supabaseUrl,
      serviceKey,
    ).catch(() => undefined);
    return first;
  }

  let chainCount = 1;
  let lastBody = firstBody;
  let lastStatus = first.status;

  while (
    lastStatus >= 200 &&
    lastStatus < 300 &&
    lastBody.continuing === true &&
    lastBody.skipped !== true &&
    chainCount < maxInline
  ) {
    chainCount += 1;
    const defer = chainCount < maxInline;
    const next = await runCsvRevenueImportForJob(
      admin,
      supabaseUrl,
      serviceKey,
      anonKey,
      {
        job_id: jobIdForChain,
        resume: true,
        defer_continue_enqueue: defer,
      },
    );
    lastStatus = next.status;
    try {
      lastBody = (await next.json()) as Record<string, unknown>;
    } catch {
      lastBody = {};
    }
    if (lastBody.skipped === true && lastBody.reason === "chunk_lease_busy") {
      break;
    }
  }

  // Com orchestrated=true o epoc-csv-import-worker faz self-call; não usar pgmq.
  if (
    !orchestrated &&
    lastBody.continuing === true &&
    lastBody.continue_enqueued !== true &&
    lastBody.skipped !== true
  ) {
    await enqueueCsvRevenueContinue(admin, jobIdForChain, supabaseUrl, serviceKey);
    lastBody = { ...lastBody, continue_enqueued: true };
  }

  return json({
    ...lastBody,
    ok: lastStatus >= 200 && lastStatus < 300,
    chained_chunks: chainCount,
    orchestrated,
    continue_enqueued: orchestrated ? false : lastBody.continue_enqueued === true,
    phase: lastBody.phase ??
      (lastBody.continuing === true ? "chunk" : "completed"),
  }, lastStatus >= 200 && lastStatus < 300 ? 200 : lastStatus);
});

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { strFromU8 } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { stripPackSizeFromLabel } from "../_shared/productImport/packSizeFromLabel.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import { insertBoletosFromNfeDupXml } from "../_shared/insertBoletosFromNfeDup.ts";
import { NFE_CATALOG_MOTOR_VERSION } from "../_shared/nfeExpenseProducts/types.ts";
import {
  importXmlProductsAfterBatchEnabled,
  invokeProcessExpenseXmlProducts,
  scheduleWaitUntilEdge,
} from "../_shared/nfeExpenseProducts/invokeProcessExpenseXmlProducts.ts";
import { upsertImportPendingReviewCompanyAlert } from "../_shared/upsertImportPendingReviewCompanyAlert.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Uma sub-ronda curta por invoke (quota CPU da Edge); o resto encadeia via `stillActive`. */
function intFromEnv(name: string, defaultVal: number, min: number, max: number): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
const MAX_FILES_PER_RUN = intFromEnv("IMPORT_BATCH_MAX_FILES_PER_RUN", 4, 1, 80);
const STALE_FILE_MINUTES = intFromEnv("IMPORT_BATCH_STALE_FILE_MINUTES", 8, 2, 120);
/** Quando true (env), cada invoke processa até 1 ficheiro; ou o cliente pode mandar `test_single_file` no POST. */
const TEST_SINGLE_FILE_MODE = String(Deno.env.get("IMPORT_BATCH_TEST_SINGLE_FILE") ?? "")
  .trim()
  .toLowerCase() === "true";
/** Padrão false: poucos marcadores/`pibLog`; definir `IMPORT_BATCH_VERBOSE_LOGS=true` para diagnóstico. */
const VERBOSE_LOGS = String(Deno.env.get("IMPORT_BATCH_VERBOSE_LOGS") ?? "")
  .trim()
  .toLowerCase() === "true";

const LOG = "[process-import-job-batch]";
/** HTTP 546 no Supabase = limite do worker (CPU/tempo/mem). 503/529 = sobrecarga temporária. */
const CHAIN_RETRYABLE_HTTP = new Set([546, 503, 529]);
const CHAIN_MAX_ATTEMPTS = 3;
const CHAIN_BACKOFF_MS = [0, 1500, 3500];

/**
 * Invoke encadeado da mesma função; retenta com backoff quando o gateway devolve limite/sobrecarga.
 */
async function fetchChainedBatchRound(params: {
  supabaseUrl: string;
  authHeader: string;
  anonKey: string;
  batchId: string;
  testSingleFileInvoke: boolean;
}): Promise<Response> {
  const url =
    `${params.supabaseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`;
  const body = JSON.stringify({
    batch_id: params.batchId,
    ...(params.testSingleFileInvoke ? { test_single_file: true } : {}),
  });
  const headers = {
    Authorization: params.authHeader,
    apikey: params.anonKey,
    "Content-Type": "application/json",
  };
  let last: Response | undefined;
  for (let i = 0; i < CHAIN_MAX_ATTEMPTS; i += 1) {
    const wait = CHAIN_BACKOFF_MS[i] ?? 0;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    last = await fetch(url, { method: "POST", headers, body });
    if (last.ok) return last;
    if (!CHAIN_RETRYABLE_HTTP.has(last.status)) return last;
  }
  return last!;
}

/** Após a resposta HTTP, o runtime pode encerrar a instância (`EarlyDrop`) e cancelar trabalho assíncrono.
 * O encadeamento interno abaixo é melhor esforço; o cliente (`drainProcessImportJobBatch` no web) deve
 * reinvocar até `remaining_files === 0` para concluir o lote de forma confiável. */

/** Quando true (ex.: `test_single_file`), quase sem `console.log` — só erros e resumo final. */
let quietBatchLogging = false;

/** Marcador grepável nos logs (`acao` fixo): sempre inclui `unidade` = company_id. */
function marcador(unidadeId: string, acao: string, detalhes: Record<string, unknown>): void {
  if (quietBatchLogging && VERBOSE_LOGS === false) {
    const keep = new Set([
      "ENCADEAMENTO_INVOKE_ERRO",
      "ENCADEAMENTO_INVOKE_EXCECAO",
    ]);
    if (!keep.has(acao)) return;
  }
  if (!VERBOSE_LOGS) {
    const essentialActions = new Set([
      "LOTE_INICIO",
      "ENCADEAMENTO_INVOKE_INICIO",
      "ENCADEAMENTO_INVOKE_ERRO",
      "ENCADEAMENTO_INVOKE_EXCECAO",
      "FILA_ESGOTADA",
    ]);
    if (!essentialActions.has(acao)) return;
  }
  console.log(LOG, JSON.stringify({ unidade: unidadeId, acao, ...detalhes }));
}

/** Logs JSON — filtrar por `[process-import-job-batch]` e campo `fase`. */
function pibLog(
  execId: string,
  fase: string,
  ctx: { company_id: string; batch_id: string; file_id?: string | null },
  mensagem: string,
  extras?: Record<string, unknown>,
): void {
  if (quietBatchLogging && VERBOSE_LOGS === false) {
    const allow = new Set([
      "request_fim_terminal",
      "ficheiro_ERRO",
      "ficheiros_select_erro",
      "batch_total_ficheiros_erro",
    ]);
    if (!allow.has(fase)) return;
  }
  if (!VERBOSE_LOGS) {
    const essentialPhases = new Set([
      "batch_carregado",
      "ficheiros_para_processar",
      "request_fim_terminal",
      "chain_proxima_ronda",
    ]);
    const phaseLower = fase.toLowerCase();
    const isErrorLike =
      phaseLower.includes("falhou") ||
      phaseLower.includes("excecao") ||
      phaseLower.includes("invoke_erro") ||
      phaseLower.endsWith("_erro") ||
      phaseLower.includes("_erro_") ||
      fase === "ficheiro_ERRO";
    if (!isErrorLike && !essentialPhases.has(fase)) return;
  }
  const line = {
    exec_id: execId,
    fase,
    mensagem,
    ...ctx,
    ...(extras && Object.keys(extras).length ? extras : {}),
  };
  console.log(LOG, JSON.stringify(line));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function digitsOnly(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
}

function parseLooseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function calcProgressPercent(processed: number, totalFiles: number): number {
  if (!Number.isFinite(totalFiles) || totalFiles <= 0) return 100;
  const safeProcessed = Math.max(0, Math.min(processed, totalFiles));
  return Number(((safeProcessed / totalFiles) * 100).toFixed(2));
}

function extractXmlVnfTotal(xmlText: string): number | null {
  const matches = [...xmlText.matchAll(/<vNF>\s*([^<]+)\s*<\/vNF>/gi)];
  if (matches.length === 0) return null;
  // Quando houver mais de um vNF no XML, prioriza o maior valor positivo encontrado.
  let best = 0;
  for (const m of matches) {
    const candidate = parseLooseNumber(m[1] ?? "");
    if (Number.isFinite(candidate) && candidate > best) best = candidate;
  }
  return best > 0 ? Math.round(best * 100) / 100 : null;
}

/** Igual ao pipeline web de reconciliação — rótulos de catálogo (PT-BR, NF-e). */
function normalizeCatalogLabel(v: string): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s%/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Evita 23505 em `idx_company_nfe_import_logs_unique_access_key` / `unique_xml_hash`:
 * o mesmo XML (hash) ou reprocessamento do ficheiro deve atualizar o log, não duplicar.
 */
async function upsertCompanyNfeImportLog(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("company_nfe_import_logs")
    .upsert(
      { ...payload, updated_at: new Date().toISOString() },
      { onConflict: "company_id,xml_hash" },
    );
  if (error) {
    console.error(
      "[process-import-job-batch] company_nfe_import_logs upsert:",
      error.message,
    );
    throw new Error(error.message);
  }
}

async function appendTimeline(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
  stage: string,
  message: string,
  meta: Record<string, unknown> = {},
  fileId?: string,
) {
  await supabase.from("import_job_timeline").insert({
    batch_id: batchId,
    file_id: fileId ?? null,
    stage,
    message,
    meta,
  });
}

async function appendTimelineMaybeQuiet(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
  stage: string,
  message: string,
  meta: Record<string, unknown> = {},
  fileId?: string,
): Promise<void> {
  if (quietBatchLogging && (stage === "PARSE" || stage === "DONE")) {
    return;
  }
  await appendTimeline(supabase, batchId, stage, message, meta, fileId);
}

async function expenseExists(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  expenseId: string | null | undefined,
): Promise<boolean> {
  const id = String(expenseId ?? "").trim();
  if (!id) return false;
  const { data, error } = await supabase
    .from("expenses")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (error) return false;
  return !!data?.id;
}

function sumExpenseLineTotals(rows: Array<Record<string, unknown>>): number {
  let s = 0;
  for (const row of rows) {
    const lt = Number((row as { lineTotal?: unknown }).lineTotal ?? 0);
    if (Number.isFinite(lt) && lt > 0) {
      s += lt;
      continue;
    }
    const q = Number((row as { quantity?: unknown }).quantity ?? 0);
    const uv = Number((row as { unitValue?: unknown }).unitValue ?? 0);
    if (Number.isFinite(q) && Number.isFinite(uv)) s += q * uv;
  }
  return Math.round(s * 100) / 100;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isServiceCaller = !!(serviceRole && bearer === serviceRole);
  const supabase = isServiceCaller
    ? createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });

  const body = await req.json().catch(() => ({}));
  const batchId = String((body as { batch_id?: string }).batch_id ?? "").trim();
  const testSingleFileInvoke =
    TEST_SINGLE_FILE_MODE ||
    ((body as { test_single_file?: unknown }).test_single_file === true);
  /** Logs/timeline enxutos + sem encadeamento Edge quando o browser faz `drain` com JWT. */
  quietBatchLogging = testSingleFileInvoke && !isServiceCaller;
  const execId = crypto.randomUUID();
  if (!batchId) {
    console.warn(
      LOG,
      JSON.stringify({ exec_id: execId, fase: "request_invalido", mensagem: "body sem batch_id" }),
    );
    return json({ ok: false, error: "batch_id obrigatório." }, 400);
  }

  const { data: batch, error: batchErr } = await supabase
    .from("import_job_batches")
    .select("id, company_id, requested_by, total_files, processed_files, success_files, failed_files, pending_review_files, status")
    .eq("id", batchId)
    .maybeSingle();
  if (batchErr || !batch?.id) {
    console.warn(
      LOG,
      JSON.stringify({
        exec_id: execId,
        fase: "batch_nao_encontrado",
        batch_id: batchId,
        erro: batchErr?.message ?? "null",
      }),
    );
    return json({ ok: false, error: "lote não encontrado." }, 404);
  }
  const companyId = String(batch.company_id);
  const { count: filesInBatchCount, error: filesCountErr } = await supabase
    .from("import_job_files")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId);
  if (filesCountErr) {
    pibLog(
      execId,
      "batch_total_ficheiros_erro",
      { company_id: companyId, batch_id: batchId },
      "falha ao contar ficheiros do lote; usa total_files atual do batch",
      { erro: filesCountErr.message, total_files_batch: batch.total_files },
    );
  }
  const totalFilesDetected = Number(filesInBatchCount ?? batch.total_files ?? 0);
  const totalFilesBase = Math.max(
    0,
    totalFilesDetected,
    Number(batch.processed_files ?? 0),
  );
  if (Number(batch.total_files ?? 0) !== totalFilesBase) {
    await supabase
      .from("import_job_batches")
      .update({ total_files: totalFilesBase, updated_at: new Date().toISOString() })
      .eq("id", batchId);
  }

  pibLog(execId, "batch_carregado", { company_id: companyId, batch_id: batchId }, "lote encontrado; início processamento", {
    caller_service_role: isServiceCaller,
    batch_status: batch.status,
    total_files: totalFilesBase,
    total_files_batch_raw: batch.total_files,
    processed_files: batch.processed_files,
    success_files: batch.success_files,
    failed_files: batch.failed_files,
  });

  if (!isServiceCaller) {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: "Sessão inválida." }, 401);
    const { data: member, error: memErr } = await supabase
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (memErr || !member) return json({ ok: false, error: "Sem acesso a esta empresa." }, 403);
  }

  const nowIso = new Date().toISOString();

  if (String(batch.status) === "CANCELLED") {
    await supabase
      .from("import_job_files")
      .update({
        status: "CANCELLED",
        last_error: "Lote cancelado.",
        finished_at: nowIso,
        updated_at: nowIso,
      })
      .eq("batch_id", batchId)
      .eq("status", "QUEUED");
    await appendTimelineMaybeQuiet(supabase, batchId, "CANCEL", "Importação cancelada — nenhum arquivo pendente será processado.");
    return json({
      ok: true,
      batch_id: batchId,
      status: "CANCELLED",
      cancelled: true,
      processed_files: Number(batch.processed_files ?? 0),
      success_files: Number(batch.success_files ?? 0),
      failed_files: Number(batch.failed_files ?? 0),
      pending_review_files: Number(batch.pending_review_files ?? 0),
    });
  }

  await supabase
    .from("import_job_batches")
    .update({ status: "PROCESSING", updated_at: nowIso })
    .eq("id", batchId);
  if (Number(batch.processed_files ?? 0) === 0) {
    await supabase
      .from("import_job_batches")
      .update({ started_at: nowIso })
      .eq("id", batchId)
      .is("started_at", null);
    await appendTimelineMaybeQuiet(supabase, batchId, "UPLOAD", "Lote enfileirado para processamento.");
  }

  let processed = Number(batch.processed_files ?? 0);
  let success = Number(batch.success_files ?? 0);
  let failed = Number(batch.failed_files ?? 0);
  let pendingReviewFiles = Number(batch.pending_review_files ?? 0);

  marcador(companyId, "LOTE_INICIO", {
    batch_id: batchId,
    exec_id: execId,
    max_ficheiros_neste_invoke: testSingleFileInvoke ? 1 : MAX_FILES_PER_RUN,
    test_single_file_mode: testSingleFileInvoke,
  });

  const staleBeforeIso = new Date(
    Date.now() - STALE_FILE_MINUTES * 60_000,
  ).toISOString();
  const { data: staleRows, error: staleSelErr } = await supabase
    .from("import_job_files")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "PROCESSING")
    .lt("updated_at", staleBeforeIso)
    .limit(200);
  if (!staleSelErr && (staleRows?.length ?? 0) > 0) {
    const staleIds = (staleRows ?? []).map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean);
    if (staleIds.length > 0) {
      const { error: reclaimErr } = await supabase
        .from("import_job_files")
        .update({
          status: "QUEUED",
          last_error: `Reenfileirado automaticamente após ${STALE_FILE_MINUTES} min sem progresso.`,
          updated_at: new Date().toISOString(),
        })
        .in("id", staleIds);
      if (reclaimErr) {
        pibLog(
          execId,
          "stale_reclaim_erro",
          { company_id: companyId, batch_id: batchId },
          reclaimErr.message,
          { stale_count: staleIds.length },
        );
      } else {
        pibLog(
          execId,
          "stale_reclaim_ok",
          { company_id: companyId, batch_id: batchId },
          "ficheiros PROCESSING stale reenfileirados",
          { stale_count: staleIds.length, stale_minutes: STALE_FILE_MINUTES },
        );
      }
    }
  }

  const { data: files, error: filesSelErr } = await supabase
    .from("import_job_files")
    .select("id, file_name, xml_hash, xml_content_base64")
    .eq("batch_id", batchId)
    .in("status", ["QUEUED", "PROCESSING"])
    .order("created_at", { ascending: true });
  if (filesSelErr) {
    pibLog(
      execId,
      "ficheiros_select_erro",
      { company_id: companyId, batch_id: batchId },
      filesSelErr.message,
      {},
    );
    return json({ ok: false, error: `Falha ao listar arquivos do lote: ${filesSelErr.message}` }, 500);
  }

  const filesQueued = (files ?? []).length;
  const filesPerRun = testSingleFileInvoke ? 1 : MAX_FILES_PER_RUN;
  const chunkLen = Math.min(filesPerRun, filesQueued);
  if (filesQueued === 0) {
    marcador(companyId, "FILA_ESGOTADA", { batch_id: batchId });
  }
  pibLog(
    execId,
    "ficheiros_para_processar",
    { company_id: companyId, batch_id: batchId },
    `${filesQueued} ficheiro(s) QUEUED/PROCESSING; neste invoke processa até ${chunkLen}`,
    {
      max_por_invoke: filesPerRun,
      ids_preview: (files ?? []).slice(0, 3).map((f: { id: string }) => f.id),
    },
  );
  marcador(companyId, "SUBRONDA", {
    batch_id: batchId,
    na_fila: filesQueued,
    processar_agora: chunkLen,
  });

  const chunkFiles = (files ?? []).slice(0, filesPerRun);

  for (const fRaw of chunkFiles) {
    const { data: batchGate } = await supabase
      .from("import_job_batches")
      .select("status")
      .eq("id", batchId)
      .maybeSingle();
    if (String(batchGate?.status) === "CANCELLED") {
      const cancelIso = new Date().toISOString();
      await supabase
        .from("import_job_files")
        .update({
          status: "CANCELLED",
          last_error: "Cancelado pelo usuário antes deste arquivo.",
          finished_at: cancelIso,
          updated_at: cancelIso,
        })
        .eq("batch_id", batchId)
        .eq("status", "QUEUED");
      await appendTimelineMaybeQuiet(supabase, batchId, "CANCEL", "Importação cancelada pelo usuário.");
      await supabase
        .from("import_job_batches")
        .update({
          status: "CANCELLED",
          finished_at: cancelIso,
          last_error: "Importação cancelada pelo usuário.",
          progress_percent: calcProgressPercent(processed, totalFilesBase),
          updated_at: cancelIso,
        })
        .eq("id", batchId);
      return json({
        ok: true,
        batch_id: batchId,
        status: "CANCELLED",
        cancelled: true,
        processed_files: processed,
        success_files: success,
        failed_files: failed,
        pending_review_files: pendingReviewFiles,
      });
    }

    const file = fRaw as {
      id: string;
      file_name: string;
      xml_hash: string;
      xml_content_base64: string | null;
    };
    const fileId = file.id;
    let fileStatus: "COMPLETED" | "FAILED" | "COMPLETED_WITH_PENDING_REVIEW" = "COMPLETED";
    let fileError: string | null = null;
    let pendingForFile = 0;
    let expenseId: string | null = null;
    if (file.xml_content_base64 == null || String(file.xml_content_base64).trim() === "") {
      pibLog(
        execId,
        "ficheiro_ERRO",
        { company_id: companyId, batch_id: batchId, file_id: fileId },
        "import_job_files sem xml_content_base64 — registo inconsistente; marque como falha",
        { file_name: file.file_name },
      );
      fileStatus = "FAILED";
      fileError = "Arquivo sem conteúdo XML (base64 vazio).";
      await appendTimelineMaybeQuiet(
        supabase,
        batchId,
        "ERROR",
        fileError,
        { file_name: file.file_name },
        fileId,
      );
      processed += 1;
      failed += 1;
      await supabase
        .from("import_job_files")
        .update({
          status: "FAILED",
          retry_count: 1,
          last_error: fileError,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);
      await supabase
        .from("import_job_batches")
        .update({
          processed_files: processed,
          success_files: success,
          failed_files: failed,
          pending_review_files: pendingReviewFiles,
          progress_percent: calcProgressPercent(processed, totalFilesBase),
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId);
      continue;
    }
    pibLog(
      execId,
      "ficheiro_inicio",
      { company_id: companyId, batch_id: batchId, file_id: fileId },
      `a processar ${file.file_name}`,
      { xml_hash_prefix: `${String(file.xml_hash ?? "").slice(0, 12)}…` },
    );
    await supabase
      .from("import_job_files")
      .update({ status: "PROCESSING", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", fileId);
    await appendTimelineMaybeQuiet(supabase, batchId, "PARSE", `Iniciando arquivo ${file.file_name}`, { file_name: file.file_name }, fileId);

    try {
      const xmlBytes = decodeBase64ToBytes(file.xml_content_base64);
      const xmlText = strFromU8(xmlBytes);
      const extracted = parseNfeXmlToExtracted(xmlText);
      if (!extracted) {
        throw new Error("XML inválido para NF-e autorizada (nfeProc).");
      }
      const data = enrichExtractedWithTaxId(extracted);
      const nfeAccessKey = String(data.nfeAccessKey ?? "").trim() || null;
      const invoiceNumber = String(data.invoiceNumber ?? "").trim() || null;
      const invoiceSeries = String(data.invoiceSeries ?? "").trim() || null;
      const supplierDocument = digitsOnly(data.supplierDocument);
      const emissionDate = String(data.emissionDate ?? "").slice(0, 10) || null;

      pibLog(
        execId,
        "xml_parseado",
        { company_id: companyId, batch_id: batchId, file_id: fileId },
        "parseNfeXmlToExtracted OK",
        {
          tem_chave_nfe: !!nfeAccessKey,
          chave_nfe_44: nfeAccessKey,
          invoice_series: invoiceSeries,
          invoice_number: invoiceNumber,
          supplier_document: supplierDocument,
          supplier_name_preview: String(data.supplierName ?? "").slice(0, 80),
          total_amount: data.totalAmount ?? null,
          itens_extraidos: Array.isArray(data.items) ? data.items.length : 0,
        },
      );

      const { data: alreadyByHash } = await supabase
        .from("company_nfe_import_logs")
        .select("id, expense_id, status")
        .eq("company_id", companyId)
        .eq("xml_hash", file.xml_hash)
        .maybeSingle();
      const hashExpenseId = String(
        (alreadyByHash as { expense_id?: string | null } | null)?.expense_id ?? "",
      ).trim();
      const hashExpenseExists = await expenseExists(supabase, companyId, hashExpenseId);
      if (alreadyByHash && hashExpenseExists) {
        pibLog(
          execId,
          "skip_ja_importado_hash",
          { company_id: companyId, batch_id: batchId, file_id: fileId },
          "company_nfe_import_logs já tem este xml_hash com despesa existente — não recria",
          { expense_id: hashExpenseId },
        );
        await appendTimelineMaybeQuiet(supabase, batchId, "DONE", "Arquivo já importado (hash).", {}, fileId);
        fileStatus = "COMPLETED";
      } else if (nfeAccessKey) {
        if (alreadyByHash && !hashExpenseExists) {
          pibLog(
            execId,
            "reprocessar_hash_com_despesa_ausente",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "xml_hash existente no log, porém despesa não encontrada; segue recriação da despesa",
            { expense_id_log: hashExpenseId || null },
          );
        }
        const { data: byKey } = await supabase
          .from("company_nfe_import_logs")
          .select("id, status, expense_id")
          .eq("company_id", companyId)
          .eq("nfe_access_key", nfeAccessKey)
          .maybeSingle();
        const byKeyExpenseId = String((byKey as { expense_id?: string | null } | null)?.expense_id ?? "").trim();
        const byKeyExpenseExists = await expenseExists(supabase, companyId, byKeyExpenseId);
        const byKeyStatus = String((byKey as { status?: string | null } | null)?.status ?? "").toLowerCase();
        const byKeyReallyImported = byKeyExpenseExists && (byKeyStatus === "success" || byKeyStatus === "needs_review" || byKeyExpenseId !== "");
        if (byKey && byKeyReallyImported) {
          pibLog(
            execId,
            "skip_duplicado_chave_nfe",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "já existe log com mesma nfe_access_key — não cria despesa nem segundo registo (único por chave)",
            { chave_nfe_44: nfeAccessKey, expense_id: byKeyExpenseId },
          );
          await appendTimelineMaybeQuiet(
            supabase,
            batchId,
            "DONE",
            "Arquivo ignorado por duplicidade de chave de acesso.",
            { nfe_access_key: nfeAccessKey, expense_id: byKeyExpenseId || null },
            fileId,
          );
          fileStatus = "COMPLETED";
          continue;
        } else {
          if (byKey && !byKeyReallyImported) {
            pibLog(
              execId,
              "reprocessar_chave_com_log_orfao",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              "log antigo sem despesa válida associada — segue processamento normal",
              { chave_nfe_44: nfeAccessKey, status_log: byKeyStatus || null, expense_id_log: byKeyExpenseId || null },
            );
          }
          const sr = await ensureSupplierFromExtracted(
            supabase,
            companyId,
            data,
            "Cadastrado automaticamente — importação XML/ZIP NF-e",
          );
          const supplierId = sr.supplierId;
          if (sr.createdNew && supplierId) {
            marcador(companyId, "FORNECEDOR_CRIADO", {
              batch_id: batchId,
              file_id: fileId,
              supplier_id: supplierId,
              supplier_document: supplierDocument ?? null,
            });
          } else if (supplierId) {
            marcador(companyId, "FORNECEDOR_JA_EXISTIA", {
              batch_id: batchId,
              file_id: fileId,
              supplier_id: supplierId,
              supplier_document: supplierDocument ?? null,
            });
          } else {
            marcador(companyId, "FORNECEDOR_NAO_RESOLVIDO", {
              batch_id: batchId,
              file_id: fileId,
              supplier_document: supplierDocument ?? null,
            });
          }
          pibLog(
            execId,
            "fornecedor_resolvido",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "ensureSupplierFromExtracted concluído",
            {
              supplier_id: supplierId,
              created_new: sr.createdNew,
              supplier_document: supplierDocument,
            },
          );
          const safeItems = Array.isArray(data.items)
            ? data.items.filter((raw) => raw != null).map((raw) => {
              const it = (raw ?? {}) as Record<string, unknown>;
              const quantity = parseLooseNumber(it.quantity);
              const unitValue = parseLooseNumber(it.unitValue);
              const lineTotalRaw = parseLooseNumber(it.lineTotal);
              return {
                ...it,
                productName: String(it.productName ?? "").trim() || "Item",
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0.0001,
                unitValue: Number.isFinite(unitValue) ? unitValue : 0,
                lineTotal: Number.isFinite(lineTotalRaw)
                  ? lineTotalRaw
                  : (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitValue) ? unitValue : 0),
                unitCommercial: it.unitCommercial == null ? null : String(it.unitCommercial),
                unitTax: it.unitTax == null ? null : String(it.unitTax),
                productCode: it.productCode == null ? null : String(it.productCode),
                ncm: it.ncm == null ? null : String(it.ncm),
                ean: it.ean == null ? null : String(it.ean),
              };
            })
            : [];
          const finalItems = safeItems.map((item) => ({
            ...item,
            productId: null,
            import_pending_resolution: false,
          }));
          const rawRowIdsOrdered: string[] = [];
          let itemIndex = 0;
          for (const item of finalItems.filter((x) => x != null)) {
            const { data: ijInserted, error: ijInsErr } = await supabase
              .from("import_job_items")
              .insert({
              batch_id: batchId,
              file_id: fileId,
              company_id: companyId,
              item_index: itemIndex,
              product_name: (() => {
                const raw = String(item.productName ?? "");
                return stripPackSizeFromLabel(raw).trim() || raw;
              })(),
              status: "COMPLETED",
              classification_type: "PRODUTO_ESTOCAVEL",
              pending_reason: null,
              payload: item,
            })
              .select("id")
              .single();
            if (ijInsErr) {
              throw new Error(ijInsErr.message);
            }
            const rawName = String(item.productName ?? "").trim() || "Item";
            const eanDigits = digitsOnly(String((item as { ean?: string }).ean ?? ""));
            const { data: rawIns, error: rawInsErr } = await supabase
              .from("onboarding_import_item_raw")
              .insert({
                company_id: companyId,
                import_job_batch_id: batchId,
                import_job_file_id: fileId,
                import_job_item_id: ijInserted?.id ?? null,
                description_original: rawName,
                description_normalized: normalizeCatalogLabel(rawName),
                supplier_id: supplierId,
                supplier_name_snapshot: String(data.supplierName ?? "").trim() || null,
                xml_origem: file.file_name,
                unit_raw: String((item as { unitCommercial?: string }).unitCommercial ?? "").trim() || null,
                quantity: parseLooseNumber((item as { quantity?: unknown }).quantity),
                line_value: parseLooseNumber((item as { lineTotal?: unknown }).lineTotal),
                ean: eanDigits ? eanDigits : null,
                ncm: String((item as { ncm?: string }).ncm ?? "").trim() || null,
                extracted_attributes: {},
                created_product_id: null,
              })
              .select("id")
              .single();
            if (rawInsErr) throw new Error(rawInsErr.message);
            rawRowIdsOrdered.push(String(rawIns?.id ?? ""));
            itemIndex += 1;
            item.import_job_item_id = ijInserted?.id ?? null;
            item.onboarding_import_item_raw_id = rawIns?.id ?? null;
          }

          const fromExtractedTotal = parseLooseNumber(data.totalAmount);
          const fromXmlVnfTotal = extractXmlVnfTotal(xmlText);
          const summedLines = sumExpenseLineTotals(finalItems);
          const documentTotalResolved =
            Number.isFinite(fromExtractedTotal) && fromExtractedTotal > 0
              ? fromExtractedTotal
              : Number.isFinite(fromXmlVnfTotal) && (fromXmlVnfTotal ?? 0) > 0
                ? fromXmlVnfTotal
              : summedLines > 0
                ? summedLines
                : null;
          pibLog(
            execId,
            "totais_despesa_resolvidos",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "totais calculados para criação da despesa",
            {
              from_extracted_total: fromExtractedTotal,
              from_xml_vnf_total: fromXmlVnfTotal,
              summed_lines_total: summedLines,
              document_total_resolved: documentTotalResolved,
              items_count: finalItems.length,
            },
          );
          const referenceDateIso =
            emissionDate && /^\d{4}-\d{2}-\d{2}$/.test(emissionDate)
              ? emissionDate
              : new Date().toISOString().slice(0, 10);

          const { data: duplicateExpenseId, error: dupExpenseErr } = await supabase
            .rpc("expense_find_duplicate_by_supplier_document", {
              p_company_id: companyId,
              p_supplier_id: supplierId,
              p_supplier_document: supplierDocument,
              p_invoice_number: invoiceNumber,
              p_invoice_series: invoiceSeries,
              p_exclude_expense_id: null,
            });
          if (dupExpenseErr) {
            pibLog(
              execId,
              "duplicado_rpc_erro",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              "expense_find_duplicate_by_supplier_document falhou; segue tentativa de insert",
              { erro: dupExpenseErr.message },
            );
          }
          const duplicateExpense = String(duplicateExpenseId ?? "").trim();
          const duplicateExpenseExists = await expenseExists(supabase, companyId, duplicateExpense);
          if (duplicateExpense && duplicateExpenseExists) {
            expenseId = duplicateExpense;
            pibLog(
              execId,
              "skip_despesa_duplicada_fornecedor_documento",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              "despesa já existe para fornecedor + nº/série; arquivo marcado como duplicate",
              { expense_id: expenseId, invoice_number: invoiceNumber, invoice_series: invoiceSeries },
            );
            await upsertCompanyNfeImportLog(supabase, {
              company_id: companyId,
              file_name: file.file_name,
              xml_hash: file.xml_hash,
              nfe_access_key: nfeAccessKey,
              invoice_number: invoiceNumber,
              invoice_series: invoiceSeries,
              supplier_document: supplierDocument,
              emission_date: emissionDate,
              status: "duplicate",
              error_message: "Nota já existente por fornecedor + número/série.",
              expense_id: expenseId,
              payload: data,
              import_job_batch_id: batchId,
              import_job_file_id: fileId,
            });
            await appendTimelineMaybeQuiet(
              supabase,
              batchId,
              "DONE",
              "Arquivo ignorado por duplicidade de fornecedor + número/série.",
              { expense_id: expenseId },
              fileId,
            );
            fileStatus = "COMPLETED";
            continue;
          } else if (duplicateExpense && !duplicateExpenseExists) {
            pibLog(
              execId,
              "reprocessar_duplicado_fornecedor_orfao",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              "rpc retornou despesa duplicada, mas ela não existe mais; segue criação da despesa",
              { expense_id_log: duplicateExpense, invoice_number: invoiceNumber, invoice_series: invoiceSeries },
            );
          }

          const { data: expense, error: expErr } = await supabase
            .from("expenses")
            .insert({
              company_id: companyId,
              created_by: batch.requested_by ?? null,
              type: "nota_fiscal",
              expense_source: "manual",
              invoice_number: invoiceNumber,
              invoice_series: invoiceSeries,
              supplier_id: supplierId,
              supplier_document: data.supplierDocument,
              supplier_name: data.supplierName,
              status: "pending",
              notes: nfeAccessKey ? `Importado em background — chave ${nfeAccessKey}` : "Importado em background",
              document_total: documentTotalResolved,
              reference_date: referenceDateIso,
            })
            .select("id")
            .single();
          if (expErr || !expense?.id) {
            pibLog(
              execId,
              "despesa_insert_FALHOU",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              expErr?.message ?? "sem id na resposta insert expenses",
              { postgres: expErr ?? null },
            );
            throw new Error(expErr?.message ?? "Falha ao criar despesa.");
          }
          expenseId = String(expense.id);
          pibLog(
            execId,
            "despesa_criada",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "expenses.insert OK",
            {
              expense_id: expenseId,
              supplier_id: supplierId,
              document_total: documentTotalResolved,
              reference_date: referenceDateIso,
            },
          );
          marcador(companyId, "DESPESA_CRIADA", {
            batch_id: batchId,
            file_id: fileId,
            expense_id: expenseId,
            supplier_id: supplierId,
            chave_nfe_44: nfeAccessKey,
          });
          await appendTimelineMaybeQuiet(supabase, batchId, "UPSERT_EXPENSE", "Despesa criada.", { expense_id: expenseId }, fileId);

          const expenseItemRowsPayload = finalItems.map((it) => {
            const q = Math.max(0.0001, Number(it.quantity ?? 0));
            const uv = Number(it.unitValue ?? 0);
            const invUnit = String(it.unitCommercial ?? "").trim() || null;
            const productId = String(it.productId ?? "").trim() || null;
            const stockQty = Number(it.quantity ?? q);
            const rawPn = String(it.productName ?? "Item");
            const displayName =
              stripPackSizeFromLabel(rawPn).trim() || rawPn;
            return {
              expense_id: expenseId,
              product_name: displayName,
              quantity: q,
              unit_value: uv,
              product_id: productId,
              invoice_unit: invUnit,
              stock_quantity: Number.isFinite(stockQty) ? stockQty : q,
              stock_added: false,
              import_nature: "ESTOQUE_DIRETO",
              import_engine_suggestion: "XML_CATALOG_MOTOR_PENDING",
              import_confidence_0_1: null,
              import_score_reasons_json: {
                xml_catalog_motor: {
                  pending: true,
                  motor_version: NFE_CATALOG_MOTOR_VERSION,
                  note: importXmlProductsAfterBatchEnabled()
                    ? "Motor de catálogo agendado após este lote."
                    : "Motor de catálogo desativado (IMPORT_XML_PRODUCTS_AFTER_BATCH=false).",
                },
              },
              import_stock_resolution: null,
              resolved_entry_breakdown_recipe_id: null,
              import_pending_resolution: true,
              import_resolution_status:
                importXmlProductsAfterBatchEnabled()
                  ? null
                  : "AWAITING_XML_CATALOG_MOTOR",
              import_applied_rule_id: null,
              match_score: null,
              match_decision_reason: null,
            };
          });
          const { data: insertedExpenseItems, error: bulkItemErr } = await supabase
            .from("expense_items")
            .insert(expenseItemRowsPayload)
            .select("id");
          if (bulkItemErr || !insertedExpenseItems?.length) {
            throw new Error(bulkItemErr?.message ?? "Falha ao inserir itens de despesa.");
          }
          if (insertedExpenseItems.length !== finalItems.length) {
            throw new Error(
              `Inserção de itens incompleta: esperado ${finalItems.length}, retornado ${insertedExpenseItems.length}.`,
            );
          }
          for (let idx = 0; idx < finalItems.length; idx++) {
            const insItem = insertedExpenseItems[idx] as { id?: string };
            const ri = rawRowIdsOrdered[idx];
            if (ri && insItem?.id) {
              await supabase
                .from("onboarding_import_item_raw")
                .update({
                  expense_item_id: String(insItem.id),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", ri)
                .eq("company_id", companyId);
            }
          }

          pibLog(
            execId,
            "expense_items_concluido",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "linhas expense_items inseridas",
            {
              expense_id: expenseId,
              linhas: finalItems.length,
              pending_for_file_apos_itens: pendingForFile,
            },
          );
          marcador(companyId, "N_ITENS_DESPESA", {
            batch_id: batchId,
            file_id: fileId,
            expense_id: expenseId,
            quantidade: finalItems.length,
          });

          const { error: recErr } = await supabase
            .from("recebimentos")
            .insert({ expense_id: expenseId });
          if (recErr) {
            pibLog(
              execId,
              "recebimento_insert_FALHOU",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              recErr.message,
              {},
            );
            throw new Error(recErr.message);
          }
          pibLog(
            execId,
            "recebimento_criado",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "recebimentos.insert OK",
            { expense_id: expenseId },
          );
          marcador(companyId, "RECEBIMENTO_CRIADO", {
            batch_id: batchId,
            file_id: fileId,
            expense_id: expenseId,
          });

          const invRefParts = [invoiceSeries, invoiceNumber].filter(
            (x) => !!String(x ?? "").trim(),
          );
          const invoiceRefLabel =
            invRefParts.length > 0 ? invRefParts.join("/") : (nfeAccessKey ?? "").slice(-12);
          const boRes = await insertBoletosFromNfeDupXml(
            supabase,
            companyId,
            expenseId,
            xmlText,
            invoiceRefLabel || "NF-e",
          );
          if (boRes.inserted > 0) {
            marcador(companyId, "BOLETO_CRIADO", {
              batch_id: batchId,
              file_id: fileId,
              expense_id: expenseId,
              parcelas: boRes.inserted,
            });
            pibLog(
              execId,
              "boletos_dup_xml",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              `insertBoletosFromNfeDupXml: ${boRes.inserted} parcela(s)`,
              { rows: boRes.rows },
            );
            await appendTimelineMaybeQuiet(
              supabase,
              batchId,
              "BOLETOS",
              `${boRes.inserted} parcela(s) da cobrança registrada(s).`,
              { duplicatas: boRes.rows },
              fileId,
            );
          }

          await upsertCompanyNfeImportLog(supabase, {
            company_id: companyId,
            file_name: file.file_name,
            xml_hash: file.xml_hash,
            nfe_access_key: nfeAccessKey,
            invoice_number: invoiceNumber,
            invoice_series: invoiceSeries,
            supplier_document: supplierDocument,
            emission_date: emissionDate,
            status: "success",
            error_message: null,
            expense_id: expenseId,
            payload: data,
            import_job_batch_id: batchId,
            import_job_file_id: fileId,
          });
          pibLog(
            execId,
            "import_log_gravado",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "company_nfe_import_logs upsert OK",
            {
              expense_id: expenseId,
              log_status: "success",
            },
          );
          marcador(companyId, "IMPORT_NFE_LOG_GRAVADO", {
            batch_id: batchId,
            file_id: fileId,
            expense_id: expenseId,
          });
          scheduleWaitUntilEdge(
            invokeProcessExpenseXmlProducts({
              supabaseUrl,
              serviceRole,
              anonKey,
              companyId,
              expenseId,
              importJobFileId: fileId,
              execId,
              logPrefix: LOG,
            }),
          );
        }
      } else {
        pibLog(
          execId,
          "skip_sem_chave_nfe",
          { company_id: companyId, batch_id: batchId, file_id: fileId },
          "XML válido mas extracted sem chave de acesso (nfeAccessKey) — não entra no fluxo despesa/fornecedor",
          { file_name: file.file_name },
        );
        await appendTimelineMaybeQuiet(
          supabase,
          batchId,
          "VALIDATE",
          "Sem chave de acesso da NF-e no XML parseado — despesa não criada.",
          { file_name: file.file_name },
          fileId,
        );
      }

      if (pendingForFile > 0) {
        fileStatus = "COMPLETED_WITH_PENDING_REVIEW";
        pendingReviewFiles += 1;
      } else {
        fileStatus = "COMPLETED";
      }
      pibLog(
        execId,
        "ficheiro_fim_try",
        { company_id: companyId, batch_id: batchId, file_id: fileId },
        "try concluído sem throw",
        {
          file_status: fileStatus,
          expense_id: expenseId,
          pending_for_file: pendingForFile,
        },
      );
      await appendTimelineMaybeQuiet(supabase, batchId, "DONE", "Arquivo processado.", { pending_count: pendingForFile, expense_id: expenseId }, fileId);
    } catch (e) {
      fileStatus = "FAILED";
      fileError = e instanceof Error ? e.message : "Falha ao processar arquivo";
      console.error(
        LOG,
        JSON.stringify({
          exec_id: execId,
          fase: "ficheiro_ERRO",
          company_id: companyId,
          batch_id: batchId,
          file_id: fileId,
          mensagem: fileError,
          stack: e instanceof Error ? e.stack : undefined,
        }),
      );
      await appendTimelineMaybeQuiet(supabase, batchId, "ERROR", fileError, {}, fileId);
    }

    processed += 1;
    if (fileStatus === "FAILED") failed += 1;
    else success += 1;
    const progressPercent = calcProgressPercent(processed, totalFilesBase);
    await supabase
      .from("import_job_files")
      .update({
        status: fileStatus,
        retry_count: fileStatus === "FAILED" ? 1 : 0,
        last_error: fileError,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId);
    await supabase
      .from("import_job_batches")
      .update({
        processed_files: processed,
        success_files: success,
        failed_files: failed,
        pending_review_files: pendingReviewFiles,
        progress_percent: progressPercent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  }

  const { count: stillActive } = await supabase
    .from("import_job_files")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .in("status", ["QUEUED", "PROCESSING"]);

  const { data: batchBeforeChain } = await supabase
    .from("import_job_batches")
    .select("status")
    .eq("id", batchId)
    .maybeSingle();
  if (String(batchBeforeChain?.status) === "CANCELLED") {
    return json({
      ok: true,
      batch_id: batchId,
      status: "CANCELLED",
      cancelled: true,
      processed_files: processed,
      success_files: success,
      failed_files: failed,
      pending_review_files: pendingReviewFiles,
    });
  }

  const clientSingleFileMode = testSingleFileInvoke && !isServiceCaller;

  if ((stillActive ?? 0) > 0 && !clientSingleFileMode) {
    pibLog(
      execId,
      "chain_proxima_ronda",
      { company_id: companyId, batch_id: batchId },
      `ainda ${stillActive} ficheiro(s) QUEUED/PROCESSING — invoke process-import-job-batch`,
      { remaining_files: stillActive },
    );
    marcador(companyId, "ENCADEAMENTO_INVOKE_INICIO", {
      batch_id: batchId,
      remaining_files: stillActive,
    });

    const nextRoundPromise = fetchChainedBatchRound({
      supabaseUrl,
      authHeader,
      anonKey,
      batchId,
      testSingleFileInvoke,
    })
      .then(async (nextRound) => {
        if (!nextRound.ok) {
          const bodyTxt = await nextRound.text().catch(() => "");
          marcador(companyId, "ENCADEAMENTO_INVOKE_ERRO", {
            batch_id: batchId,
            status: nextRound.status,
            worker_limit_546_hint:
              nextRound.status === 546
                ? "reduza_IMPORT_BATCH_MAX_FILES_PER_RUN_ou_test_single_file"
                : undefined,
          });
          const hint546 =
            nextRound.status === 546
              ? " Limite do worker Edge (546): reduza IMPORT_BATCH_MAX_FILES_PER_RUN ou use IMPORT_BATCH_TEST_SINGLE_FILE=true ou test_single_file no POST."
              : "";
          pibLog(
            execId,
            "chain_invoke_erro_http",
            { company_id: companyId, batch_id: batchId },
            `HTTP ${nextRound.status}${hint546}`,
            { resposta: bodyTxt.slice(0, 500) },
          );
          return;
        }
        marcador(companyId, "ENCADEAMENTO_INVOKE_OK", { batch_id: batchId });
        pibLog(
          execId,
          "chain_invoke_ok",
          { company_id: companyId, batch_id: batchId },
          "invoke assíncrono concluído",
          {},
        );
      })
      .catch((e) => {
        marcador(companyId, "ENCADEAMENTO_INVOKE_EXCECAO", {
          batch_id: batchId,
          erro: String(e),
        });
        pibLog(
          execId,
          "chain_invoke_excecao",
          { company_id: companyId, batch_id: batchId },
          String(e),
          {},
        );
      });
    try {
      // @ts-ignore Edge runtime helper (quando disponível)
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-ignore
        EdgeRuntime.waitUntil(nextRoundPromise);
      } else {
        void nextRoundPromise;
      }
    } catch {
      void nextRoundPromise;
    }
    return json({
      ok: true,
      batch_id: batchId,
      exec_id: execId,
      status: "PROCESSING",
      processed_files: processed,
      success_files: success,
      failed_files: failed,
      pending_review_files: pendingReviewFiles,
      remaining_files: stillActive ?? 0,
    });
  }

  if ((stillActive ?? 0) > 0 && clientSingleFileMode) {
    return json({
      ok: true,
      batch_id: batchId,
      exec_id: execId,
      status: "PROCESSING",
      processed_files: processed,
      success_files: success,
      failed_files: failed,
      pending_review_files: pendingReviewFiles,
      remaining_files: stillActive ?? 0,
    });
  }

  const { data: batchTerminal } = await supabase
    .from("import_job_batches")
    .select("status")
    .eq("id", batchId)
    .maybeSingle();

  let finalStatus: string;
  if (String(batchTerminal?.status) === "CANCELLED") {
    finalStatus = "CANCELLED";
  } else if (failed > 0 && success > 0) {
    finalStatus = "PARTIAL_SUCCESS";
  } else if (failed > 0) {
    finalStatus = "FAILED";
  } else if (pendingReviewFiles > 0) {
    finalStatus = "COMPLETED_WITH_PENDING_REVIEW";
  } else {
    finalStatus = "COMPLETED";
  }

  await supabase
    .from("import_job_batches")
    .update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      progress_percent: 100,
      updated_at: new Date().toISOString(),
      last_error:
        finalStatus === "CANCELLED"
          ? "Importação cancelada pelo usuário."
          : failed > 0
            ? "Alguns arquivos falharam no processamento."
            : null,
    })
    .eq("id", batchId);

  const { count: rawInBatch } = await supabase
    .from("onboarding_import_item_raw")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("import_job_batch_id", batchId);
  if ((rawInBatch ?? 0) > 0 && finalStatus !== "CANCELLED") {
    const reconcileAuth =
      serviceRole && String(serviceRole).length > 0
        ? `Bearer ${serviceRole}`
        : authHeader!;
    const reconcileTrigger = fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/run-onboarding-product-reconciliation`,
      {
        method: "POST",
        headers: {
          Authorization: reconcileAuth,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ company_id: companyId, source_batch_id: batchId }),
      },
    ).catch(() => undefined);
    scheduleWaitUntilEdge(reconcileTrigger);
  }

  await upsertImportPendingReviewCompanyAlert(supabase, companyId);

  pibLog(
    execId,
    "request_fim_terminal",
    { company_id: companyId, batch_id: batchId },
    "lote sem ficheiros pendentes — estado final",
    {
      final_status: finalStatus,
      processed_files: processed,
      success_files: success,
      failed_files: failed,
      pending_review_files: pendingReviewFiles,
    },
  );

  return json({
    ok: true,
    batch_id: batchId,
    exec_id: execId,
    status: finalStatus,
    processed_files: processed,
    success_files: success,
    failed_files: failed,
    pending_review_files: pendingReviewFiles,
  });
});

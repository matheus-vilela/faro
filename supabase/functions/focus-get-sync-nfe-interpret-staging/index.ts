/**
 * Processa jobs da fila `focus_get_sync_nfe_interpret_jobs` (enfileirados por `focus-get-sync-nfe`
 * quando há linhas em `focus_get_sync_nfe_staging` com XML).
 *
 * **Disparo:** pg_cron → `cron_invoke_focus_get_sync_nfe_interpret()` → `net.http_post` (Vault) com Bearer secret.
 * O cron invoca a Edge periodicamente; em `claim_vazio` a função finaliza jobs órfãos em `processing`
 * (staging vazio ou offset já completo) e `pending` sem linhas em staging.
 *
 * **Timeout / volume:** fatias (`FOCUS_GET_SYNC_INTERPRET_STAGING_CHUNK`, default 5). O job permanece em
 * **`processing`**: após cada fatia atualiza `staging_process_offset` e agenda **nova invocação** desta
 * mesma função com body `{ "continue_job_id": "<job uuid>", "chain_depth": N }` via `fetch` +
 * `EdgeRuntime.waitUntil` (sem esperar o próximo cron). `attempts` só sobe na primeira fatia (RPC claim).
 *
 * **Continuação:** POST com o mesmo Bearer + JSON acima; não usa `claim` — carrega o job por id e segue
 * a partir de `staging_process_offset` (progresso) até `staging_xml_total` (XMLs com conteúdo em staging).
 * `FOCUS_GET_SYNC_INTERPRET_MAX_CHAIN_DEPTH` limita encadeamentos.
 *
 * Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (para o POST encadeado no gateway),
 * `FOCUS_NFE_RECEBIDAS_CRON_SECRET`.
 * Opcional: `FOCUS_GET_SYNC_INTERPRET_MAX_JOBS` (default 2), `FOCUS_GET_SYNC_INTERPRET_STAGING_CHUNK` (default 5),
 * `FOCUS_GET_SYNC_INTERPRET_MAX_CHAIN_DEPTH` (default 120).
 * Opcional (LLM): `OPENAI_API_KEY`, `OPENAI_PRODUCT_MATCH_MODEL`.
 * Catálogo global `unified_supplier_*` é atualizado aqui (parse XML por nota), não em `focus-get-sync-nfe`.
 * Onboarding: `companies.onboarding_fiscal.nfes_sync` = `staging_process_offset` (teto `max_nfes_sync`), não +chunk.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  interpretStagingNfeXmlForLog,
  type StagingNfeInterpretLog,
} from "../_shared/stagingNfeInterpretLog.ts";
import {
  ensureSupplierForInterpretLog,
  fetchProductCatalogForStagingInterpret,
  persistStagingInterpretExpenseAndBoletos,
  resolveProductsForInterpretLog,
} from "../_shared/stagingNfeInterpretPostProcess.ts";
import { upsertUnifiedSupplierCatalogFromNfeXml } from "../_shared/unifiedSupplierCatalogFromNfeXml.ts";

const LOG = "[focus-get-sync-nfe-interpret-staging]";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function logPhase(
  phase: string,
  payload: Record<string, unknown>,
): void {
  console.log(LOG, JSON.stringify({ fase: phase, ...payload }));
}

function interpretLogSummary(payload: StagingNfeInterpretLog): Record<string, unknown> {
  return {
    chave_nfe: payload.chave_nfe,
    staging_id: payload.staging_id ?? null,
    parse_ok: payload.parse_ok,
    parse_erro: payload.parse_erro ?? null,
    fornecedor_nome: payload.fornecedor.nome,
    fornecedor_documento: payload.fornecedor.documento,
    valor_total_nota: payload.valor_total_nota,
    numero_nota: payload.numero_nota,
    produtos_count: payload.produtos.length,
    boletos_count: payload.cobranca_boletos.length,
  };
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

function scheduleWaitUntil(p: Promise<unknown>): void {
  try {
    // @ts-ignore Edge
    const ER = globalThis.EdgeRuntime;
    if (ER && typeof ER.waitUntil === "function") {
      // @ts-ignore
      ER.waitUntil(p);
      return;
    }
  } catch {
    /* ignore */
  }
  void p.catch(() => undefined);
}

type InterpretJobRow = {
  id: string;
  exec_id: string;
  company_id: string;
  status: string;
  attempts: number;
  staging_process_offset?: number | null;
  staging_xml_total?: number | null;
  onboarding?: boolean | null;
};

type JobSummary = {
  job_id: string;
  exec_id: string;
  company_id: string;
  staging_rows: number;
  interpretacoes: number;
  staging_total?: number;
  staging_xml_total?: number;
  chunk_offset_start?: number;
  continua?: boolean;
  chain_depth?: number;
};

// deno-lint-ignore no-explicit-any
function applyStagingXmlContentFilters(query: any): any {
  return query.not("xml_content", "is", null).neq("xml_content", "");
}

// deno-lint-ignore no-explicit-any
type Admin = any;

type ChunkOk = {
  kind: "chunk_ok";
  interpretacoes: StagingNfeInterpretLog[];
  listLen: number;
  total: number;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
};

type ChunkFail = { kind: "fail"; message: string };
type ChunkEmptyDone = { kind: "empty_done" };
type ChunkOffsetDone = { kind: "offset_done" };

type ChunkResult = ChunkOk | ChunkFail | ChunkEmptyDone | ChunkOffsetDone;

function numOnboardingMetric(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

/**
 * Progresso da interpretação = offset já processado no job (absoluto, não soma por chunk).
 * Limita a `max_nfes_sync` para não passar de 100% no dashboard nem acumular em retries.
 */
async function setOnboardingInterpretNfesSyncProgress(
  admin: Admin,
  companyId: string,
  isOnboardingJob: boolean,
  processedOffset: number,
): Promise<void> {
  if (!isOnboardingJob) return;
  const processed = Math.max(0, Math.floor(processedOffset));
  const { data: row, error } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !row) {
    console.warn(LOG, "onboarding_fiscal_read", companyId, error?.message);
    return;
  }
  const raw = row.onboarding_fiscal;
  const prev =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const max = numOnboardingMetric(prev.max_nfes_sync);
  const nfes_sync = max > 0 ? Math.min(processed, max) : processed;
  const next: Record<string, unknown> = {
    ...prev,
    nfes_sync,
  };
  const { error: upErr } = await admin
    .from("companies")
    .update({ onboarding_fiscal: next })
    .eq("id", companyId);
  if (upErr) {
    console.warn(LOG, "onboarding_fiscal_update", companyId, upErr.message);
    return;
  }
  logPhase("onboarding_fiscal_interpret", {
    company_id: companyId,
    nfes_sync,
    processed_offset: processed,
    max_nfes_sync: max,
  });
}

/** Só após `finalizeJobDone`: encerra fase de sync (`sync: false`), aguarda confirmação no dashboard. */
async function finalizeOnboardingFiscalSyncAfterInterpretJobDone(
  admin: Admin,
  companyId: string,
  isOnboardingJob: boolean,
): Promise<void> {
  if (!isOnboardingJob) return;
  const { data: row, error } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !row) {
    console.warn(LOG, "onboarding_fiscal_read", companyId, error?.message);
    return;
  }
  const raw = row.onboarding_fiscal;
  const prev =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const completed = prev.completed === true;
  if (completed) return;
  const max = numOnboardingMetric(prev.max_nfes_sync);
  const synced = numOnboardingMetric(prev.nfes_sync);
  const next: Record<string, unknown> = {
    ...prev,
    sync: false,
    completed: false,
    nfes_sync: max > 0 ? Math.max(synced, max) : synced,
  };
  const { error: upErr } = await admin
    .from("companies")
    .update({ onboarding_fiscal: next })
    .eq("id", companyId);
  if (upErr) {
    console.warn(LOG, "onboarding_fiscal_sync_off", companyId, upErr.message);
    return;
  }
  logPhase("onboarding_fiscal_interpret_sync_off", {
    company_id: companyId,
    nfes_sync: next.nfes_sync,
  });
}

/** Marca job `done` e só então `onboarding_fiscal.sync = false` (onboarding). */
async function completeInterpretJobAndEndOnboardingSync(
  admin: Admin,
  job: { id: string; company_id: string; onboarding?: boolean | null },
): Promise<string | null> {
  const err = await finalizeJobDone(admin, job.id);
  if (!err) {
    await finalizeOnboardingFiscalSyncAfterInterpretJobDone(
      admin,
      job.company_id,
      job.onboarding === true,
    );
  }
  return err;
}

async function runInterpretStagingChunk(
  admin: Admin,
  row: InterpretJobRow,
  stagingChunk: number,
): Promise<ChunkResult> {
  const offset = Math.max(
    0,
    Math.floor(Number(row.staging_process_offset ?? 0) || 0),
  );

  const stagingXmlTotal = Math.max(
    0,
    Math.floor(Number(row.staging_xml_total ?? 0) || 0),
  );

  logPhase("chunk_inicio", {
    job_id: row.id,
    exec_id: row.exec_id,
    company_id: row.company_id,
    offset,
    staging_chunk: stagingChunk,
    staging_xml_total: stagingXmlTotal,
    onboarding: row.onboarding === true,
  });

  const { count: totalStaging, error: countErr } = await applyStagingXmlContentFilters(
    admin
      .from("focus_get_sync_nfe_staging")
      .select("id", { count: "exact", head: true })
      .eq("exec_id", row.exec_id)
      .eq("company_id", row.company_id),
  );

  if (countErr) {
    logPhase("chunk_count_erro", {
      job_id: row.id,
      error: countErr.message,
    });
    return { kind: "fail", message: countErr.message };
  }

  const total = totalStaging ?? 0;

  if (total === 0) {
    logPhase("chunk_vazio", { job_id: row.id, exec_id: row.exec_id });
    return { kind: "empty_done" };
  }

  if (offset >= total) {
    logPhase("chunk_offset_ja_completo", {
      job_id: row.id,
      offset,
      staging_total: total,
    });
    return { kind: "offset_done" };
  }

  const rangeEnd = Math.min(offset + stagingChunk - 1, total - 1);

  logPhase("chunk_staging_query", {
    job_id: row.id,
    staging_total: total,
    offset,
    range_end: rangeEnd,
    rows_esperadas: rangeEnd - offset + 1,
  });

  const { data: stagingRows, error: stagingErr } = await applyStagingXmlContentFilters(
    admin
      .from("focus_get_sync_nfe_staging")
      .select("id,chave_nfe,xml_content")
      .eq("exec_id", row.exec_id)
      .eq("company_id", row.company_id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, rangeEnd),
  );

  if (stagingErr) {
    logPhase("chunk_staging_query_erro", {
      job_id: row.id,
      error: stagingErr.message,
    });
    return { kind: "fail", message: stagingErr.message };
  }

  const list = stagingRows ?? [];
  const interpretacoes: StagingNfeInterpretLog[] = [];

  const { catalog: productCatalog, error: catalogFetchErr } =
    await fetchProductCatalogForStagingInterpret(admin, row.company_id);
  if (catalogFetchErr) {
    logPhase("produtos_catalogo_fetch_erro", {
      company_id: row.company_id,
      error: catalogFetchErr,
    });
  } else {
    logPhase("produtos_catalogo_carregado", {
      company_id: row.company_id,
      catalog_size: productCatalog.length,
    });
  }
  /** Mesmo item em notas diferentes do chunk: reutiliza `product_id` sem novo insert. */
  const chunkProductDedupeByKey = new Map<string, string>();

  for (const st of list) {
    const stagingId = String(st.id ?? "");
    const chaveNfe = String(st.chave_nfe ?? "");
    const xmlLen =
      typeof st.xml_content === "string" ? st.xml_content.length : 0;

    logPhase("staging_row_inicio", {
      job_id: row.id,
      staging_id: stagingId,
      chave_nfe: chaveNfe,
      xml_chars: xmlLen,
    });

    const payload = interpretStagingNfeXmlForLog(
      chaveNfe,
      st.xml_content as string | null | undefined,
      stagingId,
    );
    interpretacoes.push(payload);
    logPhase("staging_row_interpret", interpretLogSummary(payload));

    const productIdByLineIndex = new Map<number, string>();
    const t0 = Date.now();
    const xmlRaw = st.xml_content as string | null | undefined;
    const catalogPromise =
      typeof xmlRaw === "string" && xmlRaw.trim().startsWith("<")
        ? upsertUnifiedSupplierCatalogFromNfeXml(admin, xmlRaw, {
            chave_nfe: chaveNfe,
            company_id: row.company_id,
          }).then((catalogRes) => {
            if (!catalogRes.ok && catalogRes.skippedReason) {
              logPhase("unified_catalog_skip", {
                staging_id: stagingId,
                chave_nfe: chaveNfe,
                reason: catalogRes.skippedReason,
              });
            }
            return catalogRes;
          }).catch((catalogErr) => {
            logPhase("unified_catalog_err", {
              staging_id: stagingId,
              chave_nfe: chaveNfe,
              error: String(catalogErr),
            });
            return null;
          })
        : Promise.resolve(null);

    await Promise.all([
      ensureSupplierForInterpretLog(admin, row.company_id, payload),
      resolveProductsForInterpretLog(
        admin,
        row.company_id,
        payload,
        productCatalog,
        productIdByLineIndex,
        chunkProductDedupeByKey,
      ),
      catalogPromise,
    ]);
    logPhase("staging_row_produtos_fornecedor", {
      staging_id: stagingId,
      chave_nfe: chaveNfe,
      produtos_resolvidos: productIdByLineIndex.size,
      ms: Date.now() - t0,
    });

    const t1 = Date.now();
    await persistStagingInterpretExpenseAndBoletos(
      admin,
      row.company_id,
      payload,
      productIdByLineIndex,
    );
    logPhase("staging_row_persistido", {
      staging_id: stagingId,
      chave_nfe: chaveNfe,
      ms: Date.now() - t1,
    });
  }

  const nextOffset = offset + list.length;
  const hasMore = nextOffset < total;

  logPhase("chunk_fim", {
    job_id: row.id,
    exec_id: row.exec_id,
    company_id: row.company_id,
    staging_chunk_rows: list.length,
    staging_total: total,
    staging_xml_total: stagingXmlTotal || total,
    chunk_offset_start: offset,
    chunk_offset_next: nextOffset,
    continua: hasMore,
    interpretacoes: interpretacoes.length,
    parse_ok_count: interpretacoes.filter((p) => p.parse_ok).length,
    parse_fail_count: interpretacoes.filter((p) => !p.parse_ok).length,
    chaves: interpretacoes.map((p) => p.chave_nfe),
  });

  return {
    kind: "chunk_ok",
    interpretacoes,
    listLen: list.length,
    total,
    offset,
    nextOffset,
    hasMore,
  };
}

function scheduleContinueChain(
  supabaseUrl: string,
  anonKey: string,
  bearerSecret: string,
  jobId: string,
  chainDepth: number,
): void {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/focus-get-sync-nfe-interpret-staging`;
  const p = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerSecret}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      continue_job_id: jobId,
      chain_depth: chainDepth,
    }),
  }).catch((e) =>
    logPhase("chain_fetch_erro", { job_id: jobId, error: String(e) })
  );

  scheduleWaitUntil(p);
  logPhase("continuacao_agendada", {
    job_id: jobId,
    chain_depth_next: chainDepth,
  });
}

async function finalizeJobDone(
  admin: Admin,
  jobId: string,
): Promise<string | null> {
  const { error } = await admin
    .from("focus_get_sync_nfe_interpret_jobs")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      last_error: null,
      staging_process_offset: 0,
    })
    .eq("id", jobId);
  return error?.message ?? null;
}

async function finalizeJobFailed(
  admin: Admin,
  jobId: string,
  message: string,
): Promise<void> {
  logPhase("job_marcado_failed", { job_id: jobId, error: message });
  await admin
    .from("focus_get_sync_nfe_interpret_jobs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      last_error: message,
      staging_process_offset: 0,
    })
    .eq("id", jobId);
}

/** Repõe `processing` → `pending` para o cron voltar a apanhar o job após exceção não tratada. */
async function requeueProcessingInterpretJob(
  admin: Admin,
  jobId: string | null,
  reason: string,
): Promise<void> {
  if (!jobId) return;
  const note = `recover_exceção: ${reason.slice(0, 900)}`;
  const { error } = await admin
    .from("focus_get_sync_nfe_interpret_jobs")
    .update({
      status: "pending",
      last_error: note,
    })
    .eq("id", jobId)
    .eq("status", "processing");
  if (error) {
    logPhase("requeue_job_falhou", { job_id: jobId, error: error.message });
  } else {
    logPhase("job_reposto_pending_excecao", { job_id: jobId, reason });
  }
}

type RecoverSummary = {
  finalized: string[];
  reposted: string[];
  continued: string[];
};

/** Jobs em `processing` ou `pending` sem staging: finaliza ou retoma (evita fila presa). */
async function recoverOrphanInterpretJobs(
  admin: Admin,
  stagingChunk: number,
  supabaseUrl: string,
  anonKey: string,
  bearerSecret: string,
  maxChainDepth: number,
): Promise<RecoverSummary> {
  const result: RecoverSummary = {
    finalized: [],
    reposted: [],
    continued: [],
  };

  const { data: processingRows, error: procErr } = await admin
    .from("focus_get_sync_nfe_interpret_jobs")
    .select(
      "id,exec_id,company_id,status,attempts,staging_process_offset,staging_xml_total,onboarding",
    )
    .eq("status", "processing")
    .order("started_at", { ascending: true })
    .limit(3);

  if (procErr) {
    logPhase("recover_processing_list_erro", { error: procErr.message });
  } else if (processingRows?.length) {
    logPhase("recover_processing_inicio", { count: processingRows.length });
    for (const jobRow of processingRows) {
      const row = jobRow as InterpretJobRow;
      logPhase("recover_processing_job", {
        job_id: row.id,
        offset: row.staging_process_offset ?? 0,
      });

      const chunk = await runInterpretStagingChunk(admin, row, stagingChunk);

      if (chunk.kind === "fail") {
        await finalizeJobFailed(admin, row.id, chunk.message);
        continue;
      }

      if (chunk.kind === "empty_done" || chunk.kind === "offset_done") {
        const err = await completeInterpretJobAndEndOnboardingSync(admin, row);
        if (!err) {
          result.finalized.push(row.id);
          logPhase("recover_job_finalizado", {
            job_id: row.id,
            reason:
              chunk.kind === "empty_done"
                ? "staging_vazio"
                : "offset_ja_completo",
          });
        } else {
          await finalizeJobFailed(admin, row.id, err);
        }
        continue;
      }

      const out = await applyChunkOutcome(
        admin,
        row,
        chunk,
        0,
        supabaseUrl,
        anonKey,
        bearerSecret,
        maxChainDepth,
      );
      if (out.done && !out.err) result.finalized.push(row.id);
      else if (out.fell_back_to_pending) result.reposted.push(row.id);
      else result.continued.push(row.id);
    }
    logPhase("recover_processing_fim", { ...result });
  }

  const { data: pendingRows, error: pendErr } = await admin
    .from("focus_get_sync_nfe_interpret_jobs")
    .select("id,exec_id,company_id,onboarding")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);

  if (pendErr) {
    logPhase("recover_pending_list_erro", { error: pendErr.message });
    return result;
  }

  for (const jobRow of pendingRows ?? []) {
    const row = jobRow as Pick<
      InterpretJobRow,
      "id" | "exec_id" | "company_id" | "onboarding"
    >;
    const { count, error: countErr } = await applyStagingXmlContentFilters(
      admin
        .from("focus_get_sync_nfe_staging")
        .select("id", { count: "exact", head: true })
        .eq("exec_id", row.exec_id)
        .eq("company_id", row.company_id),
    );

    if (countErr) {
      logPhase("recover_pending_count_erro", {
        job_id: row.id,
        error: countErr.message,
      });
      continue;
    }
    if ((count ?? 0) > 0) continue;

    logPhase("recover_pending_sem_staging", { job_id: row.id });
    const err = await completeInterpretJobAndEndOnboardingSync(admin, row);
    if (!err) {
      result.finalized.push(row.id);
      logPhase("recover_job_finalizado", {
        job_id: row.id,
        reason: "pending_sem_staging",
      });
    } else {
      await finalizeJobFailed(admin, row.id, err);
    }
  }

  return result;
}

async function applyChunkOutcome(
  admin: Admin,
  row: InterpretJobRow,
  chunk: ChunkOk,
  chainDepth: number,
  supabaseUrl: string,
  anonKey: string,
  bearerSecret: string,
  maxChainDepth: number,
): Promise<{
  done: boolean;
  err?: string;
  fell_back_to_pending?: boolean;
}> {
  const isOnboardingJob = row.onboarding === true;

  logPhase("chunk_outcome_inicio", {
    job_id: row.id,
    has_more: chunk.hasMore,
    chain_depth: chainDepth,
    next_offset: chunk.nextOffset,
    onboarding: isOnboardingJob,
  });

  if (chunk.hasMore) {
    if (chainDepth >= maxChainDepth) {
      logPhase("chain_cap", {
        job_id: row.id,
        chain_depth: chainDepth,
        max_chain_depth: maxChainDepth,
        next_offset: chunk.nextOffset,
      });
      const { error: pendErr } = await admin
        .from("focus_get_sync_nfe_interpret_jobs")
        .update({
          status: "pending",
          staging_process_offset: chunk.nextOffset,
          last_error:
            "chain_depth_cap: retoma no próximo cron (ou aumente FOCUS_GET_SYNC_INTERPRET_MAX_CHAIN_DEPTH).",
        })
        .eq("id", row.id);
      if (pendErr) {
        await finalizeJobFailed(admin, row.id, pendErr.message);
        return { done: false, err: pendErr.message };
      }
      await setOnboardingInterpretNfesSyncProgress(
        admin,
        row.company_id,
        isOnboardingJob,
        chunk.nextOffset,
      );
      logPhase("job_reposto_pending_chain_cap", { job_id: row.id });
      return { done: false, fell_back_to_pending: true };
    }

    const { error: partialErr } = await admin
      .from("focus_get_sync_nfe_interpret_jobs")
      .update({
        status: "processing",
        staging_process_offset: chunk.nextOffset,
        last_error: null,
      })
      .eq("id", row.id);

    if (partialErr) {
      await finalizeJobFailed(admin, row.id, partialErr.message);
      return { done: false, err: partialErr.message };
    }

    await setOnboardingInterpretNfesSyncProgress(
      admin,
      row.company_id,
      isOnboardingJob,
      chunk.nextOffset,
    );

    if (!anonKey.trim()) {
      logPhase("chain_skip_sem_anon", {
        job_id: row.id,
        hint: "defina SUPABASE_ANON_KEY na função",
      });
      const { error: pend2 } = await admin
        .from("focus_get_sync_nfe_interpret_jobs")
        .update({
          status: "pending",
          staging_process_offset: chunk.nextOffset,
          last_error:
            "encadeamento automático omitido (SUPABASE_ANON_KEY ausente); retoma no cron.",
        })
        .eq("id", row.id);
      if (pend2) {
        await finalizeJobFailed(admin, row.id, pend2.message);
        return { done: false, err: pend2.message };
      }
      logPhase("job_reposto_pending_sem_anon", { job_id: row.id });
      return { done: false, fell_back_to_pending: true };
    }

    scheduleContinueChain(
      supabaseUrl,
      anonKey,
      bearerSecret,
      row.id,
      chainDepth + 1,
    );
    logPhase("chunk_parcial_continua", {
      job_id: row.id,
      next_offset: chunk.nextOffset,
      chain_depth_next: chainDepth + 1,
    });
    return { done: false };
  }

  await setOnboardingInterpretNfesSyncProgress(
    admin,
    row.company_id,
    isOnboardingJob,
    chunk.nextOffset,
  );

  const doneErr = await completeInterpretJobAndEndOnboardingSync(admin, row);
  if (doneErr) {
    await finalizeJobFailed(admin, row.id, doneErr);
    logPhase("job_finalizar_erro", { job_id: row.id, error: doneErr });
    return { done: true, err: doneErr };
  }
  logPhase("job_concluido", { job_id: row.id, company_id: row.company_id });
  return { done: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST" }, 405);
  }

  const expected = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
  if (!expected) {
    return json(
      { ok: false, error: "FOCUS_NFE_RECEBIDAS_CRON_SECRET não definido." },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (bearer !== expected) {
    return json({ ok: false, error: "Não autorizado." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(
      { ok: false, error: "SUPABASE_URL ou SERVICE_ROLE_KEY em falta." },
      500,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let activeJobId: string | null = null;
  try {
  const maxJobs = intFromEnv("FOCUS_GET_SYNC_INTERPRET_MAX_JOBS", 2, 1, 50);
  const stagingChunk = intFromEnv(
    "FOCUS_GET_SYNC_INTERPRET_STAGING_CHUNK",
    5,
    1,
    50,
  );
  const maxChainDepth = intFromEnv(
    "FOCUS_GET_SYNC_INTERPRET_MAX_CHAIN_DEPTH",
    120,
    1,
    500,
  );

  const bodyRaw = await req.json().catch(() => ({}));
  const body =
    bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};
  const continueJobId = String(body.continue_job_id ?? "").trim();
  const chainDepthRaw = body.chain_depth;
  const chainDepth = Number.isFinite(Number(chainDepthRaw))
    ? Math.max(0, Math.floor(Number(chainDepthRaw)))
    : 0;

  logPhase("exec_inicio", {
    mode: continueJobId ? "continue" : "claim",
    continue_job_id: continueJobId || null,
    chain_depth: chainDepth,
    max_jobs: maxJobs,
    staging_chunk: stagingChunk,
    max_chain_depth: maxChainDepth,
  });

  /** Modo continuação: mesmo job em `processing`, sem claim. */
  if (continueJobId) {
    if (!UUID_RE.test(continueJobId)) {
      logPhase("continue_rejeitado", { reason: "continue_job_id_invalido" });
      return json({ ok: false, error: "continue_job_id inválido." }, 400);
    }
    if (chainDepth > maxChainDepth) {
      logPhase("continue_rejeitado", {
        reason: "chain_depth_excedido",
        chain_depth: chainDepth,
        max_chain_depth: maxChainDepth,
      });
      return json(
        {
          ok: false,
          error: `chain_depth > max (${maxChainDepth}).`,
          continue_job_id: continueJobId,
        },
        429,
      );
    }

    const { data: jobRow, error: loadErr } = await admin
      .from("focus_get_sync_nfe_interpret_jobs")
      .select(
        "id,exec_id,company_id,status,attempts,staging_process_offset,staging_xml_total,onboarding",
      )
      .eq("id", continueJobId)
      .maybeSingle();

    if (loadErr) {
      logPhase("continue_job_load_erro", {
        job_id: continueJobId,
        error: loadErr.message,
      });
      return json({ ok: false, error: loadErr.message }, 500);
    }
    if (!jobRow) {
      logPhase("continue_skip", {
        job_id: continueJobId,
        reason: "job_nao_encontrado",
      });
      return json({
        ok: true,
        mode: "continue",
        skipped: true,
        reason: "job_nao_encontrado",
      });
    }

    const st = String((jobRow as InterpretJobRow).status ?? "");
    if (st !== "processing") {
      logPhase("continue_skip", {
        job_id: continueJobId,
        reason: `status_${st}`,
      });
      return json({
        ok: true,
        mode: "continue",
        skipped: true,
        reason: `status_${st}`,
        job_id: continueJobId,
      });
    }

    const row = jobRow as InterpretJobRow;
    activeJobId = row.id;
    logPhase("continue_job_carregado", {
      job_id: row.id,
      exec_id: row.exec_id,
      company_id: row.company_id,
      offset: row.staging_process_offset ?? 0,
      staging_xml_total: row.staging_xml_total ?? 0,
      attempts: row.attempts,
      onboarding: row.onboarding === true,
    });
    const chunk = await runInterpretStagingChunk(admin, row, stagingChunk);

    if (chunk.kind === "fail") {
      logPhase("continue_chunk_falhou", {
        job_id: row.id,
        error: chunk.message,
      });
      await finalizeJobFailed(admin, row.id, chunk.message);
      return json(
        { ok: false, mode: "continue", error: chunk.message, job_id: row.id },
        500,
      );
    }

    if (chunk.kind === "empty_done") {
      const err = await completeInterpretJobAndEndOnboardingSync(admin, row);
      if (err) await finalizeJobFailed(admin, row.id, err);
      return json({
        ok: true,
        mode: "continue",
        job_id: row.id,
        outcome: "empty_staging",
      });
    }

    if (chunk.kind === "offset_done") {
      const err = await completeInterpretJobAndEndOnboardingSync(admin, row);
      if (err) await finalizeJobFailed(admin, row.id, err);
      return json({
        ok: true,
        mode: "continue",
        job_id: row.id,
        outcome: "offset_already_complete",
      });
    }

    const out = await applyChunkOutcome(
      admin,
      row,
      chunk,
      chainDepth,
      supabaseUrl,
      anonKey,
      expected,
      maxChainDepth,
    );

    logPhase("exec_fim", {
      mode: "continue",
      job_id: row.id,
      chain_depth: chainDepth,
      staging_rows: chunk.listLen,
      continua: chunk.hasMore,
      job_finished: out.done,
      warn: out.err ?? null,
    });

    return json({
      ok: true,
      mode: "continue",
      job_id: row.id,
      chain_depth: chainDepth,
      staging_rows: chunk.listLen,
      interpretacoes: chunk.interpretacoes.length,
      staging_total: chunk.total,
      chunk_offset_start: chunk.offset,
      continua: chunk.hasMore,
      job_finished: out.done,
      chain_scheduled:
        chunk.hasMore &&
        !out.err &&
        !out.fell_back_to_pending &&
        chainDepth < maxChainDepth,
      warn: out.err,
    });
  }

  const processed: string[] = [];
  const summaries: JobSummary[] = [];
  let recoveredOnEmptyClaim: RecoverSummary | null = null;

  for (let i = 0; i < maxJobs; i++) {
    let row: InterpretJobRow | null = null;
    const { data: rows, error: claimErr } = await admin.rpc(
      "focus_get_sync_nfe_interpret_claim_job",
    );
    if (claimErr) {
      logPhase("claim_erro", { error: claimErr.message, slot: i });
      return json({ ok: false, error: claimErr.message, processed }, 500);
    }
    row = (Array.isArray(rows) ? rows[0] : null) as InterpretJobRow | null;

    if (!row?.id) {
      logPhase("claim_vazio", { slot: i });
      if (i === 0 && !recoveredOnEmptyClaim) {
        recoveredOnEmptyClaim = await recoverOrphanInterpretJobs(
          admin,
          stagingChunk,
          supabaseUrl,
          anonKey,
          expected,
          maxChainDepth,
        );
        if (
          recoveredOnEmptyClaim.finalized.length > 0 ||
          recoveredOnEmptyClaim.reposted.length > 0
        ) {
          const { data: retryRows, error: retryErr } = await admin.rpc(
            "focus_get_sync_nfe_interpret_claim_job",
          );
          if (retryErr) {
            logPhase("claim_retry_erro", { error: retryErr.message });
          } else {
            row = (
              Array.isArray(retryRows) ? retryRows[0] : null
            ) as InterpretJobRow | null;
            if (row?.id) {
              logPhase("claim_retry_ok", { job_id: row.id });
            }
          }
        }
      }
      if (!row?.id) {
        activeJobId = null;
        break;
      }
    }

    activeJobId = row.id;
    logPhase("job_reclamado", {
      job_id: row.id,
      exec_id: row.exec_id,
      company_id: row.company_id,
      attempts: row.attempts,
      offset: row.staging_process_offset ?? 0,
      staging_xml_total: row.staging_xml_total ?? 0,
      onboarding: row.onboarding === true,
      slot: i,
    });
    const chunk = await runInterpretStagingChunk(admin, row, stagingChunk);

    if (chunk.kind === "fail") {
      logPhase("job_falhou", { job_id: row.id, error: chunk.message });
      await finalizeJobFailed(admin, row.id, chunk.message);
      continue;
    }

    if (chunk.kind === "empty_done") {
      const err = await completeInterpretJobAndEndOnboardingSync(admin, row);
      if (!err) {
        processed.push(row.id);
        summaries.push({
          job_id: row.id,
          exec_id: row.exec_id,
          company_id: row.company_id,
          staging_rows: 0,
          interpretacoes: 0,
          staging_total: 0,
          staging_xml_total: row.staging_xml_total ?? 0,
          chunk_offset_start: 0,
          continua: false,
          chain_depth: 0,
        });
      } else {
        await finalizeJobFailed(admin, row.id, err);
      }
      continue;
    }

    if (chunk.kind === "offset_done") {
      const err = await completeInterpretJobAndEndOnboardingSync(admin, row);
      if (!err) {
        processed.push(row.id);
        summaries.push({
          job_id: row.id,
          exec_id: row.exec_id,
          company_id: row.company_id,
          staging_rows: 0,
          interpretacoes: 0,
          staging_total: 0,
          staging_xml_total: row.staging_xml_total ?? 0,
          chunk_offset_start: Math.floor(
            Number(row.staging_process_offset ?? 0) || 0,
          ),
          continua: false,
          chain_depth: 0,
        });
      } else {
        await finalizeJobFailed(admin, row.id, err);
      }
      continue;
    }

    summaries.push({
      job_id: row.id,
      exec_id: row.exec_id,
      company_id: row.company_id,
      staging_rows: chunk.listLen,
      interpretacoes: chunk.interpretacoes.length,
      staging_total: chunk.total,
      staging_xml_total: row.staging_xml_total ?? chunk.total,
      chunk_offset_start: chunk.offset,
      continua: chunk.hasMore,
      chain_depth: 0,
    });

    const out = await applyChunkOutcome(
      admin,
      row,
      chunk,
      0,
      supabaseUrl,
      anonKey,
      expected,
      maxChainDepth,
    );

    if (out.done && !out.err) {
      processed.push(row.id);
    }
  }

  logPhase("exec_fim", {
    mode: "claim",
    jobs_processed: processed.length,
    job_ids: processed,
    summaries_count: summaries.length,
    recovered: recoveredOnEmptyClaim,
  });

  return json({
    ok: true,
    jobs_processed: processed.length,
    job_ids: processed,
    summaries,
    recovered: recoveredOnEmptyClaim,
  });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logPhase("fatal_catch", {
      message: msg,
      active_job_id: activeJobId,
      stack: e instanceof Error ? e.stack : undefined,
    });
    try {
      await requeueProcessingInterpretJob(admin, activeJobId, msg);
    } catch (e2) {
      console.error(LOG, "requeue_recover_falhou", String(e2));
    }
    return json(
      {
        ok: false,
        error: msg,
        job_id_recover: activeJobId,
      },
      500,
    );
  }
});

/**
 * Processa jobs da fila `focus_get_sync_nfe_interpret_jobs` (enfileirados por `focus-get-sync-nfe`
 * quando há linhas em `focus_get_sync_nfe_staging` com XML).
 *
 * **Disparo:** pg_cron → `cron_invoke_focus_get_sync_nfe_interpret()` → `net.http_post` (Vault) com Bearer secret.
 * O SQL **não** agenda HTTP se existir algum job em `processing` (evita corrida com o encadeamento interno).
 *
 * **Timeout / volume:** fatias (`FOCUS_GET_SYNC_INTERPRET_STAGING_CHUNK`, default 5). O job permanece em
 * **`processing`**: após cada fatia atualiza `staging_process_offset` e agenda **nova invocação** desta
 * mesma função com body `{ "continue_job_id": "<job uuid>", "chain_depth": N }` via `fetch` +
 * `EdgeRuntime.waitUntil` (sem esperar o próximo cron). `attempts` só sobe na primeira fatia (RPC claim).
 *
 * **Continuação:** POST com o mesmo Bearer + JSON acima; não usa `claim` — carrega o job por id e segue
 * a partir de `staging_process_offset`. `FOCUS_GET_SYNC_INTERPRET_MAX_CHAIN_DEPTH` limita encadeamentos.
 *
 * Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (para o POST encadeado no gateway),
 * `FOCUS_NFE_RECEBIDAS_CRON_SECRET`.
 * Opcional: `FOCUS_GET_SYNC_INTERPRET_MAX_JOBS` (default 2), `FOCUS_GET_SYNC_INTERPRET_STAGING_CHUNK` (default 5),
 * `FOCUS_GET_SYNC_INTERPRET_MAX_CHAIN_DEPTH` (default 120).
 * Opcional (LLM): `OPENAI_API_KEY`, `OPENAI_PRODUCT_MATCH_MODEL`.
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
  onboarding?: boolean | null;
};

type JobSummary = {
  job_id: string;
  exec_id: string;
  company_id: string;
  staging_rows: number;
  interpretacoes: number;
  staging_total?: number;
  chunk_offset_start?: number;
  continua?: boolean;
  chain_depth?: number;
};

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

/** Atualiza `companies.onboarding_fiscal` durante/ao fim da interpretação (job com `onboarding`). */
async function applyOnboardingInterpretProgress(
  admin: Admin,
  companyId: string,
  isOnboardingJob: boolean,
  rowsProcessedThisChunk: number,
  finalizeInterpretSync: boolean,
): Promise<void> {
  if (!isOnboardingJob) return;
  const add = Math.max(0, Math.floor(rowsProcessedThisChunk));
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
  const next: Record<string, unknown> = { ...prev };
  next.nfes_sync = numOnboardingMetric(prev.nfes_sync) + add;
  if (finalizeInterpretSync) {
    next.sync = false;
    next.interpret_confirmed = false;
  }
  const { error: upErr } = await admin
    .from("companies")
    .update({ onboarding_fiscal: next })
    .eq("id", companyId);
  if (upErr) {
    console.warn(LOG, "onboarding_fiscal_update", companyId, upErr.message);
    return;
  }
  console.log(
    LOG,
    "onboarding_fiscal_interpret",
    JSON.stringify({
      company_id: companyId,
      nfes_sync: next.nfes_sync,
      delta: add,
      finalize: finalizeInterpretSync,
    }),
  );
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

  const { count: totalStaging, error: countErr } = await admin
    .from("focus_get_sync_nfe_staging")
    .select("id", { count: "exact", head: true })
    .eq("exec_id", row.exec_id)
    .eq("company_id", row.company_id);

  if (countErr) {
    return { kind: "fail", message: countErr.message };
  }

  const total = totalStaging ?? 0;

  if (total === 0) {
    return { kind: "empty_done" };
  }

  if (offset >= total) {
    return { kind: "offset_done" };
  }

  const rangeEnd = Math.min(offset + stagingChunk - 1, total - 1);

  const { data: stagingRows, error: stagingErr } = await admin
    .from("focus_get_sync_nfe_staging")
    .select("id,chave_nfe,xml_content")
    .eq("exec_id", row.exec_id)
    .eq("company_id", row.company_id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, rangeEnd);

  if (stagingErr) {
    return { kind: "fail", message: stagingErr.message };
  }

  const list = stagingRows ?? [];
  const interpretacoes: StagingNfeInterpretLog[] = [];

  const { catalog: productCatalog, error: catalogFetchErr } =
    await fetchProductCatalogForStagingInterpret(admin, row.company_id);
  if (catalogFetchErr) {
    console.error(LOG, "produtos_catalogo_fetch", catalogFetchErr);
  }

  for (const st of list) {
    const payload = interpretStagingNfeXmlForLog(
      String(st.chave_nfe ?? ""),
      st.xml_content as string | null | undefined,
      String(st.id ?? ""),
    );
    interpretacoes.push(payload);
    console.log(LOG, "interpretacao_xml", JSON.stringify(payload, null, 2));

    const productIdByLineIndex = new Map<number, string>();
    await Promise.all([
      ensureSupplierForInterpretLog(admin, row.company_id, payload),
      resolveProductsForInterpretLog(
        admin,
        row.company_id,
        payload,
        productCatalog,
        productIdByLineIndex,
      ),
    ]);
    await persistStagingInterpretExpenseAndBoletos(
      admin,
      row.company_id,
      payload,
      productIdByLineIndex,
    );
  }

  const nextOffset = offset + list.length;
  const hasMore = nextOffset < total;

  console.log(
    LOG,
    "job_resumo",
    JSON.stringify(
      {
        job_id: row.id,
        exec_id: row.exec_id,
        company_id: row.company_id,
        staging_chunk_rows: list.length,
        staging_total: total,
        chunk_offset_start: offset,
        chunk_offset_next: nextOffset,
        continua: hasMore,
        interpretacoes: interpretacoes.length,
        chaves: interpretacoes.map((p) => p.chave_nfe),
        parse_ok_count: interpretacoes.filter((p) => p.parse_ok).length,
      },
      null,
      2,
    ),
  );

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
  }).catch((e) => console.warn(LOG, "chain_fetch", String(e)));

  scheduleWaitUntil(p);
  console.log(
    LOG,
    "continuacao_agendada",
    JSON.stringify({ job_id: jobId, chain_depth_next: chainDepth }),
  );
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
    console.warn(
      LOG,
      "requeue_job_falhou",
      JSON.stringify({ job_id: jobId, error: error.message }),
    );
  } else {
    console.warn(
      LOG,
      "job_reposto_pending",
      JSON.stringify({ job_id: jobId }),
    );
  }
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

  if (chunk.hasMore) {
    if (chainDepth >= maxChainDepth) {
      console.warn(
        LOG,
        "chain_cap",
        JSON.stringify({
          job_id: row.id,
          chain_depth: chainDepth,
          next_offset: chunk.nextOffset,
        }),
      );
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
      await applyOnboardingInterpretProgress(
        admin,
        row.company_id,
        isOnboardingJob,
        chunk.listLen,
        false,
      );
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

    await applyOnboardingInterpretProgress(
      admin,
      row.company_id,
      isOnboardingJob,
      chunk.listLen,
      false,
    );

    if (!anonKey.trim()) {
      console.warn(
        LOG,
        "chain_skip_sem_anon",
        JSON.stringify({
          job_id: row.id,
          hint: "defina SUPABASE_ANON_KEY na função",
        }),
      );
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
      return { done: false, fell_back_to_pending: true };
    }

    scheduleContinueChain(
      supabaseUrl,
      anonKey,
      bearerSecret,
      row.id,
      chainDepth + 1,
    );
    return { done: false };
  }

  await applyOnboardingInterpretProgress(
    admin,
    row.company_id,
    isOnboardingJob,
    chunk.listLen,
    true,
  );

  const doneErr = await finalizeJobDone(admin, row.id);
  if (doneErr) {
    await finalizeJobFailed(admin, row.id, doneErr);
    return { done: true, err: doneErr };
  }
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

  /** Modo continuação: mesmo job em `processing`, sem claim. */
  if (continueJobId) {
    if (!UUID_RE.test(continueJobId)) {
      return json({ ok: false, error: "continue_job_id inválido." }, 400);
    }
    if (chainDepth > maxChainDepth) {
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
      .select("id,exec_id,company_id,status,attempts,staging_process_offset,onboarding")
      .eq("id", continueJobId)
      .maybeSingle();

    if (loadErr) {
      return json({ ok: false, error: loadErr.message }, 500);
    }
    if (!jobRow) {
      return json({
        ok: true,
        mode: "continue",
        skipped: true,
        reason: "job_nao_encontrado",
      });
    }

    const st = String((jobRow as InterpretJobRow).status ?? "");
    if (st !== "processing") {
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
    const chunk = await runInterpretStagingChunk(admin, row, stagingChunk);

    if (chunk.kind === "fail") {
      await finalizeJobFailed(admin, row.id, chunk.message);
      return json(
        { ok: false, mode: "continue", error: chunk.message, job_id: row.id },
        500,
      );
    }

    if (chunk.kind === "empty_done") {
      await applyOnboardingInterpretProgress(
        admin,
        row.company_id,
        row.onboarding === true,
        0,
        true,
      );
      const err = await finalizeJobDone(admin, row.id);
      if (err) await finalizeJobFailed(admin, row.id, err);
      return json({
        ok: true,
        mode: "continue",
        job_id: row.id,
        outcome: "empty_staging",
      });
    }

    if (chunk.kind === "offset_done") {
      await applyOnboardingInterpretProgress(
        admin,
        row.company_id,
        row.onboarding === true,
        0,
        true,
      );
      const err = await finalizeJobDone(admin, row.id);
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

  for (let i = 0; i < maxJobs; i++) {
    const { data: rows, error: claimErr } = await admin.rpc(
      "focus_get_sync_nfe_interpret_claim_job",
    );
    if (claimErr) {
      console.error(LOG, "claim", claimErr.message);
      return json({ ok: false, error: claimErr.message, processed }, 500);
    }
    const row = (
      Array.isArray(rows) ? rows[0] : null
    ) as InterpretJobRow | null;
    if (!row?.id) {
      activeJobId = null;
      break;
    }

    activeJobId = row.id;
    const chunk = await runInterpretStagingChunk(admin, row, stagingChunk);

    if (chunk.kind === "fail") {
      await finalizeJobFailed(admin, row.id, chunk.message);
      continue;
    }

    if (chunk.kind === "empty_done") {
      await applyOnboardingInterpretProgress(
        admin,
        row.company_id,
        row.onboarding === true,
        0,
        true,
      );
      const err = await finalizeJobDone(admin, row.id);
      if (!err) {
        processed.push(row.id);
        summaries.push({
          job_id: row.id,
          exec_id: row.exec_id,
          company_id: row.company_id,
          staging_rows: 0,
          interpretacoes: 0,
          staging_total: 0,
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
      await applyOnboardingInterpretProgress(
        admin,
        row.company_id,
        row.onboarding === true,
        0,
        true,
      );
      const err = await finalizeJobDone(admin, row.id);
      if (!err) {
        processed.push(row.id);
        summaries.push({
          job_id: row.id,
          exec_id: row.exec_id,
          company_id: row.company_id,
          staging_rows: 0,
          interpretacoes: 0,
          staging_total: 0,
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

  return json({
    ok: true,
    jobs_processed: processed.length,
    job_ids: processed,
    summaries,
  });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      LOG,
      "fatal_catch",
      JSON.stringify({
        message: msg,
        active_job_id: activeJobId,
        stack: e instanceof Error ? e.stack : undefined,
      }),
    );
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

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  clearOnboardingSefaz,
  cnpj14,
  companyHasOpenJobs,
  enqueueJob,
  enqueuePendingInterpretations,
  enqueueProcessNfe,
  loadCompanyFocus,
  loadSyncState,
  patchOnboardingCaptureCompleted,
  patchOnboardingSefazUnavailable,
} from "./db.ts";
import {
  NFE_XML_BUCKET,
  focusApiBase,
  focusToken,
  onboardingEmptyPollMinutes,
  steadyIntervalMinutes,
} from "./env.ts";
import { FOCUS_AUTO_RATE_LIMITED } from "../focusApiAutoRateLimit.ts";
import {
  fetchNfeRecebidaXml,
  fetchNfesRecebidasPage,
  isNfeCompletaExplicitTrue,
} from "./focusClient.ts";
import { processNfeDocumentById } from "./processNfeDocument.ts";
import type { JobResult, NfeJobRow } from "./types.ts";
import {
  buildNfeCycleFlowDiagnostic,
  type NfeFlowDiagnostic,
} from "../nfeFlowDiagnostic.ts";
import { upsertQueuedNfeConsultaHistory } from "./consultaHistory.ts";

const LOG = "[nfe-pipeline]";

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function optStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function optNum(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function handleSyncCompany(
  admin: SupabaseClient,
  job: NfeJobRow,
): Promise<JobResult> {
  const companyId = job.company_id;
  let state = await loadSyncState(admin, companyId);
  if (!state) {
    const { error } = await admin.rpc("nfe_sync_ensure_company", {
      p_company_id: companyId,
      p_window_start_date: null,
      p_mode: null,
      p_wake: false,
    });
    if (error) return { ok: false, error: error.message, fatal: true };
    state = await loadSyncState(admin, companyId);
  }
  if (!state) return { ok: false, error: "nfe_sync_state ausente", fatal: true };

  const co = await loadCompanyFocus(admin, companyId);
  if (!co || !cnpj14(co.document)) {
    return { ok: false, error: "CNPJ inválido", fatal: true };
  }
  if (!co.focusnfe.id_empresa) {
    return { ok: false, error: "focusnfe.id_empresa ausente", fatal: true };
  }

  const payloadCycle =
    typeof job.payload?.cycle_id === "string"
      ? job.payload.cycle_id.trim()
      : "";
  const cycleId = payloadCycle || crypto.randomUUID();
  const { error: updErr } = await admin
    .from("nfe_sync_state")
    .update({
      status: "running",
      running_since: nowIso(),
      cycle_id: cycleId,
      pending_cursor_versao: state.cursor_versao,
      last_error: null,
      updated_at: nowIso(),
    })
    .eq("company_id", companyId);
  if (updErr) return { ok: false, error: updErr.message };

  // Garante histórico com etapa 1 pendente (cron sem pré-registro no dispatcher).
  try {
    await upsertQueuedNfeConsultaHistory(admin, {
      companyId,
      cycleId,
      onboarding: state.mode === "onboarding",
    });
  } catch (e) {
    console.warn(
      LOG,
      "consulta_history_queued_sync_company",
      companyId,
      e instanceof Error ? e.message : String(e),
    );
  }

  if (co.onboarding_fiscal.sefaz_unavailable === true) {
    await clearOnboardingSefaz(admin, companyId);
  }

  const enq = await enqueueJob(admin, {
    type: "fetch_page",
    companyId,
    payload: { versao: String(state.cursor_versao) },
    priority: state.priority,
  });
  if (enq.error) return { ok: false, error: enq.error };

  console.log(LOG, JSON.stringify({
    fase: "sync_company",
    company_id: companyId,
    cycle_id: cycleId,
    versao: state.cursor_versao,
    mode: state.mode,
  }));

  return { ok: true, detail: { cycle_id: cycleId, versao: state.cursor_versao } };
}

async function handleFetchPage(
  admin: SupabaseClient,
  job: NfeJobRow,
): Promise<JobResult> {
  const token = focusToken();
  if (!token) return { ok: false, error: "FOCUS_NFE_TOKEN ausente", fatal: true };

  const companyId = job.company_id;
  const state = await loadSyncState(admin, companyId);
  if (!state) return { ok: false, error: "nfe_sync_state ausente", fatal: true };

  const co = await loadCompanyFocus(admin, companyId);
  const cnpj = co ? cnpj14(co.document) : null;
  if (!cnpj) return { ok: false, error: "CNPJ inválido", fatal: true };

  const versaoRaw = job.payload?.versao;
  const versao = Number.isFinite(Number(versaoRaw))
    ? Math.max(0, Math.floor(Number(versaoRaw)))
    : Math.max(0, Math.floor(Number(state.cursor_versao) || 0));

  const page = await fetchNfesRecebidasPage({
    apiBase: focusApiBase(),
    token,
    cnpjDigits: cnpj,
    versao,
  });

  if (!page.ok) {
    if (page.error === FOCUS_AUTO_RATE_LIMITED) {
      return {
        ok: false,
        error: page.error,
        retryAfterMs: page.retryAfterMs ?? 15_000,
        softRequeue: true,
      };
    }
    if (state.mode === "onboarding" && (page.network || (page.status != null && page.status >= 500) || page.status === 429)) {
      await patchOnboardingSefazUnavailable(admin, companyId, page.error);
    }
    await recordConsultaHistory(
      admin,
      companyId,
      state.cycle_id,
      state.mode === "onboarding",
      { searchFailed: true, searchError: page.error },
    );
    await admin.from("nfe_sync_state").update({
      status: "backoff",
      last_error: page.error.slice(0, 500),
      next_sync_at: addMinutesIso(30),
      updated_at: nowIso(),
    }).eq("company_id", companyId);
    return {
      ok: false,
      error: page.error,
      retryAfterMs: page.retryAfterMs,
    };
  }

  let listed = 0;
  let ignored = 0;
  const downloadKeys: string[] = [];

  for (const cab of page.items) {
    const chave = String(cab["chave_nfe"] ?? "").replace(/\D/g, "");
    if (chave.length !== 44) continue;

    const situacao = optStr(cab["situacao"]);
    const completa = isNfeCompletaExplicitTrue(cab["nfe_completa"]);
    const elegivel = completa && situacao === "autorizada";
    const focusVersion = optNum(cab["versao"]);

    const row = {
      company_id: companyId,
      chave,
      focus_version: focusVersion,
      situacao,
      nfe_completa: completa,
      emitente_cnpj: optStr(cab["documento_emitente"] ?? cab["cnpj_emitente"])?.replace(/\D/g, "") ?? null,
      numero: optStr(cab["numero"]),
      serie: optStr(cab["serie"]),
      valor_total: optNum(cab["valor_total"] ?? cab["valor"]),
      focus_payload: cab,
      cycle_id: state.cycle_id,
      updated_at: nowIso(),
      fetch_status: elegivel ? "listed" : "ignored",
      process_status: elegivel ? "pending" : "skipped",
      last_error: elegivel ? null : "nao autorizada completa",
    };

    const { data: existing } = await admin
      .from("nfe_documents")
      .select("id, fetch_status, process_status")
      .eq("company_id", companyId)
      .eq("chave", chave)
      .maybeSingle();

    if (existing?.id) {
      const alreadyDownloaded = existing.fetch_status === "downloaded";
      if (alreadyDownloaded) {
        // Mantém downloaded; atualiza metadados + cycle_id (histórico desta consulta).
        await admin.from("nfe_documents").update({
          focus_version: focusVersion,
          situacao,
          nfe_completa: completa,
          focus_payload: cab,
          cycle_id: state.cycle_id,
          updated_at: nowIso(),
        }).eq("id", existing.id);
        if (elegivel) {
          listed += 1;
          if (
            existing.process_status !== "done" &&
            existing.process_status !== "skipped"
          ) {
            await enqueueProcessNfe(admin, {
              companyId,
              documentId: String(existing.id),
              chave,
            });
          }
        } else {
          ignored += 1;
        }
      } else {
        await admin.from("nfe_documents").update(row).eq("id", existing.id);
        if (elegivel) downloadKeys.push(chave);
        else ignored += 1;
      }
    } else {
      const { error: insErr } = await admin.from("nfe_documents").insert(row);
      if (insErr) {
        console.warn(LOG, "nfe_documents_insert", companyId, chave, insErr.message);
        continue;
      }
      if (elegivel) {
        listed += 1;
        downloadKeys.push(chave);
      } else {
        ignored += 1;
      }
    }
  }

  let pendingCursor = state.pending_cursor_versao ?? state.cursor_versao;
  let listDone = false;
  let nextVersao: number | null = null;

  if (page.xTotalCount === 0) {
    listDone = true;
  } else if (page.items.length === 0) {
    if (
      page.xMaxVersion != null &&
      Number.isFinite(page.xMaxVersion) &&
      page.xMaxVersion > versao
    ) {
      nextVersao = page.xMaxVersion;
      pendingCursor = page.xMaxVersion;
    } else {
      listDone = true;
    }
  } else if (page.xMaxVersion == null || !Number.isFinite(page.xMaxVersion)) {
    listDone = true;
    pendingCursor = versao;
  } else if (page.xMaxVersion === versao) {
    listDone = true;
    pendingCursor = versao;
  } else {
    nextVersao = page.xMaxVersion;
    pendingCursor = page.xMaxVersion;
  }

  await admin.from("nfe_sync_state").update({
    pending_cursor_versao: pendingCursor,
    listed_count: (state.listed_count ?? 0) + listed,
    ignored_count: (state.ignored_count ?? 0) + ignored,
    last_error: null,
    updated_at: nowIso(),
  }).eq("company_id", companyId);

  for (const chave of downloadKeys) {
    await enqueueJob(admin, {
      type: "download_xml",
      companyId,
      payload: { chave },
      priority: state.priority,
    });
  }

  if (!listDone && nextVersao != null) {
    await enqueueJob(admin, {
      type: "fetch_page",
      companyId,
      payload: { versao: String(nextVersao) },
      priority: state.priority,
    });
  } else {
    await enqueueJob(admin, {
      type: "close_cycle",
      companyId,
      payload: {},
      priority: state.priority,
    });
  }

  console.log(LOG, JSON.stringify({
    fase: "fetch_page",
    company_id: companyId,
    versao,
    itens: page.items.length,
    downloads: downloadKeys.length,
    ignored,
    list_done: listDone,
    next_versao: nextVersao,
    pending_cursor: pendingCursor,
  }));

  return {
    ok: true,
    detail: {
      versao,
      items: page.items.length,
      downloads: downloadKeys.length,
      list_done: listDone,
    },
  };
}

async function handleDownloadXml(
  admin: SupabaseClient,
  job: NfeJobRow,
): Promise<JobResult> {
  const token = focusToken();
  if (!token) return { ok: false, error: "FOCUS_NFE_TOKEN ausente", fatal: true };

  const companyId = job.company_id;
  const chave = String(job.payload?.chave ?? "").replace(/\D/g, "");
  if (chave.length !== 44) {
    return { ok: false, error: "chave inválida", fatal: true };
  }

  const co = await loadCompanyFocus(admin, companyId);
  const cnpj = co ? cnpj14(co.document) : null;
  if (!cnpj) return { ok: false, error: "CNPJ inválido", fatal: true };

  const { data: doc, error: docErr } = await admin
    .from("nfe_documents")
    .select("id, fetch_status, process_status")
    .eq("company_id", companyId)
    .eq("chave", chave)
    .maybeSingle();
  if (docErr) return { ok: false, error: docErr.message };
  if (!doc) return { ok: false, error: "documento não encontrado", fatal: true };
  if (doc.fetch_status === "downloaded") {
    if (doc.process_status !== "done" && doc.process_status !== "skipped") {
      await enqueueProcessNfe(admin, {
        companyId,
        documentId: String(doc.id),
        chave,
      });
    }
    return { ok: true, detail: { skipped: "already_downloaded" } };
  }

  await admin.from("nfe_documents").update({
    fetch_status: "downloading",
    updated_at: nowIso(),
  }).eq("id", doc.id);

  const got = await fetchNfeRecebidaXml({
    apiBase: focusApiBase(),
    token,
    cnpjDigits: cnpj,
    chave44: chave,
  });

  if (!got.ok) {
    if (got.error === FOCUS_AUTO_RATE_LIMITED) {
      await admin.from("nfe_documents").update({
        fetch_status: "listed",
        last_error: null,
        updated_at: nowIso(),
      }).eq("id", doc.id);
      return {
        ok: false,
        error: got.error,
        retryAfterMs: got.retryAfterMs ?? 15_000,
        softRequeue: true,
      };
    }
    await admin.from("nfe_documents").update({
      fetch_status: "failed",
      attempts: (job.attempts ?? 1),
      last_error: got.error.slice(0, 500),
      updated_at: nowIso(),
    }).eq("id", doc.id);

    const state = await loadSyncState(admin, companyId);
    if (state) {
      await admin.from("nfe_sync_state").update({
        failed_count: (state.failed_count ?? 0) + 1,
        updated_at: nowIso(),
      }).eq("company_id", companyId);
    }

    return {
      ok: false,
      error: got.error,
      retryAfterMs: got.retryAfterMs,
    };
  }

  const path = `${companyId}/${chave}.xml`;
  const bytes = new TextEncoder().encode(got.text);
  const { error: upErr } = await admin.storage
    .from(NFE_XML_BUCKET)
    .upload(path, bytes, {
      contentType: "application/xml",
      upsert: true,
    });
  if (upErr) {
    await admin.from("nfe_documents").update({
      fetch_status: "failed",
      last_error: upErr.message.slice(0, 500),
      updated_at: nowIso(),
    }).eq("id", doc.id);
    return { ok: false, error: `storage: ${upErr.message}`, retryAfterMs: 15_000 };
  }

  await admin.from("nfe_documents").update({
    fetch_status: "downloaded",
    process_status: "pending",
    xml_storage_bucket: NFE_XML_BUCKET,
    xml_storage_path: path,
    last_error: null,
    updated_at: nowIso(),
  }).eq("id", doc.id);

  const state = await loadSyncState(admin, companyId);
  if (state) {
    await admin.from("nfe_sync_state").update({
      downloaded_count: (state.downloaded_count ?? 0) + 1,
      updated_at: nowIso(),
    }).eq("company_id", companyId);
  }

  await enqueueProcessNfe(admin, {
    companyId,
    documentId: String(doc.id),
    chave,
  });

  // Garante close_cycle quando listagem/downloads da rodada estiverem quietos.
  const { count: pendingFetch } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("fetch_status", ["listed", "downloading"]);

  const { count: openDl } = await admin
    .from("nfe_jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("type", "download_xml")
    .in("status", ["queued", "leased"])
    .neq("id", job.id);
  const { count: openFetch } = await admin
    .from("nfe_jobs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("type", "fetch_page")
    .in("status", ["queued", "leased"]);

  if ((pendingFetch ?? 0) === 0 && (openDl ?? 0) === 0 && (openFetch ?? 0) === 0) {
    await enqueueJob(admin, {
      type: "close_cycle",
      companyId,
      payload: {},
      priority: state?.priority ?? 0,
    });
  }

  return { ok: true, detail: { chave, path, process_enqueued: true } };
}

async function handleProcessNfe(
  admin: SupabaseClient,
  job: NfeJobRow,
): Promise<JobResult> {
  const documentId = String(job.payload?.document_id ?? "").trim();
  if (!documentId) {
    // Fallback: resolve por chave
    const chave = String(job.payload?.chave ?? "").replace(/\D/g, "");
    if (chave.length !== 44) {
      return { ok: false, error: "document_id/chave ausente", fatal: true };
    }
    const { data: doc } = await admin
      .from("nfe_documents")
      .select("id")
      .eq("company_id", job.company_id)
      .eq("chave", chave)
      .maybeSingle();
    if (!doc?.id) {
      return { ok: false, error: "documento não encontrado pela chave", fatal: true };
    }
    return processNfeDocumentById(admin, job.company_id, String(doc.id));
  }
  return processNfeDocumentById(admin, job.company_id, documentId);
}

async function recordConsultaHistory(
  admin: SupabaseClient,
  companyId: string,
  cycleId: string | null,
  onboarding: boolean,
  opts?: {
    searchFailed?: boolean;
    searchError?: string | null;
    flowDiagnostic?: NfeFlowDiagnostic | null;
  },
): Promise<void> {
  if (!cycleId) return;

  try {
    const base = () =>
      admin
        .from("nfe_documents")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("cycle_id", cycleId);

    const [
      listedRes,
      ignoredRes,
      downloadedRes,
      downloadFailedRes,
      processedRes,
      processFailedRes,
    ] = await Promise.all([
      base().neq("fetch_status", "ignored"),
      base().eq("fetch_status", "ignored"),
      base()
        .eq("fetch_status", "downloaded")
        .not("xml_storage_path", "is", null),
      base().eq("fetch_status", "failed"),
      base().eq("fetch_status", "downloaded").eq("process_status", "done"),
      base().eq("fetch_status", "downloaded").eq("process_status", "failed"),
    ]);

    for (const res of [
      listedRes,
      ignoredRes,
      downloadedRes,
      downloadFailedRes,
      processedRes,
      processFailedRes,
    ]) {
      if (res.error) {
        console.warn(LOG, "consulta_history_count", companyId, res.error.message);
      }
    }

    const listed = listedRes.count ?? 0;
    const ignored = ignoredRes.count ?? 0;
    const downloaded = downloadedRes.count ?? 0;
    const downloadFailed = downloadFailedRes.count ?? 0;
    const processed = processedRes.count ?? 0;
    const processFailed = processFailedRes.count ?? 0;

    const flowDiagnostic =
      opts?.flowDiagnostic ??
      buildNfeCycleFlowDiagnostic({
        // Só marca falha de busca se o ciclo não listou nada (falha mid-paginação usa agregados).
        searchFailed:
          Boolean(opts?.searchFailed) && listed === 0 && ignored === 0,
        searchError: opts?.searchError,
        listed,
        downloaded,
        downloadFailed,
        processed,
        processFailed,
        ignored,
      });

    // Sem consulta_at: preserva o horário do enqueue; DEFAULT now() só em insert novo.
    const { error: insErr } = await admin.from("nfe_consulta_history").upsert(
      {
        company_id: companyId,
        exec_id: cycleId,
        nfes_encontradas: listed,
        staging_xml_total: downloaded,
        onboarding,
        summary: flowDiagnostic.summary,
        flow_diagnostic: flowDiagnostic,
        listed_count: listed,
        downloaded_count: downloaded,
        processed_count: processed,
        failed_count: processFailed + downloadFailed,
        ignored_count: ignored,
      },
      { onConflict: "company_id,exec_id" },
    );

    if (insErr) {
      console.warn(LOG, "consulta_history_insert", companyId, insErr.message);
      return;
    }

    console.log(LOG, JSON.stringify({
      fase: "consulta_history",
      company_id: companyId,
      exec_id: cycleId,
      nfes_encontradas: listed,
      staging_xml_total: downloaded,
      processed,
      process_failed: processFailed,
      download_failed: downloadFailed,
      ignored,
      onboarding,
      flow_blocked_at: flowDiagnostic.blocked_at,
    }));
  } catch (e) {
    console.warn(
      LOG,
      "consulta_history_exception",
      companyId,
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function handleCloseCycle(
  admin: SupabaseClient,
  job: NfeJobRow,
): Promise<JobResult> {
  const companyId = job.company_id;
  const state = await loadSyncState(admin, companyId);
  if (!state) return { ok: false, error: "nfe_sync_state ausente", fatal: true };

  const backfilled = await enqueuePendingInterpretations(admin, companyId);
  if (backfilled > 0) {
    return {
      ok: false,
      softRequeue: true,
      error: `enfileirou ${backfilled} interpretação(ões) pendente(s)`,
      retryAfterMs: 5_000,
    };
  }

  // Ainda há trabalho aberto? Reagenda close.
  const { count: pendingFetch } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("fetch_status", ["listed", "downloading"]);

  const { count: pendingProcess } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("process_status", ["pending", "processing"]);

  const hasOpen = await companyHasOpenJobs(admin, companyId, job.id);
  if ((pendingFetch ?? 0) > 0 || (pendingProcess ?? 0) > 0 || hasOpen) {
    return {
      ok: false,
      softRequeue: true,
      error:
        `aguardando pendencias (fetch=${pendingFetch ?? 0}, process=${pendingProcess ?? 0}, open_jobs)`,
      retryAfterMs: 60_000,
    };
  }

  const { count: downloaded } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("fetch_status", "downloaded");

  const { count: processed } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("fetch_status", "downloaded")
    .eq("process_status", "done");

  const { count: processFailed } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("fetch_status", "downloaded")
    .eq("process_status", "failed");

  const { count: ignored } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("fetch_status", "ignored");

  const { count: failed } = await admin
    .from("nfe_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("fetch_status", "failed");

  const downloadedN = downloaded ?? 0;
  const processedN = processed ?? 0;
  const processFailedN = processFailed ?? 0;
  const ignoredN = ignored ?? 0;
  const failedN = failed ?? 0;
  const cursor =
    state.pending_cursor_versao != null
      ? Number(state.pending_cursor_versao)
      : Number(state.cursor_versao);

  let nextMode = state.mode;
  let nextPriority = state.priority;
  let nextSyncAt = addMinutesIso(steadyIntervalMinutes());
  let emptyPoll = state.empty_poll_count ?? 0;
  let captureOk = false;
  let completedOk = false;

  if (processFailedN > 0) {
    // Backlog de interpretação com falha permanente — não fecha onboarding.
    await recordConsultaHistory(
      admin,
      companyId,
      state.cycle_id,
      state.mode === "onboarding",
    );
    await admin.from("nfe_sync_state").update({
      status: "needs_attention",
      last_error: `${processFailedN} xml(s) falharam na interpretação`,
      next_sync_at: addMinutesIso(steadyIntervalMinutes()),
      running_since: null,
      cycle_id: null,
      pending_cursor_versao: null,
      cursor_versao: Number.isFinite(cursor)
        ? Math.max(0, Math.floor(cursor))
        : state.cursor_versao,
      downloaded_count: downloadedN,
      ignored_count: ignoredN,
      failed_count: failedN + processFailedN,
      updated_at: nowIso(),
    }).eq("company_id", companyId);
    return {
      ok: true,
      detail: {
        needs_attention: true,
        process_failed: processFailedN,
        processed: processedN,
      },
    };
  }

  if (state.mode === "onboarding") {
    if (downloadedN >= 1 && processedN >= downloadedN) {
      captureOk = true;
      completedOk = true;
      nextMode = "steady";
      nextPriority = 0;
      nextSyncAt = addMinutesIso(steadyIntervalMinutes());
      const patch = await patchOnboardingCaptureCompleted(
        admin,
        companyId,
        {
          max_nfes_sync: downloadedN,
          nfes_sync: processedN,
          nfes_ignored: ignoredN,
        },
        { markCompleted: true },
      );
      if (patch.error) {
        return { ok: false, error: patch.error, retryAfterMs: 15_000 };
      }
    } else if (downloadedN >= 1 && processedN < downloadedN) {
      return {
        ok: false,
        softRequeue: true,
        error: `aguardando process_nfe (${processedN}/${downloadedN})`,
        retryAfterMs: 60_000,
      };
    } else {
      emptyPoll += 1;
      nextSyncAt = addMinutesIso(onboardingEmptyPollMinutes());
      nextPriority = 100;
    }
  }

  const { error: updErr } = await admin.from("nfe_sync_state").update({
    mode: nextMode,
    status: failedN > 0 && downloadedN === 0 ? "needs_attention" : "idle",
    priority: nextPriority,
    cursor_versao: Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : state.cursor_versao,
    pending_cursor_versao: null,
    cycle_id: null,
    running_since: null,
    last_success_at: nowIso(),
    next_sync_at: nextSyncAt,
    empty_poll_count: emptyPoll,
    downloaded_count: downloadedN,
    ignored_count: ignoredN,
    failed_count: failedN,
    last_error: failedN > 0 ? `${failedN} xml(s) falharam` : null,
    updated_at: nowIso(),
  }).eq("company_id", companyId);

  if (updErr) return { ok: false, error: updErr.message };

  await recordConsultaHistory(
    admin,
    companyId,
    state.cycle_id,
    state.mode === "onboarding",
  );

  // Espelha cursor no JSON legado focusnfe (compat UI).
  const co = await loadCompanyFocus(admin, companyId);
  if (co) {
    await admin.from("companies").update({
      focusnfe: {
        ...co.focusnfe,
        nfes_recebidas_ultima_versao: Number.isFinite(cursor)
          ? Math.max(0, Math.floor(cursor))
          : co.focusnfe.nfes_recebidas_ultima_versao,
        nfes_recebidas_ultima_sync_at: nowIso(),
      },
      updated_at: nowIso(),
    }).eq("id", companyId);
  }

  console.log(LOG, JSON.stringify({
    fase: "close_cycle",
    company_id: companyId,
    downloaded: downloadedN,
    processed: processedN,
    ignored: ignoredN,
    failed: failedN,
    capture_completed: captureOk,
    completed: completedOk,
    mode: nextMode,
    next_sync_at: nextSyncAt,
    cursor,
  }));

  return {
    ok: true,
    detail: {
      downloaded: downloadedN,
      processed: processedN,
      capture_completed: captureOk,
      completed: completedOk,
      mode: nextMode,
    },
  };
}

export async function runNfeJob(
  admin: SupabaseClient,
  job: NfeJobRow,
): Promise<JobResult> {
  switch (job.type) {
    case "sync_company":
      return handleSyncCompany(admin, job);
    case "fetch_page":
      return handleFetchPage(admin, job);
    case "download_xml":
      return handleDownloadXml(admin, job);
    case "process_nfe":
      return handleProcessNfe(admin, job);
    case "close_cycle":
      return handleCloseCycle(admin, job);
    default:
      return { ok: false, error: `tipo desconhecido: ${job.type}`, fatal: true };
  }
}

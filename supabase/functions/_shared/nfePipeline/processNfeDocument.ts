/**
 * Fase 2: interpreta 1 XML de nfe_documents → fornecedor, produtos (certeza por fornecedor),
 * despesa, boletos e estoque.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { interpretStagingNfeXmlForLog } from "../stagingNfeInterpretLog.ts";
import {
  ensureSupplierForInterpretLog,
  fetchProductCatalogForStagingInterpret,
  persistStagingInterpretExpenseAndBoletos,
  resolveProductsForInterpretLog,
} from "../stagingNfeInterpretPostProcess.ts";
import { enqueueJob, loadSyncState, refreshOnboardingFiscalProgress } from "./db.ts";
import { recordConsultaHistory } from "./consultaHistory.ts";
import { NFE_XML_BUCKET } from "./env.ts";
import type { JobResult } from "./types.ts";

const LOG = "[nfe-pipeline:process]";

export async function processNfeDocumentById(
  admin: SupabaseClient,
  companyId: string,
  documentId: string,
): Promise<JobResult> {
  const { data: doc, error: docErr } = await admin
    .from("nfe_documents")
    .select(
      "id, company_id, chave, cycle_id, fetch_status, process_status, xml_storage_bucket, xml_storage_path",
    )
    .eq("id", documentId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (docErr) return { ok: false, error: docErr.message, retryAfterMs: 15_000 };
  if (!doc) return { ok: false, error: "nfe_document não encontrado", fatal: true };

  const cycleId =
    typeof doc.cycle_id === "string" ? doc.cycle_id.trim() : "";
  const refreshHistory = async (onboarding: boolean) => {
    if (!cycleId) return;
    await recordConsultaHistory(admin, companyId, cycleId, onboarding);
  };

  if (doc.process_status === "done") {
    const syncState = await loadSyncState(admin, companyId);
    await refreshHistory(syncState?.mode === "onboarding");
    return { ok: true, detail: { skipped: "already_done" } };
  }
  if (doc.fetch_status !== "downloaded") {
    return {
      ok: false,
      error: `fetch_status=${doc.fetch_status}, esperado downloaded`,
      retryAfterMs: 60_000,
      softRequeue: true,
    };
  }

  const bucket = String(doc.xml_storage_bucket || NFE_XML_BUCKET);
  const path = String(doc.xml_storage_path || "");
  if (!path) {
    return { ok: false, error: "xml_storage_path ausente", fatal: true };
  }

  await admin.from("nfe_documents").update({
    process_status: "processing",
    updated_at: new Date().toISOString(),
  }).eq("id", documentId);

  const { data: file, error: dlErr } = await admin.storage
    .from(bucket)
    .download(path);
  if (dlErr || !file) {
    await markProcessFailed(admin, documentId, dlErr?.message ?? "download storage falhou");
    const syncState = await loadSyncState(admin, companyId);
    await refreshHistory(syncState?.mode === "onboarding");
    return {
      ok: false,
      error: dlErr?.message ?? "download storage falhou",
      retryAfterMs: 30_000,
    };
  }

  const xmlText = await file.text();
  const chave = String(doc.chave ?? "").replace(/\D/g, "");

  const interpret = interpretStagingNfeXmlForLog(chave, xmlText);
  if (!interpret.parse_ok) {
    await markProcessFailed(
      admin,
      documentId,
      interpret.parse_erro ?? "parse_xml_falhou",
    );
    const syncState = await loadSyncState(admin, companyId);
    await refreshHistory(syncState?.mode === "onboarding");
    return {
      ok: false,
      error: interpret.parse_erro ?? "parse_xml_falhou",
      fatal: true,
    };
  }

  try {
    const syncState = await loadSyncState(admin, companyId);
    const isOnboarding = syncState?.mode === "onboarding";
    const finalizeRecebimentoAndStock = isOnboarding;

    await ensureSupplierForInterpretLog(admin, companyId, interpret);

    const { catalog, error: catErr } = await fetchProductCatalogForStagingInterpret(
      admin,
      companyId,
    );
    if (catErr) {
      await markProcessFailed(admin, documentId, catErr);
      await refreshHistory(isOnboarding);
      return { ok: false, error: catErr, retryAfterMs: 30_000 };
    }

    const productIdByLineIndex = new Map<number, string>();
    const chunkDedupe = new Map<string, string>();
    const stockApplied = new Set<number>();

    await resolveProductsForInterpretLog(
      admin,
      companyId,
      interpret,
      catalog,
      productIdByLineIndex,
      chunkDedupe,
      undefined,
      stockApplied,
      "supplier_certainty",
      finalizeRecebimentoAndStock,
    );

    await persistStagingInterpretExpenseAndBoletos(
      admin,
      companyId,
      interpret,
      productIdByLineIndex,
      undefined,
      stockApplied,
      { finalizeRecebimentoAndStock },
    );

    await admin.from("nfe_documents").update({
      process_status: "done",
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);

    const progress = isOnboarding
      ? await refreshOnboardingFiscalProgress(admin, companyId)
      : { listExhausted: true };

    const { count: stillPending } = await admin
      .from("nfe_documents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("process_status", ["pending", "processing"]);
    if ((stillPending ?? 0) === 0 && progress.listExhausted) {
      await enqueueJob(admin, {
        type: "close_cycle",
        companyId,
        payload: { list_done: true },
        priority: 0,
      });
    }

    await refreshHistory(isOnboarding);

    console.log(LOG, JSON.stringify({
      fase: "process_nfe_ok",
      company_id: companyId,
      document_id: documentId,
      chave,
      mode: syncState?.mode ?? "unknown",
      finalize_recebimento: finalizeRecebimentoAndStock,
      linhas: interpret.produtos.length,
      produtos_resolvidos: productIdByLineIndex.size,
      stock_no_create: stockApplied.size,
    }));

    return {
      ok: true,
      detail: {
        chave,
        lines: interpret.produtos.length,
        resolved: productIdByLineIndex.size,
        finalize_recebimento: finalizeRecebimentoAndStock,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markProcessFailed(admin, documentId, msg);
    const syncState = await loadSyncState(admin, companyId);
    await refreshHistory(syncState?.mode === "onboarding");
    return { ok: false, error: msg, retryAfterMs: 30_000 };
  }
}

async function markProcessFailed(
  admin: SupabaseClient,
  documentId: string,
  error: string,
): Promise<void> {
  const { data } = await admin
    .from("nfe_documents")
    .select("attempts")
    .eq("id", documentId)
    .maybeSingle();
  const next = Math.max(0, Number(data?.attempts ?? 0)) + 1;
  await admin.from("nfe_documents").update({
    attempts: next,
    process_status: "failed",
    last_error: error.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", documentId);
}

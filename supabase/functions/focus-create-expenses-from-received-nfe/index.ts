/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { strFromU8 } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { stripPackSizeFromLabel } from "../_shared/productImport/packSizeFromLabel.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import { insertBoletosFromNfeDupXml } from "../_shared/insertBoletosFromNfeDup.ts";
import {
  invokeProcessExpenseXmlProducts,
  scheduleWaitUntilEdge,
} from "../_shared/nfeExpenseProducts/invokeProcessExpenseXmlProducts.ts";
import {
  deleteImportJobItemsIfPurging,
  importJobFileXmlClearPatch,
} from "../_shared/importJobFilePurge.ts";
import { parseLooseNumber, resolveDocumentTotal, shouldCreateExpense } from "./core.ts";

const LOG = "[focus-create-expenses-from-received-nfe]";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function intFromEnv(name: string, defaultVal: number, min: number, max: number): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const MAX_XML_PER_RUN = intFromEnv("FOCUS_CREATE_EXPENSES_MAX_XML_PER_RUN", 10, 1, 120);
const MAX_CHAIN_DEPTH_ENV = intFromEnv("FOCUS_CREATE_EXPENSES_MAX_CHAIN_DEPTH", 10, 0, 50);
const SOFT_BUDGET_MS_ENV = intFromEnv("FOCUS_CREATE_EXPENSES_SOFT_BUDGET_MS", 45000, 5000, 120000);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function slog(
  fase: string,
  companyId: string | null,
  mensagem: string,
  extras?: Record<string, unknown>,
): void {
  console.log(LOG, JSON.stringify({ fase, company_id: companyId ?? null, mensagem, ...(extras ?? {}) }));
}

async function appendTimeline(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
  stage: "UPLOAD" | "DONE" | "ERROR" | "UPSERT_EXPENSE",
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await supabase.from("import_job_timeline").insert({
    batch_id: batchId,
    stage,
    message,
    meta,
  });
}


function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function digitsOnly(v: string | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length ? d : null;
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

async function findDuplicateActiveExpense(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  supplierId: string | null,
  supplierDocumentDigits: string | null,
  invoiceNumber: string | null,
  invoiceSeries: string | null,
): Promise<string | null> {
  const inv = String(invoiceNumber ?? "").trim();
  if (!inv) return null;
  const ser = String(invoiceSeries ?? "").trim();

  if (supplierId) {
    const { data } = await supabase
      .from("expenses")
      .select("id")
      .eq("company_id", companyId)
      .eq("supplier_id", supplierId)
      .eq("invoice_number", inv)
      .eq("invoice_series", ser || "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const doc = digitsOnly(supplierDocumentDigits);
  if (doc) {
    const { data } = await supabase
      .from("expenses")
      .select("id")
      .eq("company_id", companyId)
      .eq("supplier_document", doc)
      .eq("invoice_number", inv)
      .eq("invoice_series", ser || "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !anonKey || !serviceRole) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isServiceCaller = bearer === serviceRole;
  const supabase = isServiceCaller
    ? createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    : createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const companyId = String((body as { company_id?: string }).company_id ?? "").trim();
  const requestedBatchId = String((body as { batch_id?: string }).batch_id ?? "").trim() || null;
  const chainDepth = Math.max(0, Math.floor(Number((body as { chain_depth?: number }).chain_depth ?? 0)));
  const maxChainDepth = Math.max(
    0,
    Math.min(
      50,
      Math.floor(Number((body as { max_chain_depth?: number }).max_chain_depth ?? MAX_CHAIN_DEPTH_ENV)),
    ),
  );
  const maxPerRun = Math.max(
    1,
    Math.min(
      120,
      Math.floor(Number((body as { max_xml_per_run?: number }).max_xml_per_run ?? MAX_XML_PER_RUN)),
    ),
  );
  const softBudgetMs = Math.max(
    5000,
    Math.min(
      120000,
      Math.floor(Number((body as { soft_budget_ms?: number }).soft_budget_ms ?? SOFT_BUDGET_MS_ENV)),
    ),
  );
  const execId = crypto.randomUUID();
  const t0 = performance.now();

  if (!companyId) return json({ ok: false, error: "company_id obrigatório." }, 400);

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

  const leaseUntil = new Date(Date.now() + 90_000).toISOString();
  const { data: coRow } = await supabase
    .from("companies")
    .select("focusnfe")
    .eq("id", companyId)
    .maybeSingle();
  const focusnfe = ((coRow?.focusnfe ?? {}) as Record<string, unknown>);
  const leaseCurrent = String(focusnfe.nfe_expense_create_lease_until ?? "");
  if (leaseCurrent) {
    const tLease = Date.parse(leaseCurrent);
    if (Number.isFinite(tLease) && tLease > Date.now() + 3_000) {
      return json({
        ok: true,
        exec_id: execId,
        company_id: companyId,
        skipped: "lease ativo (outra execução em progresso)",
        lease_until: leaseCurrent,
      });
    }
  }
  await supabase
    .from("companies")
    .update({
      focusnfe: { ...focusnfe, nfe_expense_create_lease_until: leaseUntil },
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);

  const summary = {
    processed: 0,
    created: 0,
    skipped_existing_active: 0,
    suppliers_created: 0,
    failed: 0,
  };
  const items: Array<Record<string, unknown>> = [];
  let selectedBatchId: string | null = requestedBatchId;

  try {
    if (!selectedBatchId) {
      const { data: latestBatch } = await supabase
        .from("import_job_batches")
        .select("id, source_file_name, status")
        .eq("company_id", companyId)
        .ilike("source_file_name", "focus_nfes_recebidas_%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      selectedBatchId = latestBatch?.id ? String(latestBatch.id) : null;
    }

    if (!selectedBatchId) {
      return json({
        ok: true,
        exec_id: execId,
        company_id: companyId,
        summary,
        detail: [],
        remaining_xml: 0,
        chain_scheduled: false,
        message: "Nenhum lote Focus encontrado para processar.",
      });
    }

    slog("execucao_inicio", companyId, "início criação de despesas", {
      exec_id: execId,
      batch_id: selectedBatchId,
      max_per_run: maxPerRun,
      chain_depth: chainDepth,
      max_chain_depth: maxChainDepth,
      soft_budget_ms: softBudgetMs,
    });
    await appendTimeline(
      supabase,
      selectedBatchId,
      "UPLOAD",
      "Início da criação de despesas por NF-e Focus.",
      {
        source: "focus-create-expenses-from-received-nfe",
        exec_id: execId,
        max_per_run: maxPerRun,
        chain_depth: chainDepth,
      },
    );

    const { data: files } = await supabase
      .from("import_job_files")
      .select("id, file_name, xml_hash, xml_content_base64, status")
      .eq("batch_id", selectedBatchId)
      .in("status", ["QUEUED", "PROCESSING"])
      .order("created_at", { ascending: true })
      .limit(maxPerRun);

    const fileRows = (files ?? []) as Array<{
      id: string;
      file_name: string;
      xml_hash: string;
      xml_content_base64: string | null;
      status?: string;
    }>;

    for (const file of fileRows) {
      if (performance.now() - t0 > softBudgetMs) break;
      summary.processed += 1;
      await supabase
        .from("import_job_files")
        .update({ status: "PROCESSING", updated_at: new Date().toISOString() })
        .eq("id", file.id);

      try {
        if (!file.xml_content_base64 || !String(file.xml_content_base64).trim()) {
          throw new Error("XML base64 ausente.");
        }
        const xmlText = strFromU8(decodeBase64ToBytes(file.xml_content_base64));
        const parsed = parseNfeXmlToExtracted(xmlText);
        if (!parsed) throw new Error("XML inválido para NF-e autorizada.");
        const data = enrichExtractedWithTaxId(parsed);

        const nfeAccessKey = String(data.nfeAccessKey ?? "").trim() || null;
        const invoiceNumber = String(data.invoiceNumber ?? "").trim() || null;
        const invoiceSeries = String(data.invoiceSeries ?? "").trim() || null;
        const supplierDocument = digitsOnly(data.supplierDocument);
        const emissionDate = String(data.emissionDate ?? "").slice(0, 10) || null;

        const sr = await ensureSupplierFromExtracted(
          supabase,
          companyId,
          data,
          "Cadastrado automaticamente — XML Focus NF-e",
        );
        const supplierId = sr.supplierId;
        if (sr.createdNew && supplierId) summary.suppliers_created += 1;

        const duplicateExpenseId = await findDuplicateActiveExpense(
          supabase,
          companyId,
          supplierId,
          supplierDocument,
          invoiceNumber,
          invoiceSeries,
        );
        if (!shouldCreateExpense(!!duplicateExpenseId)) {
          summary.skipped_existing_active += 1;
          const { error: purgeSkipErr } = await deleteImportJobItemsIfPurging(supabase, file.id);
          if (purgeSkipErr) {
            console.warn(LOG, JSON.stringify({ fase: "purge_import_job_items_erro", file_id: file.id, erro: purgeSkipErr }));
          }
          await supabase
            .from("import_job_files")
            .update({
              status: "COMPLETED",
              last_error: null,
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...importJobFileXmlClearPatch(),
            })
            .eq("id", file.id);
          await supabase.from("company_nfe_import_logs").upsert({
            company_id: companyId,
            file_name: file.file_name,
            xml_hash: file.xml_hash,
            nfe_access_key: nfeAccessKey,
            invoice_number: invoiceNumber,
            invoice_series: invoiceSeries,
            supplier_document: supplierDocument,
            emission_date: emissionDate,
            status: "duplicate",
            error_message: "Despesa ativa já existe para fornecedor + número/série.",
            expense_id: duplicateExpenseId,
            payload: data,
            import_job_batch_id: selectedBatchId,
            import_job_file_id: file.id,
          }, { onConflict: "company_id,xml_hash" });
          items.push({
            file_id: file.id,
            file_name: file.file_name,
            result: "skipped_existing_active",
            expense_id: duplicateExpenseId,
            invoice_number: invoiceNumber,
            invoice_series: invoiceSeries,
          });
          continue;
        }

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
            };
          })
          : [];

        const summedLines = sumExpenseLineTotals(safeItems);
        const totalDecision = resolveDocumentTotal({
          extractedTotal: data.totalAmount,
          xmlText,
          summedLines,
        });
        const documentTotalResolved = totalDecision.total;
        const totalSource = totalDecision.source;
        if (!documentTotalResolved || documentTotalResolved <= 0) {
          throw new Error("TOTAL_NOT_FOUND_OR_ZERO");
        }

        const referenceDateIso =
          emissionDate && /^\d{4}-\d{2}-\d{2}$/.test(emissionDate)
            ? emissionDate
            : new Date().toISOString().slice(0, 10);
        const { data: expense, error: expErr } = await supabase
          .from("expenses")
          .insert({
            company_id: companyId,
            created_by: null,
            type: "nota_fiscal",
            expense_source: "manual",
            invoice_number: invoiceNumber,
            invoice_series: invoiceSeries,
            supplier_id: supplierId,
            supplier_document: data.supplierDocument,
            supplier_name: data.supplierName,
            status: "pending",
            notes: nfeAccessKey ? `Importado Focus NF-e — chave ${nfeAccessKey}` : "Importado Focus NF-e",
            document_total: documentTotalResolved,
            reference_date: referenceDateIso,
          })
          .select("id")
          .single();
        if (expErr || !expense?.id) throw new Error(expErr?.message ?? "Falha ao criar despesa.");
        const expenseId = String(expense.id);

        const expenseItemRows = safeItems.map((it) => {
          const q = Math.max(0.0001, Number(it.quantity ?? 0));
          const uv = Number(it.unitValue ?? 0);
          const invUnit = String(it.unitCommercial ?? "").trim() || null;
          const stockQty = Number(it.quantity ?? q);
          const rawPn = String(it.productName ?? "Item");
          const displayName =
            stripPackSizeFromLabel(rawPn).trim() || rawPn;
          return {
            expense_id: expenseId,
            product_name: displayName,
            quantity: q,
            unit_value: uv,
            product_id: null,
            invoice_unit: invUnit,
            stock_quantity: Number.isFinite(stockQty) ? stockQty : q,
            stock_added: false,
            import_nature: "REVISAO_MANUAL",
            import_engine_suggestion: "REVIEW_REQUIRED",
            import_confidence_0_1: 0.8,
            import_score_reasons_json: {
              import_v2: {
                mode: "REVIEW_REQUIRED",
                note: "Criação de despesa a partir de XML Focus sem interpretação de produto.",
              },
            },
            import_stock_resolution: null,
            resolved_entry_breakdown_recipe_id: null,
            import_pending_resolution: false,
            import_applied_rule_id: null,
          };
        });
        const { error: bulkItemErr } = await supabase.from("expense_items").insert(expenseItemRows);
        if (bulkItemErr) throw new Error(bulkItemErr.message);

        const { error: recErr } = await supabase.from("recebimentos").insert({ expense_id: expenseId });
        if (recErr) throw new Error(recErr.message);

        const invRefParts = [invoiceSeries, invoiceNumber].filter((x) => !!String(x ?? "").trim());
        const invoiceRefLabel = invRefParts.length > 0 ? invRefParts.join("/") : (nfeAccessKey ?? "").slice(-12);
        await insertBoletosFromNfeDupXml(supabase, companyId, expenseId, xmlText, invoiceRefLabel || "NF-e");

        await supabase.from("company_nfe_import_logs").upsert({
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
          import_job_batch_id: selectedBatchId,
          import_job_file_id: file.id,
        }, { onConflict: "company_id,xml_hash" });

        if (expenseId && serviceRole && supabaseUrl) {
          scheduleWaitUntilEdge(
            invokeProcessExpenseXmlProducts({
              supabaseUrl,
              serviceRole,
              anonKey,
              companyId,
              expenseId,
              importJobFileId: file.id,
              execId,
              logPrefix: LOG,
            }),
          );
        }

        const { error: purgeItemsErr } = await deleteImportJobItemsIfPurging(supabase, file.id);
        if (purgeItemsErr) {
          console.warn(LOG, JSON.stringify({ fase: "purge_import_job_items_erro", file_id: file.id, erro: purgeItemsErr }));
        }
        await supabase
          .from("import_job_files")
          .update({
            status: "COMPLETED",
            last_error: null,
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...importJobFileXmlClearPatch(),
          })
          .eq("id", file.id);
        summary.created += 1;
        await appendTimeline(
          supabase,
          selectedBatchId,
          "UPSERT_EXPENSE",
          `Despesa criada para ${file.file_name}.`,
          {
            source: "focus-create-expenses-from-received-nfe",
            exec_id: execId,
            file_id: file.id,
            expense_id: expenseId,
            document_total: documentTotalResolved,
            document_total_source: totalSource,
          },
        );
        items.push({
          file_id: file.id,
          file_name: file.file_name,
          result: "created",
          expense_id: expenseId,
          document_total: documentTotalResolved,
          document_total_source: totalSource,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao criar despesa";
        summary.failed += 1;
        await supabase
          .from("import_job_files")
          .update({
            status: "FAILED",
            retry_count: 1,
            last_error: msg,
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", file.id);
        items.push({
          file_id: file.id,
          file_name: file.file_name,
          result: "failed",
          error: msg,
        });
      }
    }

    const { count: remainingXml } = await supabase
      .from("import_job_files")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", selectedBatchId)
      .in("status", ["QUEUED", "PROCESSING"]);

    const shouldChain = (remainingXml ?? 0) > 0 && chainDepth < maxChainDepth;
    if (shouldChain) {
      const chainPromise = fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/focus-create-expenses-from-received-nfe`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: companyId,
          batch_id: selectedBatchId,
          chain_depth: chainDepth + 1,
          max_chain_depth: maxChainDepth,
          max_xml_per_run: maxPerRun,
          soft_budget_ms: softBudgetMs,
        }),
      }).catch(() => undefined);
      try {
        // @ts-ignore Edge runtime helper
        if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
          // @ts-ignore
          EdgeRuntime.waitUntil(chainPromise);
        }
      } catch {
        // no-op
      }
    }

    await supabase
      .from("companies")
      .update({
        focusnfe: { ...focusnfe, nfe_expense_create_lease_until: null },
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId);

    slog("execucao_fim", companyId, "fim criação de despesas", {
      exec_id: execId,
      batch_id: selectedBatchId,
      ...summary,
      remaining_xml: remainingXml ?? 0,
      chain_scheduled: shouldChain,
    });
    await appendTimeline(
      supabase,
      selectedBatchId,
      "DONE",
      "Resumo da criação de despesas por NF-e Focus.",
      {
        source: "focus-create-expenses-from-received-nfe",
        exec_id: execId,
        summary,
        remaining_xml: remainingXml ?? 0,
        chain_scheduled: shouldChain,
      },
    );

    return json({
      ok: true,
      exec_id: execId,
      company_id: companyId,
      batch_id: selectedBatchId,
      summary,
      detail: items,
      remaining_xml: remainingXml ?? 0,
      chain_scheduled: shouldChain,
      chain_depth: chainDepth,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha geral";
    slog("execucao_erro", companyId, msg, { exec_id: execId });
    await supabase
      .from("companies")
      .update({
        focusnfe: { ...focusnfe, nfe_expense_create_lease_until: null },
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId);
    if (selectedBatchId) {
      await appendTimeline(
        supabase,
        selectedBatchId,
        "ERROR",
        "Falha na criação de despesas por NF-e Focus.",
        {
          source: "focus-create-expenses-from-received-nfe",
          exec_id: execId,
          error: msg,
          summary,
        },
      );
    }
    return json({
      ok: false,
      error: msg,
      exec_id: execId,
      company_id: companyId,
      summary,
      detail: items,
    }, 500);
  }
});

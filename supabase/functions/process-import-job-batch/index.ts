/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { strFromU8 } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import { resolveProductMatches } from "../received-whatsapp-message/productMatch.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILES_PER_RUN = 8;

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

function normalizeName(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeAscii(v: string): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function mapInvoiceUnitToSystem(raw: string | null | undefined): {
  unit: string;
  needsReview: boolean;
  rawUnit: string | null;
} {
  const original = String(raw ?? "").trim();
  if (!original) {
    return { unit: "un", needsReview: true, rawUnit: null };
  }
  const t = normalizeAscii(original);
  const aliases: Record<string, string> = {
    un: "un",
    und: "un",
    unidade: "un",
    cx: "cx",
    caixa: "cx",
    pct: "pct",
    pacote: "pct",
    kg: "kg",
    g: "g",
    l: "l",
    litro: "l",
    ml: "ml",
    fardo: "fd",
    fd: "fd",
  };
  if (aliases[t]) return { unit: aliases[t], needsReview: false, rawUnit: original };
  return {
    unit: original.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").slice(0, 24) || "un",
    needsReview: true,
    rawUnit: original,
  };
}

async function insertImportLog(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  await supabase.from("company_nfe_import_logs").insert(payload);
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

async function markPending(
  supabase: ReturnType<typeof createClient>,
  pending: {
    company_id: string;
    batch_id: string;
    file_id: string;
    expense_id?: string | null;
    expense_item_id?: string | null;
    kind: "missing_conversion" | "missing_category" | "unit_conflict" | "possible_duplicate" | "missing_product_match";
    title: string;
    detail?: string;
    payload?: Record<string, unknown>;
  },
) {
  await supabase.from("import_review_pending").insert({
    company_id: pending.company_id,
    batch_id: pending.batch_id,
    file_id: pending.file_id,
    expense_id: pending.expense_id ?? null,
    expense_item_id: pending.expense_item_id ?? null,
    kind: pending.kind,
    title: pending.title,
    detail: pending.detail ?? null,
    payload: pending.payload ?? {},
  });
}

async function findOrCreateProduct(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  item: Record<string, unknown>,
): Promise<{ productId: string | null; needsReview: boolean; reason?: string }> {
  const name = String(item.productName ?? "").trim() || "Item";
  const mappedUnit = mapInvoiceUnitToSystem(
    String(item.unitCommercial ?? "").trim() || "un",
  );
  const unit = mappedUnit.unit;
  const sku = String(item.productCode ?? "").trim();
  const nname = normalizeName(name);

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, name, unit, sku")
    .eq("company_id", companyId);
  if (pErr) return { productId: null, needsReview: true, reason: pErr.message };
  const rows = (products ?? []) as Array<{ id: string; name: string; unit?: string | null; sku?: string | null }>;

  const bySku = sku
    ? rows.find((p) => (p.sku ?? "").trim().toLowerCase() === sku.toLowerCase())
    : null;
  if (bySku) {
    const existingUnit = String(bySku.unit ?? "un").trim().toLowerCase();
    if (existingUnit !== unit.toLowerCase()) {
      return {
        productId: null,
        needsReview: true,
        reason: `Conflito de unidade para SKU ${sku} (${existingUnit} x ${unit})`,
      };
    }
    return { productId: bySku.id, needsReview: false };
  }
  const exact = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() === unit.toLowerCase()
  );
  if (exact) return { productId: exact.id, needsReview: false };

  const sameNameDifferentUnit = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() !== unit.toLowerCase()
  );
  if (sameNameDifferentUnit) {
    return {
      productId: null,
      needsReview: true,
      reason: `Produto "${name}" com unidade divergente (${sameNameDifferentUnit.unit} x ${unit})`,
    };
  }

  const { data: created, error: cErr } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      name,
      unit,
      sku: sku || null,
      current_quantity: 0,
      import_unit_raw: mappedUnit.rawUnit,
      import_unit_needs_review: mappedUnit.needsReview,
    })
    .select("id")
    .single();
  if (cErr) return { productId: null, needsReview: true, reason: cErr.message };
  return { productId: (created?.id as string) ?? null, needsReview: false };
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
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const body = await req.json().catch(() => ({}));
  const batchId = String((body as { batch_id?: string }).batch_id ?? "").trim();
  if (!batchId) return json({ ok: false, error: "batch_id obrigatório." }, 400);

  const { data: batch, error: batchErr } = await supabase
    .from("import_job_batches")
    .select("id, company_id, requested_by, total_files, processed_files, success_files, failed_files, pending_review_files")
    .eq("id", batchId)
    .maybeSingle();
  if (batchErr || !batch?.id) return json({ ok: false, error: "lote não encontrado." }, 404);
  const companyId = String(batch.company_id);

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

  const nowIso = new Date().toISOString();
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
    await appendTimeline(supabase, batchId, "UPLOAD", "Lote enfileirado para processamento.");
  }

  const { data: files } = await supabase
    .from("import_job_files")
    .select("id, file_name, xml_hash, xml_content_base64")
    .eq("batch_id", batchId)
    .in("status", ["QUEUED", "PROCESSING"])
    .order("created_at", { ascending: true });

  let processed = Number(batch.processed_files ?? 0);
  let success = Number(batch.success_files ?? 0);
  let failed = Number(batch.failed_files ?? 0);
  let pendingReviewFiles = Number(batch.pending_review_files ?? 0);

  const chunkFiles = (files ?? []).slice(0, MAX_FILES_PER_RUN);

  for (const fRaw of chunkFiles) {
    const file = fRaw as { id: string; file_name: string; xml_hash: string; xml_content_base64: string };
    const fileId = file.id;
    await supabase
      .from("import_job_files")
      .update({ status: "PROCESSING", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", fileId);
    await appendTimeline(supabase, batchId, "PARSE", `Iniciando arquivo ${file.file_name}`, { file_name: file.file_name }, fileId);

    let fileStatus: "COMPLETED" | "FAILED" | "COMPLETED_WITH_PENDING_REVIEW" = "COMPLETED";
    let fileError: string | null = null;
    let pendingForFile = 0;
    let expenseId: string | null = null;
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

      const { data: alreadyByHash } = await supabase
        .from("company_nfe_import_logs")
        .select("id")
        .eq("company_id", companyId)
        .eq("xml_hash", file.xml_hash)
        .maybeSingle();
      if (alreadyByHash) {
        await appendTimeline(supabase, batchId, "DONE", "Arquivo já importado (hash).", {}, fileId);
        fileStatus = "COMPLETED";
      } else if (nfeAccessKey) {
        const { data: byKey } = await supabase
          .from("company_nfe_import_logs")
          .select("id")
          .eq("company_id", companyId)
          .eq("nfe_access_key", nfeAccessKey)
          .maybeSingle();
        if (byKey) {
          await insertImportLog(supabase, {
            company_id: companyId,
            file_name: file.file_name,
            xml_hash: file.xml_hash,
            nfe_access_key: nfeAccessKey,
            invoice_number: invoiceNumber,
            invoice_series: invoiceSeries,
            supplier_document: supplierDocument,
            emission_date: emissionDate,
            status: "duplicate",
            error_message: "Nota já importada por chave de acesso.",
            import_job_batch_id: batchId,
            import_job_file_id: fileId,
          });
        } else {
          const supplierId = await ensureSupplierFromExtracted(
            supabase,
            companyId,
            data,
            "Cadastrado automaticamente — importação XML/ZIP NF-e",
          );
          const match = await resolveProductMatches(supabase, companyId, data.items ?? []);
          const finalItems: Array<Record<string, unknown>> = [];
          let needsReviewReason: string | null = null;
          let itemIndex = 0;
          for (const item of match.items ?? []) {
            const pm = item.productMatch as Record<string, unknown> | undefined;
            const resolvedProductId = String(pm?.resolvedProductId ?? "").trim() || null;
            const needsConfirmation = pm?.needsConfirmation === true;
            let productId = resolvedProductId;
            if (!productId) {
              const created = await findOrCreateProduct(supabase, companyId, item as Record<string, unknown>);
              if (created.needsReview || !created.productId) {
                needsReviewReason = created.reason ?? `Não foi possível resolver "${item.productName}"`;
              } else {
                productId = created.productId;
              }
            }
            await supabase.from("import_job_items").insert({
              batch_id: batchId,
              file_id: fileId,
              company_id: companyId,
              item_index: itemIndex,
              product_name: String(item.productName ?? ""),
              status: needsConfirmation ? "PENDING_REVIEW" : "COMPLETED",
              classification_type: needsConfirmation ? "REVISAO_PENDENTE" : "PRODUTO_ESTOCAVEL",
              pending_reason: needsConfirmation ? "Conflito de unidade/baixa confiança" : null,
              payload: item,
            });
            itemIndex += 1;
            if (needsConfirmation) {
              pendingForFile += 1;
              await markPending(supabase, {
                company_id: companyId,
                batch_id: batchId,
                file_id: fileId,
                kind: "missing_product_match",
                title: `Item requer revisão: ${String(item.productName ?? "item")}`,
                detail: "Baixa confiança no vínculo de produto para importação XML.",
                payload: item as Record<string, unknown>,
              });
            }
            finalItems.push({
              ...item,
              productId,
              import_pending_resolution: needsConfirmation || !productId,
            });
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
              document_total: Number(data.totalAmount ?? 0) || null,
            })
            .select("id")
            .single();
          if (expErr || !expense?.id) throw new Error(expErr?.message ?? "Falha ao criar despesa.");
          expenseId = String(expense.id);
          await appendTimeline(supabase, batchId, "UPSERT_EXPENSE", "Despesa criada.", { expense_id: expenseId }, fileId);

          for (const it of finalItems) {
            const q = Math.max(0.0001, Number(it.quantity ?? 0));
            const uv = Number(it.unitValue ?? 0);
            const invUnit = String(it.unitCommercial ?? "").trim() || null;
            const productId = String(it.productId ?? "").trim() || null;
            const stockQty = Number(it.quantity ?? q);
            const { data: insItem, error: itemErr } = await supabase
              .from("expense_items")
              .insert({
                expense_id: expenseId,
                product_name: String(it.productName ?? "Item"),
                quantity: q,
                unit_value: uv,
                product_id: productId,
                invoice_unit: invUnit,
                stock_quantity: Number.isFinite(stockQty) ? stockQty : q,
                stock_added: false,
                import_nature: "PRODUCT_PURCHASE",
                import_engine_suggestion: "DIRECT_STOCK_ENTRY",
                import_confidence_0_1: 0.8,
                import_score_reasons_json: {
                  import_v2: {
                    mode: productId ? "DIRECT_STOCK_ENTRY" : "REVIEW_REQUIRED",
                    note: "Fluxo XML assíncrono sem vínculo com receita/ficha.",
                  },
                },
                import_stock_resolution: productId ? "DIRECT_STOCK_ENTRY" : "REVIEW_REQUIRED",
                resolved_entry_breakdown_recipe_id: null,
                import_pending_resolution: !productId || it.import_pending_resolution === true,
                import_applied_rule_id: null,
              })
              .select("id")
              .single();
            if (itemErr || !insItem?.id) {
              throw new Error(itemErr?.message ?? "Falha ao inserir item de despesa.");
            }
            if (!productId || it.import_pending_resolution === true) {
              pendingForFile += 1;
              await markPending(supabase, {
                company_id: companyId,
                batch_id: batchId,
                file_id: fileId,
                expense_id: expenseId,
                expense_item_id: String(insItem.id),
                kind: "missing_conversion",
                title: `Conversão/revisão pendente para ${String(it.productName ?? "item")}`,
                detail: "Item importado sem resolução segura para estoque.",
              });
            }
          }

          const { error: recErr } = await supabase
            .from("recebimentos")
            .insert({ expense_id: expenseId });
          if (recErr) throw new Error(recErr.message);

          await insertImportLog(supabase, {
            company_id: companyId,
            file_name: file.file_name,
            xml_hash: file.xml_hash,
            nfe_access_key: nfeAccessKey,
            invoice_number: invoiceNumber,
            invoice_series: invoiceSeries,
            supplier_document: supplierDocument,
            emission_date: emissionDate,
            status: needsReviewReason || pendingForFile > 0 ? "needs_review" : "success",
            error_message: needsReviewReason,
            expense_id: expenseId,
            payload: data,
            import_job_batch_id: batchId,
            import_job_file_id: fileId,
          });
        }
      }

      if (pendingForFile > 0) {
        fileStatus = "COMPLETED_WITH_PENDING_REVIEW";
        pendingReviewFiles += 1;
      } else {
        fileStatus = "COMPLETED";
      }
      await appendTimeline(supabase, batchId, "DONE", "Arquivo processado.", { pending_count: pendingForFile, expense_id: expenseId }, fileId);
    } catch (e) {
      fileStatus = "FAILED";
      fileError = e instanceof Error ? e.message : "Falha ao processar arquivo";
      await appendTimeline(supabase, batchId, "ERROR", fileError, {}, fileId);
    }

    processed += 1;
    if (fileStatus === "FAILED") failed += 1;
    else success += 1;
    const progressPercent = batch.total_files > 0
      ? Number(((processed / Number(batch.total_files)) * 100).toFixed(2))
      : 100;
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

  const totalFiles = Number(batch.total_files ?? 0);
  const remainingFiles = Math.max(totalFiles - processed, 0);
  if (remainingFiles > 0) {
    const nextTrigger = fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch_id: batchId }),
    }).catch(() => undefined);
    try {
      // @ts-ignore Edge runtime helper (quando disponível)
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-ignore
        EdgeRuntime.waitUntil(nextTrigger);
      }
    } catch {
      // no-op
    }
    return json({
      ok: true,
      batch_id: batchId,
      status: "PROCESSING",
      processed_files: processed,
      success_files: success,
      failed_files: failed,
      pending_review_files: pendingReviewFiles,
      remaining_files: remainingFiles,
    });
  }

  const finalStatus =
    failed > 0 && success > 0
      ? "PARTIAL_SUCCESS"
      : failed > 0
        ? "FAILED"
        : pendingReviewFiles > 0
          ? "COMPLETED_WITH_PENDING_REVIEW"
          : "COMPLETED";
  await supabase
    .from("import_job_batches")
    .update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      progress_percent: 100,
      updated_at: new Date().toISOString(),
      last_error: failed > 0 ? "Alguns arquivos falharam no processamento." : null,
    })
    .eq("id", batchId);

  const { count: pendingOpenCount } = await supabase
    .from("import_review_pending")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "OPEN");
  if ((pendingOpenCount ?? 0) > 0) {
    await supabase.from("company_alerts").upsert({
      company_id: companyId,
      kind: "import_pending_review",
      severity: "warning",
      dedupe_key: "import_pending_review_open",
      title: "Pendências de importação",
      message: `${pendingOpenCount} item(ns) de importação precisam de revisão.`,
      link_path: "/app/importacoes/pendencias",
      payload: { open_pending_count: pendingOpenCount },
      status: "open",
    }, { onConflict: "company_id,dedupe_key" });
  }

  return json({
    ok: true,
    batch_id: batchId,
    status: finalStatus,
    processed_files: processed,
    success_files: success,
    failed_files: failed,
    pending_review_files: pendingReviewFiles,
  });
});

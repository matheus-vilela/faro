/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { strFromU8 } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import { enrichExtractedWithTaxId, ensureSupplierFromExtracted } from "../_shared/expenseSupplierEnsure.ts";
import { insertBoletosFromNfeDupXml } from "../_shared/insertBoletosFromNfeDup.ts";
import { resolveProductMatches } from "../received-whatsapp-message/productMatch.ts";
import { embedSingleProductIfMissing } from "../_shared/productEmbedding.ts";
import { mapInvoiceUnitToCatalogUnit } from "../_shared/productImport/invoiceUnitToCatalogUnit.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Uma sub-ronda curta por invoke (quota CPU da Edge); o resto encadeia via `stillActive`. */
const MAX_FILES_PER_RUN = 4;

const LOG = "[process-import-job-batch]";

/** Marcador grepável nos logs (`acao` fixo): sempre inclui `unidade` = company_id. */
function marcador(unidadeId: string, acao: string, detalhes: Record<string, unknown>): void {
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

function normalizeName(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  options?: { relaxedDuplicateName?: boolean },
): Promise<{
  productId: string | null;
  needsReview: boolean;
  reason?: string;
  createdNew: boolean;
}> {
  const name = String(item.productName ?? "").trim() || "Item";
  const mappedUnit = mapInvoiceUnitToCatalogUnit(
    String(item.unitCommercial ?? "").trim() || "un",
  );
  const unit = mappedUnit.unit;
  const sku = String(item.productCode ?? "").trim();
  const nname = normalizeName(name);

  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, name, unit, sku")
    .eq("company_id", companyId);
  if (pErr) return { productId: null, needsReview: true, reason: pErr.message, createdNew: false };
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
        createdNew: false,
      };
    }
    return { productId: bySku.id, needsReview: false, createdNew: false };
  }
  const exact = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() === unit.toLowerCase()
  );
  if (exact) return { productId: exact.id, needsReview: false, createdNew: false };

  const sameNameDifferentUnit = rows.find((p) =>
    normalizeName(String(p.name ?? "")) === nname &&
    String(p.unit ?? "un").trim().toLowerCase() !== unit.toLowerCase()
  );
  if (sameNameDifferentUnit) {
    if (options?.relaxedDuplicateName) {
      const altName = `${name} (${unit})`.slice(0, 240);
      const { data: createdAlt, error: altErr } = await supabase
        .from("products")
        .insert({
          company_id: companyId,
          name: altName,
          unit,
          sku: sku || null,
          current_quantity: 0,
          import_unit_raw: mappedUnit.rawUnit,
          import_unit_needs_review: mappedUnit.needsReview,
        })
        .select("id")
        .single();
      if (altErr) {
        return {
          productId: null,
          needsReview: true,
          reason: altErr.message,
          createdNew: false,
        };
      }
      return {
        productId: (createdAlt?.id as string) ?? null,
        needsReview: false,
        createdNew: true,
      };
    }
    return {
      productId: null,
      needsReview: true,
      reason: `Produto "${name}" com unidade divergente (${sameNameDifferentUnit.unit} x ${unit})`,
      createdNew: false,
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
  if (cErr) {
    return { productId: null, needsReview: true, reason: cErr.message, createdNew: false };
  }
  return { productId: (created?.id as string) ?? null, needsReview: false, createdNew: true };
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

  pibLog(execId, "batch_carregado", { company_id: companyId, batch_id: batchId }, "lote encontrado; início processamento", {
    caller_service_role: isServiceCaller,
    batch_status: batch.status,
    total_files: batch.total_files,
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
    await appendTimeline(supabase, batchId, "CANCEL", "Importação cancelada — nenhum arquivo pendente será processado.");
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
    await appendTimeline(supabase, batchId, "UPLOAD", "Lote enfileirado para processamento.");
  }

  let processed = Number(batch.processed_files ?? 0);
  let success = Number(batch.success_files ?? 0);
  let failed = Number(batch.failed_files ?? 0);
  let pendingReviewFiles = Number(batch.pending_review_files ?? 0);

  marcador(companyId, "LOTE_INICIO", {
    batch_id: batchId,
    exec_id: execId,
    max_ficheiros_neste_invoke: MAX_FILES_PER_RUN,
  });

  const { data: files } = await supabase
    .from("import_job_files")
    .select("id, file_name, xml_hash, xml_content_base64")
    .eq("batch_id", batchId)
    .in("status", ["QUEUED", "PROCESSING"])
    .order("created_at", { ascending: true });

  const filesQueued = (files ?? []).length;
  const chunkLen = Math.min(MAX_FILES_PER_RUN, filesQueued);
  if (filesQueued === 0) {
    marcador(companyId, "FILA_ESGOTADA", { batch_id: batchId });
  }
  pibLog(
    execId,
    "ficheiros_para_processar",
    { company_id: companyId, batch_id: batchId },
    `${filesQueued} ficheiro(s) QUEUED/PROCESSING; neste invoke processa até ${chunkLen}`,
    {
      max_por_invoke: MAX_FILES_PER_RUN,
      ids_preview: (files ?? []).slice(0, 3).map((f: { id: string }) => f.id),
    },
  );
  marcador(companyId, "SUBRONDA", {
    batch_id: batchId,
    na_fila: filesQueued,
    processar_agora: chunkLen,
  });

  const chunkFiles = (files ?? []).slice(0, MAX_FILES_PER_RUN);

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
      await appendTimeline(supabase, batchId, "CANCEL", "Importação cancelada pelo usuário.");
      await supabase
        .from("import_job_batches")
        .update({
          status: "CANCELLED",
          finished_at: cancelIso,
          last_error: "Importação cancelada pelo usuário.",
          progress_percent: batch.total_files > 0
            ? Number(((processed / Number(batch.total_files)) * 100).toFixed(2))
            : 100,
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

    const file = fRaw as { id: string; file_name: string; xml_hash: string; xml_content_base64: string };
    const fileId = file.id;
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
        .select("id")
        .eq("company_id", companyId)
        .eq("xml_hash", file.xml_hash)
        .maybeSingle();
      if (alreadyByHash) {
        pibLog(
          execId,
          "skip_ja_importado_hash",
          { company_id: companyId, batch_id: batchId, file_id: fileId },
          "company_nfe_import_logs já tem este xml_hash — não cria despesa nem fornecedor de novo",
          {},
        );
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
          pibLog(
            execId,
            "skip_duplicado_chave_nfe",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "já existe log com mesma nfe_access_key — regista duplicate, não cria despesa",
            { chave_nfe_44: nfeAccessKey },
          );
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
          const match = await resolveProductMatches(supabase, companyId, data.items ?? [], {
            importBatch: true,
          });
          const deferProductCreation = match.deferProductCreationToReconciliation === true;
          pibLog(
            execId,
            "match_produtos",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "resolveProductMatches concluído",
            {
              itens_match: (match.items ?? []).length,
              defer_product_creation: deferProductCreation,
              borderline_llm_calls: match.borderlineLlmCalls ?? 0,
            },
          );
          const finalItems: Array<Record<string, unknown>> = [];
          const rawRowIdsOrdered: string[] = [];
          let needsReviewReason: string | null = null;
          let itemIndex = 0;
          for (const item of match.items ?? []) {
            const pm = item.productMatch as Record<string, unknown> | undefined;
            const resolvedProductId = String(pm?.resolvedProductId ?? "").trim() || null;
            const needsConfirmation = pm?.needsConfirmation === true;
            let productId = resolvedProductId;
            if (!productId && !deferProductCreation) {
              const llmSuggested = String(pm?.["borderlineLlmSuggestedName"] ?? "").trim();
              const rowForProduct = llmSuggested
                ? { ...(item as Record<string, unknown>), productName: llmSuggested }
                : (item as Record<string, unknown>);
              const created = await findOrCreateProduct(
                supabase,
                companyId,
                rowForProduct,
                { relaxedDuplicateName: true },
              );
              if (created.needsReview || !created.productId) {
                needsReviewReason = created.reason ?? `Não foi possível resolver "${item.productName}"`;
              } else {
                productId = created.productId;
                if (created.createdNew) {
                  await embedSingleProductIfMissing(
                    supabase,
                    companyId,
                    created.productId,
                    String(rowForProduct.productName ?? "Item"),
                  );
                }
              }
            }
            const { data: ijInserted, error: ijInsErr } = await supabase
              .from("import_job_items")
              .insert({
              batch_id: batchId,
              file_id: fileId,
              company_id: companyId,
              item_index: itemIndex,
              product_name: String(item.productName ?? ""),
              status: needsConfirmation ? "PENDING_REVIEW" : "COMPLETED",
              classification_type: needsConfirmation ? "REVISAO_PENDENTE" : "PRODUTO_ESTOCAVEL",
              pending_reason: needsConfirmation ? "Conflito de unidade/baixa confiança" : null,
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
                quantity: Number((item as { quantity?: number }).quantity ?? 0) || null,
                line_value: Number((item as { lineTotal?: number }).lineTotal ?? 0) || null,
                ean: eanDigits.length ? eanDigits : null,
                ncm: String((item as { ncm?: string }).ncm ?? "").trim() || null,
                extracted_attributes: {},
                created_product_id: productId,
              })
              .select("id")
              .single();
            if (rawInsErr) throw new Error(rawInsErr.message);
            rawRowIdsOrdered.push(String(rawIns?.id ?? ""));
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

          if (needsReviewReason) {
            pibLog(
              execId,
              "aviso_revisao_produto",
              { company_id: companyId, batch_id: batchId, file_id: fileId },
              "pelo menos um item ficou sem produto resolvido",
              { needs_review_reason: needsReviewReason, pending_for_file: pendingForFile },
            );
          }

          const fromXmlTotal = Number(data.totalAmount ?? 0);
          const summedLines = sumExpenseLineTotals(finalItems);
          const documentTotalResolved =
            Number.isFinite(fromXmlTotal) && fromXmlTotal > 0
              ? fromXmlTotal
              : summedLines > 0
                ? summedLines
                : null;
          const referenceDateIso =
            emissionDate && /^\d{4}-\d{2}-\d{2}$/.test(emissionDate)
              ? emissionDate
              : new Date().toISOString().slice(0, 10);

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
          await appendTimeline(supabase, batchId, "UPSERT_EXPENSE", "Despesa criada.", { expense_id: expenseId }, fileId);

          for (let idx = 0; idx < finalItems.length; idx++) {
            const it = finalItems[idx]!;
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
                    defer_product_creation: deferProductCreation,
                    match_borderline_llm_calls: match.borderlineLlmCalls ?? 0,
                    match_decision_path:
                      (it as { productMatch?: { decisionPath?: string } }).productMatch?.decisionPath ??
                      null,
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
            const ri = rawRowIdsOrdered[idx];
            if (ri) {
              await supabase
                .from("onboarding_import_item_raw")
                .update({
                  expense_item_id: String(insItem.id),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", ri)
                .eq("company_id", companyId);
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
            await appendTimeline(
              supabase,
              batchId,
              "BOLETOS",
              `${boRes.inserted} parcela(s) da cobrança registrada(s).`,
              { duplicatas: boRes.rows },
              fileId,
            );
          }

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
          pibLog(
            execId,
            "import_log_gravado",
            { company_id: companyId, batch_id: batchId, file_id: fileId },
            "company_nfe_import_logs insert OK",
            {
              expense_id: expenseId,
              log_status: needsReviewReason || pendingForFile > 0 ? "needs_review" : "success",
            },
          );
          marcador(companyId, "IMPORT_NFE_LOG_GRAVADO", {
            batch_id: batchId,
            file_id: fileId,
            expense_id: expenseId,
          });
        }
      } else {
        pibLog(
          execId,
          "skip_sem_chave_nfe",
          { company_id: companyId, batch_id: batchId, file_id: fileId },
          "XML válido mas extracted sem chave de acesso (nfeAccessKey) — não entra no fluxo despesa/fornecedor",
          { file_name: file.file_name },
        );
        await appendTimeline(
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
      await appendTimeline(supabase, batchId, "DONE", "Arquivo processado.", { pending_count: pendingForFile, expense_id: expenseId }, fileId);
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

  if ((stillActive ?? 0) > 0) {
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

    /** Não faz `await` no invoke seguinte para não empilhar ~2× o wall-clock na mesma instância. */
    const fallbackFetchChain = (): Promise<Response | undefined> =>
      fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batch_id: batchId }),
      }).catch(() => undefined);

    const chainPromise = supabase.functions
      .invoke("process-import-job-batch", { body: { batch_id: batchId } })
      .then(({ data: chainData, error: chainErr }) => {
        if (chainErr) {
          const errMsg = chainErr.message ?? String(chainErr);
          marcador(companyId, "ENCADEAMENTO_INVOKE_ERRO", { batch_id: batchId, erro: errMsg });
          pibLog(execId, "chain_invoke_erro", { company_id: companyId, batch_id: batchId }, errMsg, {
            chain_invoke: chainErr,
          });
          const fb = fallbackFetchChain();
          try {
            // @ts-ignore Edge runtime helper (quando disponível)
            if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
              // @ts-ignore
              EdgeRuntime.waitUntil(fb);
              pibLog(
                execId,
                "chain_fallback_waitUntil",
                { company_id: companyId, batch_id: batchId },
                "invoke falhou — waitUntil(fetch fallback)",
                {},
              );
            } else {
              void fb.catch(() => undefined);
            }
          } catch (_) {
            void fb.catch(() => undefined);
          }
          return;
        }
        marcador(companyId, "ENCADEAMENTO_INVOKE_OK", { batch_id: batchId });
        pibLog(execId, "chain_invoke_ok", { company_id: companyId, batch_id: batchId }, "invoke agendado (resolvido)", {
          resumo: typeof chainData === "object" && chainData !== null ? chainData : { raw: chainData },
        });
      })
      .catch((e) => {
        marcador(companyId, "ENCADEAMENTO_INVOKE_EXCECAO", { batch_id: batchId, erro: String(e) });
        pibLog(execId, "chain_invoke_excecao", { company_id: companyId, batch_id: batchId }, String(e), {});
        void fallbackFetchChain();
      });

    try {
      // @ts-ignore Edge runtime helper (quando disponível)
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-ignore
        EdgeRuntime.waitUntil(chainPromise);
        pibLog(
          execId,
          "chain_invoke_waitUntil",
          { company_id: companyId, batch_id: batchId },
          "waitUntil(invoke process-import-job-batch)",
          {},
        );
      } else {
        void chainPromise;
        pibLog(
          execId,
          "chain_invoke_fire_and_forget",
          { company_id: companyId, batch_id: batchId },
          "sem EdgeRuntime.waitUntil — invoke em void",
          {},
        );
      }
    } catch (chErr) {
      console.warn(
        LOG,
        JSON.stringify({ exec_id: execId, fase: "chain_agendar_erro", batch_id: batchId, erro: String(chErr) }),
      );
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
    const reconcileTrigger = fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/run-onboarding-product-reconciliation`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader!,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ company_id: companyId, source_batch_id: batchId }),
      },
    ).catch(() => undefined);
    try {
      // @ts-ignore Edge runtime
      if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
        // @ts-ignore
        EdgeRuntime.waitUntil(reconcileTrigger);
      }
    } catch {
      // no-op
    }
  }

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
      link_path: "/app",
      payload: { open_pending_count: pendingOpenCount },
      status: "open",
    }, { onConflict: "company_id,dedupe_key" });
  }

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

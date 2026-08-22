import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  enrichExtractedWithTaxId,
  ensureSupplierFromExtracted,
  extractTaxIdDigits,
} from "../_shared/expenseSupplierEnsure.ts";
import {
  type ExtractedDocumentResult,
  extractDocumentWithOpenAI,
  mapDocumentKindToExpenseType,
  normalizeExtractedDueDate,
  scaleItemsToTotal,
  sumItems,
  totalsMatch,
} from "../_shared/openaiExpense.ts";
import { bytesToImageDataUrlSafe, optimizeExpenseImage } from "../_shared/optimizeExpenseImage.ts";
import { fetchZApiMediaBytes } from "../_shared/zapiMedia.ts";
import { pickInvoiceUnitRaw } from "../_shared/productImport/consolidateItems.ts";
import { fetchProductDefaultExpenseCategoryById } from "../_shared/productDefaultExpenseCategory.ts";
import {
  type ItemWithProductMatch,
  resolveProductMatches,
  upsertProductInvoiceAlias,
} from "./productMatch.ts";
import { getDefaultCatalogMatchingOpts } from "../_shared/nfeExpenseProducts/catalogMatchingPolicy.ts";
import { withFaroFlowFooter } from "./whatsappFlowFooter.ts";

type Supabase = ReturnType<typeof createClient>;

const WHATSAPP_MSG_NOTA_DUPLICADA =
  "Esta nota já foi lançada no sistema. Confira em *Despesas* no Faro.";

type InsertExpenseOutcome =
  | { status: "ok"; expenseId: string }
  | { status: "duplicate" }
  | { status: "error" };

/** Alinhado ao índice único em `expenses` e à RPC `expense_find_duplicate_by_supplier_document`. */
async function findDuplicateExpenseIdForWhatsapp(
  supabase: Supabase,
  params: {
    companyId: string;
    supplierId: string | null;
    supplierDocumentDigits: string;
    invoiceNumber: string;
    invoiceSeries: string;
  },
): Promise<string | null> {
  const digits = params.supplierDocumentDigits.replace(/\D/g, "");
  const supplierOk =
    params.supplierId != null ||
    digits.length >= 11;
  const inv = params.invoiceNumber.trim();
  if (!inv || !supplierOk) {
    return null;
  }
  const { data, error } = await supabase.rpc(
    "expense_find_duplicate_by_supplier_document",
    {
      p_company_id: params.companyId,
      p_supplier_id: params.supplierId,
      p_supplier_document: digits,
      p_invoice_number: inv,
      p_invoice_series: params.invoiceSeries ?? "",
      p_exclude_expense_id: null,
    },
  );
  if (error) {
    console.error(
      "[whatsappExpenseFlow] expense_find_duplicate_by_supplier_document:",
      error.message,
    );
    return null;
  }
  return (data as string | null) ?? null;
}

function fallbackDueDateIso(flow: "payable" | "receivable"): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (flow === "payable" ? 10 : 14));
  return d.toISOString().slice(0, 10);
}

function formatDueBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function buildWhatsappBoletoDescription(
  data: ExtractedDocumentResult,
  flow: "payable" | "receivable",
): string {
  const title = (data.boletoTitle ?? "").trim();
  const sup = (data.supplierName ?? "").trim();
  if (title) return title.slice(0, 2000);
  if (flow === "payable") {
    return (sup ? `Pagar: ${sup}` : "Conta a pagar (WhatsApp)").slice(0, 2000);
  }
  return (sup ? `Receber: ${sup}` : "Conta a receber (WhatsApp)").slice(0, 2000);
}

/**
 * Lançamento direto em `boletos` (fluxo de caixa), sem despesa de estoque.
 */
async function insertBoletoFromWhatsappCashflow(
  supabase: Supabase,
  companyId: string,
  data: ExtractedDocumentResult,
  flow: "payable" | "receivable",
): Promise<{ ok: true; dueDateIso: string } | { ok: false }> {
  const total = Number(data.totalAmount ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false };
  }
  const dueIso =
    normalizeExtractedDueDate(data.dueDate ?? undefined) ??
    fallbackDueDateIso(flow);
  const description = buildWhatsappBoletoDescription(data, flow);
  const { data: row, error } = await supabase
    .from("boletos")
    .insert({
      company_id: companyId,
      expense_id: null,
      description,
      due_date: dueIso,
      amount: Math.round(total * 100) / 100,
      flow_type: flow,
      payment_type: "boleto",
      barcode: null,
      provider: null,
      status: "pending",
      company_category_id: null,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error(
      "[whatsappExpenseFlow] insert boleto cashflow:",
      error?.message,
    );
    return { ok: false };
  }
  return { ok: true, dueDateIso: dueIso };
}

function publicAppBaseUrl(): string {
  const u = Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  return u.replace(/\/$/, "");
}

function publicAppAbsoluteBase(): string {
  const raw = publicAppBaseUrl();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return `https://${raw.replace(/\/$/, "")}`;
}

function randomShortSlug(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Cria ou reutiliza slug em `whatsapp_expense_draft_short_links` (service role). */
async function ensureWhatsappExpenseDraftShortSlug(
  supabase: Supabase,
  companyId: string,
  draftId: string,
  accessTokenUuid: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("whatsapp_expense_draft_short_links")
    .select("slug")
    .eq("draft_id", draftId)
    .maybeSingle();

  const existingSlug = existing as { slug?: string } | null;
  if (existingSlug?.slug && typeof existingSlug.slug === "string") {
    return existingSlug.slug;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    const slug = randomShortSlug(8);
    const { error } = await supabase
      .from("whatsapp_expense_draft_short_links")
      .insert({
        company_id: companyId,
        slug,
        draft_id: draftId,
        access_token: accessTokenUuid,
      });
    if (!error) return slug;
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error(
        "[whatsappExpenseFlow] ensureWhatsappExpenseDraftShortSlug:",
        error.message,
      );
      return null;
    }
  }
  return null;
}

/** URL pública do rascunho: `/e/:slug` quando possível; senão `/w/:token`. */
async function buildDraftShortLink(
  supabase: Supabase,
  companyId: string,
  draftId: string,
  accessToken: string | null | undefined,
): Promise<string> {
  const base = publicAppAbsoluteBase();
  if (!base || !accessToken) return "";
  const slug = await ensureWhatsappExpenseDraftShortSlug(
    supabase,
    companyId,
    draftId,
    accessToken,
  );
  return slug ? `${base}/e/${slug}` : `${base}/w/${accessToken}`;
}

function formatMoneyBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

function normalizeDraftCommand(text: string): string {
  return text
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

export async function loadPendingDraft(
  supabase: Supabase,
  companyId: string,
  senderNormalized: string,
): Promise<{
  id: string;
  extracted_json: unknown;
  access_token: string | null;
  source_document_path: string | null;
} | null> {
  const { data, error } = await supabase
    .from("whatsapp_expense_drafts")
    .select("id, extracted_json, access_token, source_document_path")
    .eq("company_id", companyId)
    .eq("sender_phone_normalized", senderNormalized)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[whatsappExpenseFlow] loadPendingDraft:", error.message);
    return null;
  }
  return data as {
    id: string;
    extracted_json: unknown;
    access_token: string | null;
    source_document_path: string | null;
  } | null;
}

export async function deleteDraft(supabase: Supabase, draftId: string) {
  await supabase.from("whatsapp_expense_drafts").delete().eq("id", draftId);
}

export type SaveDraftResult = { draftId: string; accessToken: string };

export async function saveDraft(
  supabase: Supabase,
  companyId: string,
  senderNormalized: string,
  extracted: ExtractedDocumentResult & Record<string, unknown>,
  sumItemsVal: number,
  totalDoc: number,
  sourceDocumentPath?: string | null,
): Promise<SaveDraftResult | null> {
  await supabase
    .from("whatsapp_expense_drafts")
    .delete()
    .eq("company_id", companyId)
    .eq("sender_phone_normalized", senderNormalized);

  const toStore = enrichExtractedWithTaxId(extracted);
  const { data, error } = await supabase
    .from("whatsapp_expense_drafts")
    .insert({
      company_id: companyId,
      sender_phone_normalized: senderNormalized,
      extracted_json: toStore,
      sum_items: sumItemsVal,
      total_document: totalDoc,
      source_document_path: sourceDocumentPath ?? null,
    })
    .select("id, access_token")
    .single();

  if (error) {
    console.error("[whatsappExpenseFlow] saveDraft insert:", error.message);
    return null;
  }
  const draftId = data?.id as string | undefined;
  const accessToken = data?.access_token as string | undefined;
  if (!draftId || !accessToken) return null;
  return { draftId, accessToken };
}

async function insertExpense(
  supabase: Supabase,
  companyId: string,
  extracted: ExtractedDocumentResult,
  items: ItemWithProductMatch[],
  sourceDocumentPath: string | null,
  whatsappSenderNormalized: string,
): Promise<InsertExpenseOutcome> {
  const type = mapDocumentKindToExpenseType(extracted.documentKind);
  const taxIdDigits = extractTaxIdDigits(extracted);
  const { supplierId } = await ensureSupplierFromExtracted(
    supabase,
    companyId,
    extracted,
  );
  const supplierDocumentRow =
    taxIdDigits ??
    (extracted.supplierDocument?.trim()
      ? extracted.supplierDocument.trim()
      : null);
  const seriesRaw = extracted.invoiceSeries;
  const invoiceSeries =
    type === "nota_fiscal" && seriesRaw != null && String(seriesRaw).trim()
      ? String(seriesRaw).trim()
      : null;
  const invoiceNumberStr = String(extracted.invoiceNumber ?? "").trim();

  const dupId = await findDuplicateExpenseIdForWhatsapp(supabase, {
    companyId,
    supplierId,
    supplierDocumentDigits: (supplierDocumentRow ?? "").replace(/\D/g, ""),
    invoiceNumber: invoiceNumberStr,
    invoiceSeries: type === "nota_fiscal" ? (invoiceSeries ?? "") : "",
  });
  if (dupId) {
    return { status: "duplicate" };
  }

  const emissionRaw = String(extracted.emissionDate ?? "").trim().slice(0, 10);
  const referenceDate =
    /^\d{4}-\d{2}-\d{2}$/.test(emissionRaw)
      ? emissionRaw
      : new Date().toISOString().slice(0, 10);
  const docTotalRaw = Number(extracted.totalAmount ?? 0);
  const documentTotal =
    Number.isFinite(docTotalRaw) && docTotalRaw > 0 ? docTotalRaw : null;

  const { data: exp, error: e1 } = await supabase
    .from("expenses")
    .insert({
      company_id: companyId,
      created_by: null,
      type,
      invoice_number: invoiceNumberStr || null,
      invoice_series: invoiceSeries,
      supplier_id: supplierId,
      supplier_name:
        (extracted.supplierName ?? "").trim() || "Fornecedor (WhatsApp)",
      supplier_document: supplierDocumentRow,
      status: "pending",
      expense_source: "whatsapp",
      reference_date: referenceDate,
      document_total: documentTotal,
      notes:
        [extracted.notes, "Importado via WhatsApp"]
          .filter(Boolean)
          .join(" — ") || "Importado via WhatsApp",
      whatsapp_sender_phone_normalized: whatsappSenderNormalized,
    })
    .select("id")
    .single();

  if (e1) {
    const code = (e1 as { code?: string }).code;
    if (code === "23505") {
      return { status: "duplicate" };
    }
    console.error("[whatsappExpenseFlow] insert expense:", e1.message);
    return { status: "error" };
  }
  if (!exp) {
    return { status: "error" };
  }

  const expenseId = exp.id as string;
  const defaultCategoryByProductId =
    await fetchProductDefaultExpenseCategoryById(
      supabase,
      companyId,
      items.map((it) => it.productId).filter(Boolean) as string[],
    );
  for (const it of items) {
    const q = Math.max(0.0001, Number(it.quantity));
    const uv = Math.round(Number(it.unitValue) * 10000) / 10000;
    const row: Record<string, unknown> = {
      company_id: companyId,
      expense_id: expenseId,
      product_name: (it.productName ?? "").trim() || "Item",
      quantity: q,
      unit_value: uv,
    };
    const invRaw = pickInvoiceUnitRaw(it);
    if (invRaw) {
      row.invoice_unit = invRaw;
    }
    const pm = it.productMatch;
    if (pm) {
      if (pm.stockQuantity != null) row.stock_quantity = pm.stockQuantity;
      if (pm.conversionFactorApplied != null) {
        row.conversion_factor_applied = pm.conversionFactorApplied;
      }
      if (pm.resolutionSource) row.resolution_source = pm.resolutionSource;
      if (pm.invoiceUnitNormalized) {
        row.normalized_invoice_unit = String(pm.invoiceUnitNormalized);
      }
      if (pm.resolutionStatus) {
        row.import_resolution_status = pm.resolutionStatus;
      }
      if (pm.suggestedScore != null) row.match_score = pm.suggestedScore;
      if (pm.matchReason) row.match_decision_reason = pm.matchReason;
    }
    if (it.productId) {
      row.product_id = it.productId;
      const defCat = defaultCategoryByProductId.get(it.productId);
      if (defCat) row.company_category_id = defCat;
    }
    const { error: ei } = await supabase.from("expense_items").insert(row);
    if (ei) {
      console.error("[whatsappExpenseFlow] insert item:", ei.message);
    } else if (it.productId) {
      await upsertProductInvoiceAlias(
        supabase,
        companyId,
        (it.productName ?? "").trim() || "Item",
        it.productId,
      );
    }
  }
  if (sourceDocumentPath) {
    const { error: upErr } = await supabase
      .from("expenses")
      .update({ source_document_path: sourceDocumentPath })
      .eq("id", expenseId);
    if (upErr) {
      console.error(
        "[whatsappExpenseFlow] source_document_path:",
        upErr.message,
      );
    }
  }
  // Recebimento: criado no app após approve_whatsapp_expense_as_owner.
  return { status: "ok", expenseId };
}

type DraftPayload = ExtractedDocumentResult & {
  _requiresProductConfirmation?: boolean;
  _pendingQuoteConfirmation?: boolean;
  /** Preserva requiresProductConfirmation enquanto aguarda sim/não do orçamento */
  _pendingQuoteMatchRequiresProductConfirmation?: boolean;
};

/**
 * Após match de produtos: orçamento (pergunta), divergência total×itens, ou grava despesa.
 */
async function processMatchedExpenseFlow(
  supabase: Supabase,
  companyId: string,
  senderNormalized: string,
  data: ExtractedDocumentResult,
  matchResult: {
    items: ItemWithProductMatch[];
    requiresProductConfirmation: boolean;
  },
  sendWhatsapp: (
    phone: string,
    message: string,
    ctx: string,
    flowId?: string,
  ) => Promise<unknown>,
  flowId: string,
  sourceDocumentPath: string | null,
  opts?: { quoteUserConfirmed?: boolean },
): Promise<void> {
  const matchItems = matchResult.items;
  let working: ExtractedDocumentResult = { ...data };
  if (opts?.quoteUserConfirmed) {
    working = {
      ...working,
      likelyNotEffectivePurchase: false,
      likelyNotPurchaseReason: null,
      notes:
        [
          working.notes,
          "Confirmado no WhatsApp: lançar como despesa apesar de orçamento/proposta.",
        ]
          .filter(Boolean)
          .join(" — ") ||
        "Confirmado no WhatsApp: lançar como despesa apesar de orçamento/proposta.",
    };
  }

  if (working.likelyNotEffectivePurchase) {
    const sum = sumItems(matchItems);
    const totalDoc = Number(working.totalAmount ?? 0);
    const pending: DraftPayload = {
      ...working,
      items: matchItems,
      _pendingQuoteConfirmation: true,
      _pendingQuoteMatchRequiresProductConfirmation:
        matchResult.requiresProductConfirmation,
    };
    await saveDraft(
      supabase,
      companyId,
      senderNormalized,
      pending as ExtractedDocumentResult & Record<string, unknown>,
      sum,
      totalDoc,
      sourceDocumentPath,
    );
    const reason =
      (working.likelyNotPurchaseReason ?? "").trim() ||
      "O documento parece ser orçamento, proposta ou não indica compra concluída.";
    await sendWhatsapp(
      senderNormalized,
      `⚠️ ${reason}\n\nDeseja *lançar mesmo assim* como despesa no Faro?\n\nResponda *sim* para registrar ou *não* para cancelar.`,
      "despesa_whatsapp_confirmar_orcamento",
      flowId,
    );
    return;
  }

  const sum = sumItems(matchItems);
  const totalDoc = Number(working.totalAmount ?? 0);

  if (totalsMatch(totalDoc, sum)) {
    if (!matchResult.requiresProductConfirmation) {
      const outcome = await insertExpense(
        supabase,
        companyId,
        working,
        matchItems,
        sourceDocumentPath,
        senderNormalized,
      );
      if (outcome.status === "ok") {
        await sendWhatsapp(
          senderNormalized,
          withFaroFlowFooter(
            `Despesa registrada (${formatMoneyBrl(totalDoc)}). Os itens batem com o total. Abra o Faro para revisar.`,
            "registro",
          ),
          "despesa_whatsapp_ok",
          flowId,
        );
      } else if (outcome.status === "duplicate") {
        await sendWhatsapp(
          senderNormalized,
          withFaroFlowFooter(WHATSAPP_MSG_NOTA_DUPLICADA, "registro"),
          "despesa_whatsapp_duplicada",
          flowId,
        );
      } else {
        await sendWhatsapp(
          senderNormalized,
          withFaroFlowFooter(
            "Extraí os dados, mas não consegui salvar. Tente pelo app.",
          ),
          "despesa_whatsapp_erro_insert",
          flowId,
        );
      }
      return;
    }

    const extractedPayload: DraftPayload = {
      ...working,
      items: matchItems,
      _requiresProductConfirmation: true,
    };
    const saved = await saveDraft(
      supabase,
      companyId,
      senderNormalized,
      extractedPayload as ExtractedDocumentResult & Record<string, unknown>,
      sum,
      totalDoc,
      sourceDocumentPath,
    );
    const shortLink = saved
      ? await buildDraftShortLink(
          supabase,
          companyId,
          saved.draftId,
          saved.accessToken,
        )
      : "";
    const linkBlock = shortLink ? `\n\n🔗 Conferir produtos: ${shortLink}` : "";
    await sendWhatsapp(
      senderNormalized,
      withFaroFlowFooter(
        `Reconheci a nota (${formatMoneyBrl(totalDoc)}).\n\nAlguns itens não foram reconhecidos e vinculados automaticamente com os seus produtos.\n\n Confirme o vínculo dos itens no link.${linkBlock}`,
        "registro",
      ),
      "despesa_whatsapp_produtos_pendentes",
      flowId,
    );
    return;
  }

  const extractedWithProducts: DraftPayload = {
    ...working,
    items: matchItems,
    _requiresProductConfirmation: matchResult.requiresProductConfirmation,
  };
  const saved = await saveDraft(
    supabase,
    companyId,
    senderNormalized,
    extractedWithProducts as ExtractedDocumentResult & Record<string, unknown>,
    sum,
    totalDoc,
    sourceDocumentPath,
  );

  const shortLink = saved
    ? await buildDraftShortLink(
        supabase,
        companyId,
        saved.draftId,
        saved.accessToken,
      )
    : "";
  const linkBlock = shortLink
    ? `\n\n🔗 Conferir e corrigir no app: ${shortLink}`
    : "";
  const prodHint = matchResult.requiresProductConfirmation
    ? " Há itens para vincular a produtos."
    : "";

  await sendWhatsapp(
    senderNormalized,
    withFaroFlowFooter(
      `Encontrei divergência entre o *total da nota* (${formatMoneyBrl(totalDoc)}) e a *soma dos itens identificados* (${formatMoneyBrl(sum)}).${prodHint}${linkBlock}\n\nOu responda com *cancelar* para cancelar o registro.`,
      "registro",
    ),
    "despesa_whatsapp_divergencia",
    flowId,
  );
}

/** Usuário voltou aos comandos de recebimento — descarta rascunho e deixa o fluxo de lista/menu. */
function shouldClearDraftForRecebimentoFlow(text: string): boolean {
  const t = text.trim();
  const oneWord = t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (oneWord === "lista" || oneWord === "comandos") return true;
  const phrase = t
    .replace(/^\*+|\*+$/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
  if (phrase === "contas a pagar") return true;
  if (/^\d{1,2}$/.test(t.trim())) return true;
  return false;
}

/** Interpreta resposta quando há rascunho pendente. Retorna true se consumiu a mensagem. */
export async function tryHandleExpenseDraftReply(
  supabase: Supabase,
  text: string,
  companyId: string,
  senderNormalized: string,
  sendWhatsapp: (
    phone: string,
    message: string,
    ctx: string,
    flowId?: string,
  ) => Promise<unknown>,
  flowId: string,
): Promise<boolean> {
  const draft = await loadPendingDraft(supabase, companyId, senderNormalized);
  if (!draft) return false;

  if (shouldClearDraftForRecebimentoFlow(text)) {
    await deleteDraft(supabase, draft.id);
    return false;
  }

  const cmd = normalizeDraftCommand(text);
  const extracted = draft.extracted_json as DraftPayload;

  if (extracted._pendingQuoteConfirmation) {
    const cancelQ =
      cmd === "cancelar" || cmd === "nao" || cmd === "não" || cmd === "3";
    const yes =
      cmd === "sim" ||
      cmd === "si" ||
      cmd === "s" ||
      cmd === "confirmo" ||
      cmd === "quero" ||
      cmd === "ok";
    if (cancelQ) {
      await deleteDraft(supabase, draft.id);
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(
          "Ok, não registrei a despesa. Envie outra nota quando quiser.",
        ),
        "despesa_whatsapp_cancelada_orcamento",
        flowId,
      );
      return true;
    }
    if (yes) {
      await deleteDraft(supabase, draft.id);
      const items = (extracted.items ?? []) as ItemWithProductMatch[];
      const baseData: ExtractedDocumentResult = {
        validDocument: extracted.validDocument,
        invalidReason: extracted.invalidReason,
        documentKind: extracted.documentKind,
        supplierName: extracted.supplierName,
        supplierDocument: extracted.supplierDocument,
        invoiceNumber: extracted.invoiceNumber,
        invoiceSeries: extracted.invoiceSeries,
        totalAmount: extracted.totalAmount,
        items: extracted.items,
        notes: extracted.notes,
        likelyNotEffectivePurchase: extracted.likelyNotEffectivePurchase,
        likelyNotPurchaseReason: extracted.likelyNotPurchaseReason,
      };
      await processMatchedExpenseFlow(
        supabase,
        companyId,
        senderNormalized,
        baseData,
        {
          items,
          requiresProductConfirmation:
            extracted._pendingQuoteMatchRequiresProductConfirmation ?? false,
        },
        sendWhatsapp,
        flowId,
        draft.source_document_path ?? null,
        { quoteUserConfirmed: true },
      );
      return true;
    }
    await sendWhatsapp(
      senderNormalized,
      "Responda *sim* para lançar como despesa ou *não* (ou *cancelar*) para desistir.",
      "despesa_whatsapp_lembrete_orcamento",
      flowId,
    );
    return true;
  }

  const items = (extracted.items ?? []) as ItemWithProductMatch[];
  const totalDoc = Number(extracted.totalAmount ?? 0);
  const sum = sumItems(items);

  const cancel =
    cmd === "cancelar" || cmd === "nao" || cmd === "não" || cmd === "3";
  const useTotal =
    cmd === "1" ||
    cmd === "usar total" ||
    cmd === "usar total da nota" ||
    cmd === "confirmar total" ||
    cmd === "total nota";
  const useSum =
    cmd === "2" ||
    cmd === "somar itens" ||
    cmd === "soma itens" ||
    cmd === "usar soma";

  if (cancel) {
    await deleteDraft(supabase, draft.id);
    await sendWhatsapp(
      senderNormalized,
      withFaroFlowFooter(
        "Ok, cancelamos a inclusão dessa despesa. Envie outra foto ou texto quando quiser.",
      ),
      "despesa_whatsapp_cancelada",
      flowId,
    );
    return true;
  }

  if (extracted._requiresProductConfirmation) {
    const linkRem = await buildDraftShortLink(
      supabase,
      companyId,
      draft.id,
      draft.access_token,
    );
    const linkBlock = linkRem ? `\n\n🔗 Conferir no app: ${linkRem}` : "";
    await sendWhatsapp(
      senderNormalized,
      `Alguns itens não foram reconhecidos automaticamente na lista de produtos.\n\nConfirme o vínculo dos itens com seus produtos no link antes de registrar a despesa.${linkBlock}`,
      "despesa_whatsapp_produtos_pendentes",
      flowId,
    );
    return true;
  }

  if (useTotal && totalDoc > 0 && items.length > 0) {
    const scaled = scaleItemsToTotal(items, totalDoc);
    const outcome = await insertExpense(
      supabase,
      companyId,
      extracted,
      scaled,
      draft.source_document_path ?? null,
      senderNormalized,
    );
    if (outcome.status === "ok") {
      await deleteDraft(supabase, draft.id);
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(
          `Despesa registrada usando o *total da nota* (${formatMoneyBrl(totalDoc)}). Abra o Faro para revisar e aprovar.`,
          "registro",
        ),
        "despesa_whatsapp_ok_total",
        flowId,
      );
    } else if (outcome.status === "duplicate") {
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(WHATSAPP_MSG_NOTA_DUPLICADA, "registro"),
        "despesa_whatsapp_duplicada",
        flowId,
      );
    } else {
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(
          "Não foi possível salvar a despesa. Tente pelo app ou envie de novo.",
        ),
        "despesa_whatsapp_erro_insert",
        flowId,
      );
    }
    return true;
  }

  if (useSum && items.length > 0) {
    const outcome = await insertExpense(
      supabase,
      companyId,
      extracted,
      items,
      draft.source_document_path ?? null,
      senderNormalized,
    );
    if (outcome.status === "ok") {
      await deleteDraft(supabase, draft.id);
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(
          `Despesa registrada usando a *soma dos itens* (${formatMoneyBrl(sum)}). Abra o Faro para revisar e aprovar.`,
          "registro",
        ),
        "despesa_whatsapp_ok_soma",
        flowId,
      );
    } else if (outcome.status === "duplicate") {
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(WHATSAPP_MSG_NOTA_DUPLICADA, "registro"),
        "despesa_whatsapp_duplicada",
        flowId,
      );
    } else {
      await sendWhatsapp(
        senderNormalized,
        withFaroFlowFooter(
          "Não foi possível salvar a despesa. Tente pelo app ou envie de novo.",
        ),
        "despesa_whatsapp_erro_insert",
        flowId,
      );
    }
    return true;
  }

  const linkRem = await buildDraftShortLink(
    supabase,
    companyId,
    draft.id,
    draft.access_token,
  );
  const linkBlock = linkRem ? `\n\n🔗 Conferir no app: ${linkRem}` : "";
  await sendWhatsapp(
    senderNormalized,
    `Você tem uma despesa pendente de confirmação (total ${formatMoneyBrl(totalDoc)} × soma ${formatMoneyBrl(sum)}).${linkBlock}\n\nResponda:\n*1* — Usar o total da nota e ajustar os itens\n*2* — Usar a soma dos itens\n*cancelar* — Não registrar`,
    "despesa_whatsapp_lembrete_draft",
    flowId,
  );
  return true;
}

const MIN_TEXT_LEN = 40;

function extractImageUrl(payload: Record<string, unknown>): string | null {
  const img = payload.image as Record<string, unknown> | undefined;
  if (img && typeof img.imageUrl === "string" && img.imageUrl.trim()) {
    return img.imageUrl.trim();
  }
  if (img && typeof img.url === "string" && img.url.trim()) {
    return img.url.trim();
  }
  return null;
}

/** PDF enviado como documento (Z-API: document.documentUrl, mime application/pdf). */
function extractPdfDocumentUrl(
  payload: Record<string, unknown>,
): string | null {
  const doc = payload.document as Record<string, unknown> | undefined;
  if (!doc) return null;
  const u =
    (typeof doc.documentUrl === "string" && doc.documentUrl.trim()) ||
    (typeof doc.url === "string" && doc.url.trim()) ||
    "";
  if (!u) return null;
  const mime = String(doc.mimeType ?? "").toLowerCase();
  const name = String(doc.fileName ?? doc.title ?? "").toLowerCase();
  const looksPdf =
    mime.includes("pdf") || name.endsWith(".pdf") || /\.pdf(\?|#|$)/i.test(u);
  if (!looksPdf) return null;
  return u;
}

export function hasImageInPayload(payload: Record<string, unknown>): boolean {
  return (
    extractImageUrl(payload) !== null || extractPdfDocumentUrl(payload) !== null
  );
}

/**
 * Garante processamento único por messageId do webhook (evita 2x "despesa registrada").
 * Sem messageId, assume primeira entrega e processa.
 */
async function tryClaimInboundMessageId(
  supabase: Supabase,
  companyId: string,
  messageId: string | null,
): Promise<boolean> {
  if (!messageId?.trim()) return true;
  const { error } = await supabase.from("whatsapp_inbound_processed").insert({
    company_id: companyId,
    message_id: messageId.trim(),
  });
  if (!error) return true;
  const code = String((error as { code?: string }).code ?? "");
  if (code === "23505" || (error.message ?? "").includes("duplicate key")) {
    console.log("[whatsappExpenseFlow] webhook duplicado, ignorando", {
      messageId: messageId.trim(),
    });
    return false;
  }
  console.error("[whatsappExpenseFlow] dedup insert:", error.message);
  return true;
}

/** Processa imagem, PDF ou texto longo (não comando). */
export async function tryHandleIncomingExpenseDocument(
  supabase: Supabase,
  payload: Record<string, unknown>,
  auth: { companyId: string; senderNormalized: string },
  extractTextMessage: (p: Record<string, unknown>) => string | null,
  sendWhatsapp: (
    phone: string,
    message: string,
    ctx: string,
    flowId?: string,
  ) => Promise<unknown>,
  flowId: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    return false;
  }

  const imageUrl = extractImageUrl(payload);
  const pdfUrl = extractPdfDocumentUrl(payload);
  const text = extractTextMessage(payload as never);

  if (!imageUrl && !pdfUrl && (!text || text.length < MIN_TEXT_LEN)) {
    return false;
  }

  /** Evita processar comandos conhecidos como despesa */
  const tLow = (text ?? "").trim().toLowerCase();
  if (
    !imageUrl &&
    !pdfUrl &&
    (tLow === "lista" ||
      tLow === "comandos" ||
      tLow === "contas a pagar" ||
      /^\d{1,2}$/.test(tLow))
  ) {
    return false;
  }

  const messageId =
    typeof payload.messageId === "string" && payload.messageId.trim()
      ? payload.messageId.trim()
      : null;
  const claimed = await tryClaimInboundMessageId(
    supabase,
    auth.companyId,
    messageId,
  );
  if (!claimed) {
    return false;
  }

  let sourceDocumentPath: string | null = null;
  let imageDataUrlForAi: string | undefined;

  if (imageUrl) {
    const rawFetch = await fetchZApiMediaBytes(
      imageUrl,
      "image/*,application/octet-stream;q=0.8,*/*;q=0.5",
    );
    if (rawFetch.ok) {
      try {
        const opt = await optimizeExpenseImage(rawFetch.buf);
        const key = `${auth.companyId}/whatsapp-incoming/${
          messageId ?? crypto.randomUUID()
        }.jpg`;
        const { error: stErr } = await supabase.storage
          .from("expense-documents")
          .upload(key, opt.bytes, {
            contentType: "image/jpeg",
            upsert: true,
          });
        if (!stErr) {
          sourceDocumentPath = key;
          imageDataUrlForAi = bytesToImageDataUrlSafe(opt.bytes, "image/jpeg");
        }
      } catch (e) {
        console.error("[whatsappExpenseFlow] optimize/upload imagem:", e);
      }
    }
  } else if (pdfUrl) {
    const rawPdf = await fetchZApiMediaBytes(
      pdfUrl,
      "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    );
    if (rawPdf.ok && rawPdf.buf.length >= 5) {
      const head = new TextDecoder().decode(rawPdf.buf.subarray(0, 5));
      if (head === "%PDF-") {
        const key = `${auth.companyId}/whatsapp-incoming/${
          messageId ?? crypto.randomUUID()
        }.pdf`;
        const { error: stErr } = await supabase.storage
          .from("expense-documents")
          .upload(key, rawPdf.buf, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (!stErr) sourceDocumentPath = key;
      }
    }
  }

  if (imageUrl) {
    await sendWhatsapp(
      auth.senderNormalized,
      "Recebi sua imagem. Estou lendo o documento — aguarde um instante.",
      "despesa_whatsapp_processando",
      flowId,
    );
  } else if (pdfUrl) {
    await sendWhatsapp(
      auth.senderNormalized,
      "Recebi seu PDF. Estou lendo o documento — aguarde um instante.",
      "despesa_whatsapp_processando_pdf",
      flowId,
    );
  }

  try {
    let result: Awaited<ReturnType<typeof extractDocumentWithOpenAI>>;
    if (imageUrl) {
      result = await extractDocumentWithOpenAI({
        apiKey,
        mode: "image",
        imageUrl: imageDataUrlForAi ? undefined : imageUrl,
        imageDataUrl: imageDataUrlForAi,
      });
    } else if (pdfUrl) {
      result = await extractDocumentWithOpenAI({
        apiKey,
        mode: "pdf",
        documentUrl: pdfUrl,
      });
    } else {
      result = await extractDocumentWithOpenAI({
        apiKey,
        mode: "text",
        text: text!,
      });
    }

    if (!result.ok) {
      await sendWhatsapp(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Não consegui ler o documento agora. Tente de novo em instantes.",
        ),
        "despesa_openai_erro",
        flowId,
      );
      return true;
    }

    const data = result.data;

    if (!data.validDocument) {
      const reason =
        data.invalidReason?.trim() ||
        "Não identifiquei um documento legível (compra, fatura ou conta a receber).";
      await sendWhatsapp(
        auth.senderNormalized,
        withFaroFlowFooter(
          `${reason}\n\nSe for foto: mais luz, enquadre o documento inteiro e evite reflexo. Se for PDF, envie o arquivo completo. Se for texto, descreva valores e vencimento com clareza.`,
        ),
        "despesa_whatsapp_invalida",
        flowId,
      );
      return true;
    }

    const intent = data.businessIntent ?? "compra_insumos";

    if (intent === "conta_pagar" || intent === "conta_receber") {
      const totalDoc = Number(data.totalAmount ?? 0);
      if (!Number.isFinite(totalDoc) || totalDoc <= 0) {
        await sendWhatsapp(
          auth.senderNormalized,
          withFaroFlowFooter(
            "Identifiquei um possível lançamento de fluxo de caixa, mas não consegui ler o *valor total*. Envie outra imagem ou descreva o valor (ex.: R$ 150,00).",
          ),
          "whatsapp_fluxo_sem_valor",
          flowId,
        );
        return true;
      }
      const flowDb = intent === "conta_pagar" ? "payable" : "receivable";
      const ins = await insertBoletoFromWhatsappCashflow(
        supabase,
        auth.companyId,
        data,
        flowDb,
      );
      if (!ins.ok) {
        await sendWhatsapp(
          auth.senderNormalized,
          withFaroFlowFooter(
            "Não consegui registrar no Fluxo de caixa. Abra o Faro em *Fluxo de caixa* e cadastre manualmente.",
          ),
          "whatsapp_fluxo_erro_insert",
          flowId,
        );
        return true;
      }
      const dueLabel = formatDueBr(ins.dueDateIso);
      const dir = intent === "conta_pagar" ? "pagar" : "receber";
      await sendWhatsapp(
        auth.senderNormalized,
        withFaroFlowFooter(
          `Conta a *${dir}* registrada: ${formatMoneyBrl(totalDoc)} · venc. *${dueLabel}*. Veja em *Fluxo de caixa* no Faro.`,
          "registro",
        ),
        "whatsapp_fluxo_caixa_ok",
        flowId,
      );
      return true;
    }

    const items = data.items ?? [];
    const totalDoc = Number(data.totalAmount ?? 0);
    if (items.length === 0 || totalDoc <= 0) {
      await sendWhatsapp(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Identifiquei o documento, mas faltam itens ou total. Envie outra foto/PDF ou complete o texto.",
        ),
        "despesa_whatsapp_incompleto",
        flowId,
      );
      return true;
    }

    const { supplierId: waSupplierId } = await ensureSupplierFromExtracted(
      supabase,
      auth.companyId,
      data,
    );
    const matchOpts = await getDefaultCatalogMatchingOpts(
      supabase,
      auth.companyId,
      "WHATSAPP_INTERACTIVE",
      { supplierId: waSupplierId },
    );
    const matchResult = await resolveProductMatches(
      supabase,
      auth.companyId,
      items,
      matchOpts,
    );
    await processMatchedExpenseFlow(
      supabase,
      auth.companyId,
      auth.senderNormalized,
      data,
      matchResult,
      sendWhatsapp,
      flowId,
      sourceDocumentPath,
    );
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      "[whatsappExpenseFlow] falha inesperada ao processar documento:",
      msg,
      e,
    );
    try {
      await sendWhatsapp(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Não consegui concluir a leitura da nota agora. Tente de novo em instantes ou cadastre pelo app.",
        ),
        "despesa_whatsapp_excecao",
        flowId,
      );
    } catch (sendErr) {
      console.error(
        "[whatsappExpenseFlow] ao enviar mensagem de erro (Z-API):",
        sendErr,
      );
    }
    return true;
  }
}

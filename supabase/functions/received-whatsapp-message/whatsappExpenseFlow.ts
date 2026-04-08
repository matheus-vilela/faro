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
  scaleItemsToTotal,
  sumItems,
  totalsMatch,
} from "../_shared/openaiExpense.ts";
import { bytesToImageDataUrlSafe, optimizeExpenseImage } from "../_shared/optimizeExpenseImage.ts";
import { fetchZApiMediaBytes } from "../_shared/zapiMedia.ts";
import {
  type ItemWithProductMatch,
  resolveProductMatches,
  upsertProductInvoiceAlias,
} from "./productMatch.ts";
import { withFaroFlowFooter } from "./whatsappFlowFooter.ts";

type Supabase = ReturnType<typeof createClient>;

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
  draftId: string,
  accessToken: string | null | undefined,
): Promise<string> {
  const base = publicAppAbsoluteBase();
  if (!base || !accessToken) return "";
  const slug = await ensureWhatsappExpenseDraftShortSlug(
    supabase,
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
): Promise<string | null> {
  const type = mapDocumentKindToExpenseType(extracted.documentKind);
  const taxIdDigits = extractTaxIdDigits(extracted);
  const supplierId = await ensureSupplierFromExtracted(
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
  const { data: exp, error: e1 } = await supabase
    .from("expenses")
    .insert({
      company_id: companyId,
      created_by: null,
      type,
      invoice_number: extracted.invoiceNumber,
      invoice_series: invoiceSeries,
      supplier_id: supplierId,
      supplier_name:
        (extracted.supplierName ?? "").trim() || "Fornecedor (WhatsApp)",
      supplier_document: supplierDocumentRow,
      status: "pending",
      expense_source: "whatsapp",
      notes:
        [extracted.notes, "Importado via WhatsApp"]
          .filter(Boolean)
          .join(" — ") || "Importado via WhatsApp",
      whatsapp_sender_phone_normalized: whatsappSenderNormalized,
    })
    .select("id")
    .single();

  if (e1 || !exp) {
    console.error("[whatsappExpenseFlow] insert expense:", e1?.message);
    return null;
  }

  const expenseId = exp.id as string;
  for (const it of items) {
    const q = Math.max(0.0001, Number(it.quantity));
    const uv = Math.round(Number(it.unitValue) * 10000) / 10000;
    const row: Record<string, unknown> = {
      expense_id: expenseId,
      product_name: (it.productName ?? "").trim() || "Item",
      quantity: q,
      unit_value: uv,
    };
    if (it.productId) {
      row.product_id = it.productId;
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
  return expenseId;
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
      const id = await insertExpense(
        supabase,
        companyId,
        working,
        matchItems,
        sourceDocumentPath,
        senderNormalized,
      );
      if (id) {
        await sendWhatsapp(
          senderNormalized,
          withFaroFlowFooter(
            `Despesa registrada (${formatMoneyBrl(totalDoc)}). Os itens batem com o total. Abra o Faro para revisar.`,
            "registro",
          ),
          "despesa_whatsapp_ok",
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
      ? await buildDraftShortLink(supabase, saved.draftId, saved.accessToken)
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
    ? await buildDraftShortLink(supabase, saved.draftId, saved.accessToken)
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
    const id = await insertExpense(
      supabase,
      companyId,
      extracted,
      scaled,
      draft.source_document_path ?? null,
      senderNormalized,
    );
    if (id) {
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
    const id = await insertExpense(
      supabase,
      companyId,
      extracted,
      items,
      draft.source_document_path ?? null,
      senderNormalized,
    );
    if (id) {
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
      "Não identifiquei um documento de compra legível.";
    await sendWhatsapp(
      auth.senderNormalized,
      withFaroFlowFooter(
        `${reason}\n\nSe for foto: mais luz, enquadre o documento inteiro e evite reflexo. Se for PDF, confira se é a nota completa. Se for texto, descreva fornecedor, itens e valores com clareza.`,
      ),
      "despesa_whatsapp_invalida",
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

  const matchResult = await resolveProductMatches(
    supabase,
    auth.companyId,
    items,
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
}

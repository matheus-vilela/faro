import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  type ExtractedDocumentResult,
  type ExtractedExpenseItem,
  extractDocumentWithOpenAI,
  mapDocumentKindToExpenseType,
  scaleItemsToTotal,
  sumItems,
  totalsMatch,
} from "./openaiExpense.ts";
import {
  type ItemWithProductMatch,
  resolveProductMatches,
  upsertProductInvoiceAlias,
} from "./productMatch.ts";

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

function formatDraftShortLink(accessToken: string | null | undefined): string {
  const base = publicAppAbsoluteBase();
  if (!base || !accessToken) return "";
  return `${base}/w/${accessToken}`;
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
} | null> {
  const { data, error } = await supabase
    .from("whatsapp_expense_drafts")
    .select("id, extracted_json, access_token")
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
  } | null;
}

export async function deleteDraft(supabase: Supabase, draftId: string) {
  await supabase.from("whatsapp_expense_drafts").delete().eq("id", draftId);
}

/** Apenas dígitos; aceita número vindo do JSON. */
function normalizeDocumentDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * CPF (11) ou CNPJ (14) a partir de supplierDocument, notes ou nome (OCR costuma
 * colocar CNPJ só no rodapé ou o modelo devolve snake_case/número errado).
 */
function extractTaxIdDigits(extracted: ExtractedDocumentResult): string | null {
  const blocks: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && String(v).trim()) blocks.push(String(v));
  };
  push(extracted.supplierDocument);
  push(extracted.notes);
  push(extracted.supplierName);

  const pickFromDigits = (d: string): string | null => {
    let x = d.replace(/\D/g, "");
    if (x.length === 11 || x.length === 14) return x;
    if (x.length > 14) {
      x = x.slice(-14);
      return x.length === 14 ? x : null;
    }
    return null;
  };

  for (const b of blocks) {
    const n = pickFromDigits(b);
    if (n) return n;
  }

  const all = blocks.join(" ").replace(/\D/g, "");
  if (all.length >= 14) return all.slice(-14);
  if (all.length === 11) return all;
  return null;
}

/** Garante supplierDocument no JSON persistido para o link /w e finalize RPC. */
function enrichExtractedWithTaxId(
  extracted: ExtractedDocumentResult,
): ExtractedDocumentResult {
  const digits = extractTaxIdDigits(extracted);
  if (!digits) return extracted;
  const cur = normalizeDocumentDigits(extracted.supplierDocument);
  if (cur === digits) return extracted;
  return { ...extracted, supplierDocument: digits };
}

export async function saveDraft(
  supabase: Supabase,
  companyId: string,
  senderNormalized: string,
  extracted: ExtractedDocumentResult,
  sumItemsVal: number,
  totalDoc: number,
): Promise<string | null> {
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
    })
    .select("access_token")
    .single();

  if (error) {
    console.error("[whatsappExpenseFlow] saveDraft insert:", error.message);
    return null;
  }
  return (data?.access_token as string | undefined) ?? null;
}

/**
 * Se houver CPF/CNPJ na extração, localiza fornecedor pelo documento (normalizado)
 * ou cria um com nome e documento. Retorna null se não houver documento válido.
 */
async function ensureSupplierFromExtracted(
  supabase: Supabase,
  companyId: string,
  extracted: ExtractedDocumentResult,
): Promise<string | null> {
  const digits = extractTaxIdDigits(extracted);
  if (!digits || (digits.length !== 11 && digits.length !== 14)) return null;

  const { data: rows, error } = await supabase
    .from("suppliers")
    .select("id, document")
    .eq("company_id", companyId);

  if (error) {
    console.error("[whatsappExpenseFlow] suppliers list:", error.message);
    return null;
  }

  const norm = (d: string | null | undefined) => normalizeDocumentDigits(d);
  const found = rows?.find((r) => norm(r.document) === digits);
  if (found) return found.id as string;

  const name = (extracted.supplierName ?? "").trim() || "Fornecedor (WhatsApp)";
  const { data: inserted, error: insErr } = await supabase
    .from("suppliers")
    .insert({
      company_id: companyId,
      name,
      document: digits,
      notes: "Cadastrado automaticamente — importação WhatsApp",
    })
    .select("id")
    .single();

  if (insErr) {
    console.error("[whatsappExpenseFlow] insert supplier:", insErr.message);
    return null;
  }
  return (inserted?.id as string) ?? null;
}

async function insertExpense(
  supabase: Supabase,
  companyId: string,
  extracted: ExtractedDocumentResult,
  items: ItemWithProductMatch[],
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
      notes:
        [extracted.notes, "Importado via WhatsApp"]
          .filter(Boolean)
          .join(" — ") || "Importado via WhatsApp",
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
  return expenseId;
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
  const extracted = draft.extracted_json as ExtractedDocumentResult & {
    _requiresProductConfirmation?: boolean;
  };
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
      "Ok, cancelamos a inclusão dessa despesa. Envie outra foto ou texto quando quiser.",
      "despesa_whatsapp_cancelada",
      flowId,
    );
    return true;
  }

  if (extracted._requiresProductConfirmation) {
    const linkRem = formatDraftShortLink(draft.access_token);
    const linkBlock = linkRem ? `\n\n🔗 Conferir no app: ${linkRem}` : "";
    await sendWhatsapp(
      senderNormalized,
      `Confirme o vínculo dos itens com seus produtos no link antes de registrar a despesa.${linkBlock}`,
      "despesa_whatsapp_produtos_pendentes",
      flowId,
    );
    return true;
  }

  if (useTotal && totalDoc > 0 && items.length > 0) {
    const scaled = scaleItemsToTotal(items, totalDoc);
    const id = await insertExpense(supabase, companyId, extracted, scaled);
    if (id) {
      await deleteDraft(supabase, draft.id);
      await sendWhatsapp(
        senderNormalized,
        `Despesa registrada usando o *total da nota* (${formatMoneyBrl(totalDoc)}). Abra o Faro para revisar e aprovar.`,
        "despesa_whatsapp_ok_total",
        flowId,
      );
    } else {
      await sendWhatsapp(
        senderNormalized,
        "Não foi possível salvar a despesa. Tente pelo app ou envie de novo.",
        "despesa_whatsapp_erro_insert",
        flowId,
      );
    }
    return true;
  }

  if (useSum && items.length > 0) {
    const id = await insertExpense(supabase, companyId, extracted, items);
    if (id) {
      await deleteDraft(supabase, draft.id);
      await sendWhatsapp(
        senderNormalized,
        `Despesa registrada usando a *soma dos itens* (${formatMoneyBrl(sum)}). Abra o Faro para revisar e aprovar.`,
        "despesa_whatsapp_ok_soma",
        flowId,
      );
    } else {
      await sendWhatsapp(
        senderNormalized,
        "Não foi possível salvar a despesa. Tente pelo app ou envie de novo.",
        "despesa_whatsapp_erro_insert",
        flowId,
      );
    }
    return true;
  }

  const linkRem = formatDraftShortLink(draft.access_token);
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

type DraftPayload = ExtractedDocumentResult & {
  _requiresProductConfirmation?: boolean;
};

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

export function hasImageInPayload(payload: Record<string, unknown>): boolean {
  return extractImageUrl(payload) !== null;
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

/** Processa imagem ou texto longo (não comando). */
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
  const text = extractTextMessage(payload as never);

  if (!imageUrl && (!text || text.length < MIN_TEXT_LEN)) {
    return false;
  }

  /** Evita processar comandos conhecidos como despesa */
  const tLow = (text ?? "").trim().toLowerCase();
  if (
    !imageUrl &&
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

  if (imageUrl) {
    await sendWhatsapp(
      auth.senderNormalized,
      "Recebi sua imagem. Estou lendo o documento — aguarde um instante.",
      "despesa_whatsapp_processando",
      flowId,
    );
  }

  let result: Awaited<ReturnType<typeof extractDocumentWithOpenAI>>;
  if (imageUrl) {
    result = await extractDocumentWithOpenAI({
      apiKey,
      mode: "image",
      imageUrl,
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
      "Não consegui ler o documento agora. Tente de novo em instantes.",
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
      `${reason}\n\nSe for foto: envie com mais luz, enquadre o papel inteiro e evite reflexo. Se for texto, descreva fornecedor, itens e valores com clareza.`,
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
      "Identifiquei o documento, mas faltam itens ou total. Tente outra foto ou complete o texto.",
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
  const sum = sumItems(matchResult.items);

  if (totalsMatch(totalDoc, sum)) {
    if (!matchResult.requiresProductConfirmation) {
      const id = await insertExpense(
        supabase,
        auth.companyId,
        data,
        matchResult.items,
      );
      if (id) {
        await sendWhatsapp(
          auth.senderNormalized,
          `Despesa registrada (${formatMoneyBrl(totalDoc)}). Os itens batem com o total. Abra o Faro para revisar.`,
          "despesa_whatsapp_ok",
          flowId,
        );
      } else {
        await sendWhatsapp(
          auth.senderNormalized,
          "Extraí os dados, mas não consegui salvar. Tente pelo app.",
          "despesa_whatsapp_erro_insert",
          flowId,
        );
      }
      return true;
    }

    const extractedPayload: DraftPayload = {
      ...data,
      items: matchResult.items,
      _requiresProductConfirmation: true,
    };
    const accessToken = await saveDraft(
      supabase,
      auth.companyId,
      auth.senderNormalized,
      extractedPayload,
      sum,
      totalDoc,
    );
    const shortLink = formatDraftShortLink(accessToken);
    const linkBlock = shortLink
      ? `\n\n🔗 Conferir produtos: ${shortLink}`
      : "";
    await sendWhatsapp(
      auth.senderNormalized,
      `Reconheci a nota (${formatMoneyBrl(totalDoc)}). Confirme o vínculo dos itens com seus produtos cadastrados no link.${linkBlock}`,
      "despesa_whatsapp_produtos_pendentes",
      flowId,
    );
    return true;
  }

  const extractedWithProducts: DraftPayload = {
    ...data,
    items: matchResult.items,
    _requiresProductConfirmation: matchResult.requiresProductConfirmation,
  };
  const accessToken = await saveDraft(
    supabase,
    auth.companyId,
    auth.senderNormalized,
    extractedWithProducts,
    sum,
    totalDoc,
  );

  const shortLink = formatDraftShortLink(accessToken);
  const linkBlock = shortLink
    ? `\n\n🔗 Conferir e corrigir no app: ${shortLink}`
    : "";
  const prodHint = matchResult.requiresProductConfirmation
    ? " Há itens para vincular a produtos."
    : "";

  await sendWhatsapp(
    auth.senderNormalized,
    `Encontrei divergência entre o *total da nota* (${formatMoneyBrl(totalDoc)}) e a *soma dos itens* (${formatMoneyBrl(sum)}).${prodHint}${linkBlock}\n\nOu responda com *cancelar* para cancelar o registro.`,
    "despesa_whatsapp_divergencia",
    flowId,
  );
  return true;
}

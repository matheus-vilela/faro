/**
 * Extração estruturada de nota/cupom/romaneio/recibo via OpenAI (texto, imagem ou PDF).
 */
import { fetchZApiMediaBytes } from "./zapiMedia.ts";

export type ExtractedExpenseItem = {
  productName: string;
  quantity: number;
  unitValue: number;
  lineTotal: number;
  /** Unidade comercial (NF-e: uCom) quando identificável. */
  unitCommercial?: string | null;
  /** Unidade tributável (NF-e: uTrib) quando diferente da comercial. */
  unitTax?: string | null;
  /** NCM da linha, se houver. */
  ncm?: string | null;
  /** EAN / código de barras do item, se houver. */
  ean?: string | null;
};

/** Compra com itens (despesa) vs lançamento direto no fluxo de caixa (sem vínculo com despesa). */
export type BusinessIntent =
  | "compra_insumos"
  | "conta_pagar"
  | "conta_receber";

export type ExtractedDocumentResult = {
  validDocument: boolean;
  invalidReason?: string;
  documentKind:
    | "nota_fiscal"
    | "cupom_fiscal"
    | "romaneio"
    | "recibo"
    | "outro"
    | null;
  supplierName: string | null;
  supplierDocument: string | null;
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  totalAmount: number | null;
  items: ExtractedExpenseItem[];
  notes: string | null;
  likelyNotEffectivePurchase?: boolean;
  likelyNotPurchaseReason?: string | null;
  /**
   * compra_insumos = nota/romaneio de compra para estoque (fluxo Despesas).
   * conta_pagar = fatura cartão, boleto, conta de consumo, filipeta — saída de caixa.
   * conta_receber = cobrança a receber, duplicata, recebimento de cliente — entrada.
   */
  businessIntent?: BusinessIntent | null;
  /** Vencimento para conta a pagar/receber (YYYY-MM-DD ou DD/MM/AAAA). */
  dueDate?: string | null;
  /** Título curto para o lançamento no fluxo de caixa (ex.: "Fatura Nubank 03/26"). */
  boletoTitle?: string | null;
};

const SYSTEM_PROMPT = `Você é um assistente que analisa documentos financeiros brasileiros: compras (nota fiscal, cupom, romaneio), contas a pagar (fatura de cartão, boleto, conta de luz/água, filipeta, DDA, comprovante de cobrança) e contas a receber (cobrança emitida pela empresa, duplicata, borderô de recebíveis, PIX/TED a receber), ou texto que descreva um desses casos.

Responda APENAS um JSON válido (sem markdown), com esta estrutura exata:
{
  "validDocument": boolean,
  "invalidReason": string ou null,
  "documentKind": "nota_fiscal" | "cupom_fiscal" | "romaneio" | "recibo" | "outro" | null,
  "businessIntent": "compra_insumos" | "conta_pagar" | "conta_receber",
  "supplierName": string ou null,
  "supplierDocument": string ou null (CNPJ/CPF só dígitos se visível),
  "invoiceNumber": string ou null (número do documento; em cupom fiscal/NFC-e costuma aparecer em frente ou ao lado do texto "NFC-e"),
  "invoiceSeries": string ou null (série da NF-e ou NFC-e quando impressa, ex. "1", "2"; null se não houver),
  "totalAmount": number ou null (valor TOTAL em BRL: total da fatura, do boleto, ou a pagar/receber),
  "dueDate": string ou null (data de vencimento ou pagamento em AAAA-MM-DD; se só houver DD/MM/AAAA, converta para AAAA-MM-DD),
  "boletoTitle": string ou null (título curto para identificar o lançamento, ex.: "Fatura cartão Visa — mar/26"),
  "items": [ { "productName": string, "quantity": number, "unitValue": number, "lineTotal": number, "unitCommercial": string ou null, "unitTax": string ou null, "ncm": string ou null, "ean": string ou null } ],
  "notes": string ou null,
  "likelyNotEffectivePurchase": boolean,
  "likelyNotPurchaseReason": string ou null
}

Regras para businessIntent:
- "compra_insumos": nota/romaneio/cupom de COMPRA de mercadorias com linhas de produto para controle de estoque, ou texto pedindo lançar compra com itens. É o padrão quando o documento lista produtos/serviços detalhados para essa finalidade.
- "conta_pagar": fatura de cartão de crédito, boleto bancário ou concessionária, segunda via, filipeta, resumo de fatura, "total a pagar", conta de consumo — dinheiro que SAI (empresa paga). Pode não ter tabela de produtos; use items vazio ou um único item sintético com lineTotal = totalAmount se precisar.
- "conta_receber": cobrança a favor da empresa, duplicata, nota de venda a receber, PIX recebido a classificar como entrada esperada, borderô — dinheiro que ENTRA. Pode não ter linhas de produto de estoque.

Se o documento for claramente só fluxo de caixa (pagar/receber) e não compra para estoque, use conta_pagar ou conta_receber. Em dúvida entre compra e conta a pagar, prefira compra_insumos quando houver várias linhas de produtos de revenda/insumo.

Regras:
- likelyNotEffectivePurchase = true quando o documento for claramente orçamento, proposta comercial, pedido de cotação, simulação, pedido de compra ainda não faturado, ou similar SEM evidência de nota fiscal/cupom de venda concluída; descreva em likelyNotPurchaseReason em português (curto, uma frase). Para businessIntent conta_pagar ou conta_receber, geralmente false.
- likelyNotEffectivePurchase = false para NF-e, NFC-e, cupom fiscal emitido, romaneio de entrega, recibo de pagamento, fatura de cartão, boleto, ou compra claramente concluída.
- validDocument = true para compra_insumos se for documento de compra com itens e valores coerentes OU texto com isso.
- validDocument = true para conta_pagar ou conta_receber se houver totalAmount > 0 e o documento (ou texto) indicar claramente um pagamento/recebimento (mesmo sem linhas de produto); preencha dueDate e boletoTitle quando possível.
- validDocument = false somente se ilegível, irrelevante ou sem valor nem contexto.
- Se for foto ou PDF ilegível, borrado, sem contexto de compra, ou não for documento: validDocument = false e invalidReason explicando em português (curto).
- Itens: lineTotal deve ser quantity * unitValue (aproximado). Use ponto como decimal nos números JSON.
- Quando o documento mostrar unidade de medida por linha (kg, un, cx, etc.), preencha unitCommercial; se houver unidade tributável explícita diferente, preencha unitTax; caso contrário null.
- ncm: somente dígitos do NCM da linha, se visível; ean: código de barras/EAN do produto na linha, se visível.
- totalAmount é o total geral impresso no documento (ou soma explícita se só houver itens).
- Em cupom fiscal eletrônico (NFC-e), o número da nota geralmente aparece próximo ao rótulo "NFC-e"; extraia esse número em invoiceNumber e a série em invoiceSeries se visível.
- supplierDocument: use sempre string (CNPJ/CPF com ou sem máscara). Se o JSON numérico for usado para CNPJ, pode perder zeros à esquerda — prefira string.
- Se não tiver certeza que é documento de compra nem conta a pagar/receber, validDocument = false.

TABELAS, ROMANEIOS E DOCUMENTOS COM COLUNAS ALINHADAS (crítico):
- Muitos documentos são tabelas: colunas como código, descrição do produto, quantidade, valor unitário, valor total da linha, etc. Leia SEMPRE no sentido natural de leitura: da esquerda para a direita em cada linha, e de cima para baixo entre linhas.
- Cada linha de produto é uma unidade: productName, quantity, unitValue e lineTotal devem vir TODOS da MESMA linha visual do documento. É proibido associar o nome de um produto da linha i com quantidade ou valores da linha j.
- Antes de preencher um item, alinhe mentalmente as colunas (trace verticalmente): o valor unitário e o total pertencem à mesma linha que a descrição à esquerda na mesma faixa horizontal.
- Não pule linhas que sejam claramente itens de mercadoria (mesmo que a leitura OCR seja difícil); tente extrair todas as linhas de produto visíveis. Não omita linhas intermediárias. Só não duplique se for obviamente a mesma linha repetida por erro de impressão.
- Cabeçalhos, totais gerais, rodapés e linhas só com separadores não entram em "items".
- Após montar cada item, verifique coerência: lineTotal deve bater com quantity × unitValue (aceite pequenas diferenças de arredondamento, ex. centavos). Se o documento mostrar total explícito na linha, use-o em lineTotal e ajuste unitValue ou quantity de forma consistente com o texto daquela linha.
- Ordene "items" na mesma ordem em que as linhas aparecem no documento (de cima para baixo).`;

const USER_PROMPT_IMAGE = `Esta imagem pode ser nota/romaneio de compra, fatura de cartão, boleto, filipeta, ou outro documento financeiro.

Extraia um único objeto JSON conforme o sistema. Regras essenciais:
1) Percorra o bloco de itens LINHA POR LINHA, do topo ao rodapé. Para cada linha de produto, copie descrição, quantidades e valores que pertencem à MESMA linha — nunca misture células de linhas diferentes.
2) Se houver várias colunas numéricas, identifique qual é quantidade, qual é valor unitário e qual é total da linha usando o cabeçalho da tabela ou o padrão do documento; mantenha a correspondência dentro da linha.
3) Inclua todas as linhas de item que conseguir ler; não descarte linhas no meio da lista por achar que são iguais sem verificar.
4) Se a imagem não for um documento fiscal/compra legível, use validDocument: false e invalidReason em português.`;

const USER_PROMPT_PDF = `Analise este PDF (nota de compra, fatura, boleto, fatura de cartão ou conta a receber). Responda apenas com um json válido (um único objeto) conforme as instruções do sistema. Defina businessIntent: compra_insumos, conta_pagar ou conta_receber conforme o caso.

Para a lista de itens: em tabelas e romaneios, extraia linha por linha — descrição, quantidade e valores da mesma linha física; não una dados de linhas diferentes; inclua todas as linhas de produto visíveis na ordem de cima para baixo.`;

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  const t = String(v).trim();
  return t.length ? t : null;
}

const PDF_MAX_BYTES = 50 * 1024 * 1024;

function extractTextFromResponsesOutput(raw: unknown): string | null {
  const r = raw as Record<string, unknown>;
  if (typeof r.output_text === "string" && r.output_text.length > 0) {
    return r.output_text;
  }
  const out = r.output;
  if (!Array.isArray(out)) return null;
  for (const item of out) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (it.type === "message" && Array.isArray(it.content)) {
      for (const c of it.content as Array<Record<string, unknown>>) {
        if (c.type === "output_text" && typeof c.text === "string") {
          return c.text;
        }
      }
    }
  }
  return null;
}

async function fetchPdfBytesAuthenticated(
  documentUrl: string,
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; error: string }> {
  const r = await fetchZApiMediaBytes(
    documentUrl,
    "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
  );
  if (!r.ok) return r;
  const buf = r.buf;
  const sniff = new TextDecoder()
    .decode(buf.subarray(0, Math.min(80, buf.length)))
    .trimStart()
    .toLowerCase();
  if (sniff.startsWith("<!") || sniff.startsWith("<html")) {
    console.error("[openaiExpense] download retornou HTML em vez de PDF");
    return {
      ok: false,
      error:
        "Download do PDF retornou página HTML (auth?). Confira ZAPI_CLIENT_TOKEN na função.",
    };
  }
  return { ok: true, buf };
}

async function uploadPdfToOpenAI(
  apiKey: string,
  bytes: Uint8Array,
  filename: string,
): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    filename || "documento.pdf",
  );
  const up = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const raw = await up.text();
  if (!up.ok) {
    console.error("[openaiExpense] upload PDF", up.status, raw.slice(0, 400));
    return { ok: false, error: `Upload PDF: ${up.status}` };
  }
  try {
    const j = JSON.parse(raw) as { id?: string };
    if (!j.id) return { ok: false, error: "Upload PDF sem file id." };
    return { ok: true, fileId: j.id };
  } catch {
    return { ok: false, error: "Resposta upload inválida." };
  }
}

async function deleteOpenAiFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    /* ignore */
  }
}

async function runOpenAiPdfExtraction(
  apiKey: string,
  buf: Uint8Array,
  filename: string,
  model: string,
): Promise<
  { ok: true; data: ExtractedDocumentResult } | { ok: false; error: string }
> {
  let fileId: string | null = null;
  try {
    if (buf.length === 0) {
      return { ok: false, error: "PDF vazio." };
    }
    if (buf.length > PDF_MAX_BYTES) {
      return { ok: false, error: "PDF acima do limite (50 MB)." };
    }
    const head = new TextDecoder().decode(buf.subarray(0, 5));
    if (head !== "%PDF-") {
      return { ok: false, error: "Arquivo não parece ser um PDF válido." };
    }

    const up = await uploadPdfToOpenAI(apiKey, buf, filename);
    if (!up.ok) return up;
    fileId = up.fileId;

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: USER_PROMPT_PDF },
            ],
          },
        ],
        temperature: 0.1,
        text: { format: { type: "json_object" } },
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      console.error(
        "[openaiExpense] responses PDF",
        res.status,
        rawText.slice(0, 800),
      );
      return { ok: false, error: `OpenAI (PDF): ${res.status}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false, error: "Resposta OpenAI (PDF) inválida." };
    }

    const p = parsed as Record<string, unknown>;
    if (p.status === "failed" || p.status === "cancelled") {
      return { ok: false, error: "OpenAI (PDF): geração falhou." };
    }

    const content = extractTextFromResponsesOutput(parsed);
    if (!content || typeof content !== "string") {
      return { ok: false, error: "OpenAI (PDF) sem texto de saída." };
    }

    const data = safeParseJson(content);
    if (!data) {
      return { ok: false, error: "JSON da extração (PDF) inválido." };
    }

    return { ok: true, data };
  } finally {
    if (fileId) await deleteOpenAiFile(apiKey, fileId);
  }
}

async function extractDocumentFromPdfUrl(
  apiKey: string,
  documentUrl: string,
  model: string,
): Promise<
  { ok: true; data: ExtractedDocumentResult } | { ok: false; error: string }
> {
  const downloaded = await fetchPdfBytesAuthenticated(documentUrl);
  if (!downloaded.ok) {
    console.error(
      "[openaiExpense] download PDF:",
      downloaded.error,
      documentUrl.slice(0, 80),
    );
    return downloaded;
  }
  let filename = "documento.pdf";
  try {
    const path = new URL(documentUrl).pathname;
    const last = path.split("/").pop();
    if (last && /\.pdf$/i.test(last)) filename = decodeURIComponent(last);
  } catch {
    /* keep default */
  }
  return runOpenAiPdfExtraction(
    apiKey,
    downloaded.buf,
    filename,
    model,
  );
}

/** PDF já em memória (upload pelo app). */
export async function extractDocumentFromPdfBuffer(
  apiKey: string,
  buf: Uint8Array,
  filename: string,
  model: string,
): Promise<
  { ok: true; data: ExtractedDocumentResult } | { ok: false; error: string }
> {
  return runOpenAiPdfExtraction(apiKey, buf, filename || "documento.pdf", model);
}

const BUSINESS_INTENTS: readonly BusinessIntent[] = [
  "compra_insumos",
  "conta_pagar",
  "conta_receber",
];

function parseBusinessIntent(v: unknown): BusinessIntent {
  const s = typeof v === "string" ? v.trim() : "";
  if (BUSINESS_INTENTS.includes(s as BusinessIntent)) {
    return s as BusinessIntent;
  }
  return "compra_insumos";
}

/** Normaliza data de vencimento para YYYY-MM-DD ou null. */
export function normalizeExtractedDueDate(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) {
    let d = Number.parseInt(m[1]!, 10);
    let mo = Number.parseInt(m[2]!, 10);
    let y = Number.parseInt(m[3]!, 10);
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

function normalizeExtractedItem(
  row: Record<string, unknown>,
): ExtractedExpenseItem {
  const productName = String(row.productName ?? row.product_name ?? "").trim() ||
    "Item";
  const quantity = Math.max(0.0001, Number(row.quantity ?? 0));
  const unitValue = Number(row.unitValue ?? row.unit_value ?? 0);
  const lineTotal = Number(row.lineTotal ?? row.line_total ?? quantity * unitValue);
  const strOr = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t.length ? t : null;
  };
  return {
    productName,
    quantity,
    unitValue,
    lineTotal,
    unitCommercial: strOr(row.unitCommercial ?? row.unit_commercial),
    unitTax: strOr(row.unitTax ?? row.unit_tax),
    ncm: strOr(row.ncm ?? row.NCM),
    ean: strOr(row.ean ?? row.cEAN ?? row.barcode),
  };
}

function safeParseJson(s: string): ExtractedDocumentResult | null {
  try {
    const raw = JSON.parse(s) as Record<string, unknown>;
    if (typeof raw.validDocument !== "boolean") return null;
    const o = raw as unknown as ExtractedDocumentResult;
    const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
    o.items = itemsRaw.map((it) =>
      normalizeExtractedItem((it ?? {}) as Record<string, unknown>)
    );
    if (o.invoiceSeries === undefined) o.invoiceSeries = null;
    o.supplierDocument =
      strOrNull(raw.supplierDocument ?? raw.supplier_document) ??
      o.supplierDocument ??
      null;
    o.invoiceNumber =
      strOrNull(raw.invoiceNumber ?? raw.invoice_number) ??
      o.invoiceNumber ??
      null;
    o.invoiceSeries =
      strOrNull(raw.invoiceSeries ?? raw.invoice_series) ??
      o.invoiceSeries ??
      null;
    o.supplierName =
      strOrNull(raw.supplierName ?? raw.supplier_name) ??
      o.supplierName ??
      null;
    if (typeof raw.likelyNotEffectivePurchase === "boolean") {
      o.likelyNotEffectivePurchase = raw.likelyNotEffectivePurchase;
    } else {
      o.likelyNotEffectivePurchase = false;
    }
    o.likelyNotPurchaseReason =
      strOrNull(
        raw.likelyNotPurchaseReason ?? raw.likely_not_purchase_reason,
      ) ?? null;
    o.businessIntent = parseBusinessIntent(
      raw.businessIntent ?? raw.business_intent,
    );
    o.dueDate = normalizeExtractedDueDate(
      strOrNull(raw.dueDate ?? raw.due_date) ?? undefined,
    );
    o.boletoTitle =
      strOrNull(raw.boletoTitle ?? raw.boleto_title) ?? null;
    return o;
  } catch {
    return null;
  }
}

export async function extractDocumentWithOpenAI(params: {
  apiKey: string;
  mode: "text" | "image" | "pdf";
  text?: string;
  imageUrl?: string;
  /** data:image/...;base64,... — usado após otimização local (WhatsApp) */
  imageDataUrl?: string;
  documentUrl?: string;
}): Promise<
  { ok: true; data: ExtractedDocumentResult } | { ok: false; error: string }
> {
  const { apiKey, mode } = params;
  const baseModel =
    Deno.env.get("OPENAI_EXPENSE_MODEL")?.trim() ?? "gpt-4.1-mini";

  const model =
    mode === "image"
      ? (Deno.env.get("OPENAI_EXPENSE_VISION_MODEL")?.trim() ?? baseModel)
      : baseModel;

  if (mode === "pdf") {
    const url = params.documentUrl?.trim();
    if (!url) return { ok: false, error: "URL do PDF ausente." };
    const pdfModel =
      Deno.env.get("OPENAI_EXPENSE_PDF_MODEL")?.trim() ||
      Deno.env.get("OPENAI_EXPENSE_MODEL")?.trim() ||
      "gpt-4o";
    return extractDocumentFromPdfUrl(apiKey, url, pdfModel);
  }

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  if (mode === "image") {
    const dataUrl = params.imageDataUrl?.trim();
    const url = params.imageUrl?.trim();
    if (!dataUrl && !url) {
      return { ok: false, error: "Imagem ausente (URL ou data URL)." };
    }
    userContent.push({
      type: "text",
      text: USER_PROMPT_IMAGE,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: dataUrl ?? url! },
    });
  } else {
    const t = params.text?.trim() ?? "";
    if (t.length < 20) {
      return { ok: false, error: "Texto muito curto." };
    }
    userContent.push({
      type: "text",
      text: `Analise o texto abaixo e extraia os dados conforme o sistema.\n\n---\n${t}\n---`,
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error("[openaiExpense] HTTP", res.status, raw.slice(0, 500));
    return { ok: false, error: `OpenAI: ${res.status}` };
  }

  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Resposta OpenAI inválida." };
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return { ok: false, error: "OpenAI sem conteúdo." };
  }

  const data = safeParseJson(content);
  if (!data) {
    return { ok: false, error: "JSON da extração inválido." };
  }

  return { ok: true, data };
}

export function mapDocumentKindToExpenseType(
  k: ExtractedDocumentResult["documentKind"],
): "nota_fiscal" | "romaneio" | "recibo" {
  if (k === "romaneio") return "romaneio";
  if (k === "recibo") return "recibo";
  return "nota_fiscal";
}

export function sumItems(items: ExtractedExpenseItem[]): number {
  let s = 0;
  for (const it of items) {
    s += Number(it.lineTotal);
  }
  return Math.round(s * 100) / 100;
}

export function totalsMatch(totalDoc: number, sumItemsVal: number): boolean {
  const a = Math.round(totalDoc * 100) / 100;
  const b = Math.round(sumItemsVal * 100) / 100;
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= 0.02) return true;
  if (a > 0 && diff / a <= 0.002) return true;
  return false;
}

export function scaleItemsToTotal(
  items: ExtractedExpenseItem[],
  totalTarget: number,
): ExtractedExpenseItem[] {
  const sum = sumItems(items);
  if (sum <= 0 || items.length === 0) return items;
  const factor = totalTarget / sum;
  return items.map((it) => {
    const newLine = Math.round(it.lineTotal * factor * 100) / 100;
    const q = Math.max(0.0001, it.quantity);
    const newUnit = Math.round((newLine / q) * 10000) / 10000;
    return {
      ...it,
      lineTotal: newLine,
      unitValue: newUnit,
    };
  });
}

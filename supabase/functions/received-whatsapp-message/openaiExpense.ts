/**
 * Extração estruturada de nota/cupom/romaneio/recibo via OpenAI (texto ou imagem).
 */

export type ExtractedExpenseItem = {
  productName: string;
  quantity: number;
  unitValue: number;
  lineTotal: number;
};

export type ExtractedDocumentResult = {
  validDocument: boolean;
  /** Motivo quando validDocument é false */
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
  /** Número da nota/cupom (em NFC-e costuma ficar ao lado do rótulo "NFC-e") */
  invoiceNumber: string | null;
  /** Série fiscal quando constar no documento (NF-e / NFC-e) */
  invoiceSeries: string | null;
  totalAmount: number | null;
  items: ExtractedExpenseItem[];
  notes: string | null;
};

const SYSTEM_PROMPT = `Você é um assistente que analisa documentos fiscais brasileiros (nota fiscal, cupom fiscal, romaneio, recibo de compra) ou texto digitado que descreva uma compra.

Responda APENAS um JSON válido (sem markdown), com esta estrutura exata:
{
  "validDocument": boolean,
  "invalidReason": string ou null,
  "documentKind": "nota_fiscal" | "cupom_fiscal" | "romaneio" | "recibo" | "outro" | null,
  "supplierName": string ou null,
  "supplierDocument": string ou null (CNPJ/CPF só dígitos se visível),
  "invoiceNumber": string ou null (número do documento; em cupom fiscal/NFC-e costuma aparecer em frente ou ao lado do texto "NFC-e"),
  "invoiceSeries": string ou null (série da NF-e ou NFC-e quando impressa, ex. "1", "2"; null se não houver),
  "totalAmount": number ou null (valor TOTAL do documento em BRL, número decimal),
  "items": [ { "productName": string, "quantity": number, "unitValue": number, "lineTotal": number } ],
  "notes": string ou null
}

Regras:
- validDocument = true somente se for claramente um documento de compra (nota, cupom, romaneio, recibo) OU texto estruturado com fornecedor, itens e valores; e houver pelo menos fornecedor ou identificação razoável E pelo menos um item com valores.
- Se for foto ilegível, borrada, sem contexto de compra, ou não for documento: validDocument = false e invalidReason explicando em português (curto).
- Itens: lineTotal deve ser quantity * unitValue (aproximado). Use ponto como decimal nos números JSON.
- totalAmount é o total geral impresso no documento (ou soma explícita se só houver itens).
- Em cupom fiscal eletrônico (NFC-e), o número da nota geralmente aparece próximo ao rótulo "NFC-e"; extraia esse número em invoiceNumber e a série em invoiceSeries se visível.
- supplierDocument: use sempre string (CNPJ/CPF com ou sem máscara). Se o JSON numérico for usado para CNPJ, pode perder zeros à esquerda — prefira string.
- Se não tiver certeza que é documento de compra, validDocument = false.`;

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  const t = String(v).trim();
  return t.length ? t : null;
}

function safeParseJson(s: string): ExtractedDocumentResult | null {
  try {
    const raw = JSON.parse(s) as Record<string, unknown>;
    if (typeof raw.validDocument !== "boolean") return null;
    const o = raw as unknown as ExtractedDocumentResult;
    if (!Array.isArray(o.items)) o.items = [];
    if (o.invoiceSeries === undefined) o.invoiceSeries = null;
    // Modelo pode devolver snake_case ou número no documento
    o.supplierDocument = strOrNull(raw.supplierDocument ?? raw.supplier_document) ??
      o.supplierDocument ?? null;
    o.invoiceNumber = strOrNull(raw.invoiceNumber ?? raw.invoice_number) ??
      o.invoiceNumber ?? null;
    o.invoiceSeries = strOrNull(raw.invoiceSeries ?? raw.invoice_series) ??
      o.invoiceSeries ?? null;
    o.supplierName = strOrNull(raw.supplierName ?? raw.supplier_name) ??
      o.supplierName ?? null;
    return o;
  } catch {
    return null;
  }
}

export async function extractDocumentWithOpenAI(params: {
  apiKey: string;
  mode: "text" | "image";
  text?: string;
  imageUrl?: string;
}): Promise<{ ok: true; data: ExtractedDocumentResult } | { ok: false; error: string }> {
  const { apiKey, mode } = params;
  const model = Deno.env.get("OPENAI_EXPENSE_MODEL") ?? "gpt-4o-mini";

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  if (mode === "image") {
    const url = params.imageUrl?.trim();
    if (!url) return { ok: false, error: "URL da imagem ausente." };
    userContent.push({
      type: "text",
      text: "Analise esta imagem e extraia os dados conforme o sistema. Se a imagem não for um documento fiscal legível, marque validDocument false.",
    });
    userContent.push({ type: "image_url", image_url: { url } });
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

/** Soma lineTotal dos itens */
export function sumItems(items: ExtractedExpenseItem[]): number {
  let s = 0;
  for (const it of items) {
    s += Number(it.lineTotal);
  }
  return Math.round(s * 100) / 100;
}

/** Compara total do documento com soma dos itens (tolerância centavos + arredondamento) */
export function totalsMatch(
  totalDoc: number,
  sumItemsVal: number,
): boolean {
  const a = Math.round(totalDoc * 100) / 100;
  const b = Math.round(sumItemsVal * 100) / 100;
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= 0.02) return true;
  if (a > 0 && diff / a <= 0.002) return true;
  return false;
}

/** Ajusta lineTotal dos itens proporcionalmente para fechar em totalTarget */
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

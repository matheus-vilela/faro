/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Webhook Z-API "Ao receber" — fluxo completo neste arquivo.
 *
 * A linha `connectedPhone` é a mesma para todas as empresas; a empresa é resolvida
 * só pelo telefone do remetente (owner ou membro ativo). Ambiguidade → 409.
 *
 * Logs `VALIDAÇÃO: VÁLIDA` / `VALIDAÇÃO: INVÁLIDA` indicam se o remetente bate com
 * `companies.owner_whatsapp_normalized` ou `company_members` (ativo).
 * Busca usa variantes BR: com 12 dígitos (55+DDD+8) também tenta 13 (9 após DDD);
 * com 13, também tenta 12 (remove o 9 inicial do número local).
 *
 * Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Opcional: ZAPI_WEBHOOK_SECRET
 * Opcional (resposta WhatsApp): ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN
 * Opcional (links): PUBLIC_APP_URL ou SITE_URL (ex.: https://app.seudominio.com)
 *
 * Comandos de texto: *lista* (pendentes + menu numérico), *comandos* (lista de ajuda).
 * Proprietário também vê *contas a pagar* na ajuda e pode usá-lo (7 dias).
 * Membro ativo: *comandos* só lista *lista* e *comandos* (sem *contas a pagar*).
 * Número 1–20 após *lista* escolhe opção do último menu.
 */

// --- Tipos (payload Z-API) -------------------------------------------------

type ZApiReceivedCallbackPayload = {
  type?: string;
  instanceId?: string;
  messageId?: string;
  phone?: string;
  connectedPhone?: string;
  senderLid?: string;
  participantPhone?: string | null;
  participantLid?: string | null;
  fromMe?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  isEdit?: boolean;
  status?: string;
  momment?: number;
  chatName?: string;
  senderName?: string;
  text?: {
    message?: string;
    descritpion?: string;
    title?: string;
    url?: string;
    thumbnailUrl?: string;
  };
  /** Alguns callbacks trazem texto no raiz */
  message?: string;
  [key: string]: unknown;
};

// --- Resultado da autorização ----------------------------------------------

type WebhookAuthSuccess = {
  authorized: true;
  companyId: string;
  senderNormalized: string;
  /** Linha da instância Z-API (igual para todas as empresas); só informativo. */
  connectedNormalized: string | null;
  role: "owner" | "member";
  /** `company_members.id` quando o remetente é membro; `null` quando é só owner. */
  companyMemberId: string | null;
  lookupVariants: string[];
};

type WebhookAuthFailure = {
  authorized: false;
  reason: string;
  code:
    | "MISSING_SENDER"
    | "INVALID_SENDER"
    | "SENDER_NOT_AUTHORIZED"
    | "AMBIGUOUS_COMPANY"
    | "FROM_ME_SKIPPED"
    | "SERVER_CONFIG";
};

type WebhookAuthResult = WebhookAuthSuccess | WebhookAuthFailure;

// --- Telefone normalizado (BR / DDI 55) ------------------------------------

const DIGITS_ONLY = /^\d+$/;

type PhoneValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

function stripToDigits(input: string): string {
  let s = input.trim().replace(/\s+/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  return s.replace(/\D/g, "");
}

function validateAndNormalizePhone(input: string): PhoneValidationResult {
  const raw = stripToDigits(input);
  if (!raw) {
    return { ok: false, error: "Telefone é obrigatório." };
  }
  if (!DIGITS_ONLY.test(raw)) {
    return { ok: false, error: "Telefone contém caracteres inválidos." };
  }

  let digits = raw;

  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const dddNum = Number.parseInt(ddd, 10);
    if (dddNum >= 11 && dddNum <= 99) {
      digits = `55${digits}`;
    }
  }

  if (digits.length < 12 || digits.length > 15) {
    return {
      ok: false,
      error:
        "Telefone inválido: use DDI + DDD + número (ex.: +55 11 99999-8888).",
    };
  }

  if (!digits.startsWith("55")) {
    return {
      ok: false,
      error: "Por enquanto apenas números com DDI 55 (Brasil) são aceitos.",
    };
  }

  const national = digits.slice(2);
  if (national.length !== 10 && national.length !== 11) {
    return { ok: false, error: "Formato nacional inválido após DDI 55." };
  }

  return { ok: true, normalized: digits };
}

/**
 * Variações BR para bater cadastro com `owner_whatsapp_normalized` / `phone_normalized`:
 * - 12 dígitos (55 + DDD + 8): também busca 13 dígitos com 9 após o DDD (celular).
 * - 13 dígitos (55 + DDD + 9 + 8): também busca 12 sem o 9 inicial do número local (ex.: API manda sem o 9).
 */
function buildBrazilPhoneLookupVariants(normalized: string): string[] {
  const out = new Set<string>();
  out.add(normalized);

  if (!normalized.startsWith("55") || !DIGITS_ONLY.test(normalized)) {
    return [...out];
  }

  const n = normalized.length;
  const national = normalized.slice(2);

  if (n === 12 && national.length === 10) {
    const ddd = national.slice(0, 2);
    const subscriber8 = national.slice(2, 10);
    if (subscriber8.length === 8) {
      out.add(`55${ddd}9${subscriber8}`);
    }
  }

  if (n === 13 && national.length === 11) {
    const ddd = national.slice(0, 2);
    const subscriber9 = national.slice(2, 11);
    if (subscriber9.length === 9 && subscriber9.startsWith("9")) {
      out.add(`55${ddd}${subscriber9.slice(1)}`);
    }
  }

  return [...out];
}

/** Grupo: participantPhone; privado: phone. */
function resolveSenderRawPhone(
  payload: ZApiReceivedCallbackPayload,
): string | null {
  if (payload.fromMe === true) {
    return null;
  }
  if (payload.isGroup) {
    if (payload.participantPhone) {
      return String(payload.participantPhone);
    }
    if (payload.phone) {
      return String(payload.phone);
    }
    return null;
  }
  if (payload.phone) {
    return String(payload.phone);
  }
  return null;
}

// --- HTTP helpers ----------------------------------------------------------

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Logs estruturados para validar o fluxo no painel (grep `whatsapp-flow`).
 * `flowId` correlaciona recebimento → processamento → envio Z-API.
 */
function flowLog(phase: string, detail: Record<string, unknown>): void {
  console.log(
    "[whatsapp-flow]",
    JSON.stringify({ phase, ts: new Date().toISOString(), ...detail }),
  );
}

function correlationIdFromPayload(
  payload: ZApiReceivedCallbackPayload,
): string {
  const mid = payload.messageId;
  if (typeof mid === "string" && mid.trim()) return mid.trim();
  if (typeof payload.momment === "number") {
    return `momment_${payload.momment}`;
  }
  return "sem_id";
}

function httpStatusForAuthFailure(auth: WebhookAuthResult): number {
  if (auth.authorized) return 200;
  switch (auth.code) {
    case "FROM_ME_SKIPPED":
      return 200;
    case "SERVER_CONFIG":
      return 500;
    case "AMBIGUOUS_COMPANY":
      return 409;
    case "MISSING_SENDER":
    case "INVALID_SENDER":
      return 400;
    default:
      return 403;
  }
}

/** connectedPhone é o mesmo para todo o tenant; opcional para logs. */
function optionalConnectedNormalized(
  payload: ZApiReceivedCallbackPayload,
): string | null {
  if (payload.connectedPhone == null || payload.connectedPhone === "") {
    return null;
  }
  const v = validateAndNormalizePhone(String(payload.connectedPhone));
  return v.ok ? v.normalized : null;
}

// --- Autorização (DB) ------------------------------------------------------

async function authorizeIncomingMessage(
  payload: ZApiReceivedCallbackPayload,
): Promise<WebhookAuthResult> {
  if (payload.fromMe === true) {
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — mensagem fromMe (instância própria), não é entrada de owner/member.",
      { code: "FROM_ME_SKIPPED" },
    );
    return {
      authorized: false,
      reason:
        "Mensagem da própria instância (fromMe); não processar como entrada externa.",
      code: "FROM_ME_SKIPPED",
    };
  }

  const senderRaw = resolveSenderRawPhone(payload);
  if (!senderRaw) {
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — telefone do remetente ausente no payload.",
      { code: "MISSING_SENDER" },
    );
    return {
      authorized: false,
      reason: "Não foi possível determinar o telefone do remetente.",
      code: "MISSING_SENDER",
    };
  }

  const senderV = validateAndNormalizePhone(senderRaw);
  if (!senderV.ok) {
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — telefone do remetente não normaliza (BR/55).",
      { code: "INVALID_SENDER", detail: senderV.error, senderRaw },
    );
    return {
      authorized: false,
      reason: senderV.error,
      code: "INVALID_SENDER",
    };
  }

  const senderN = senderV.normalized;
  const lookupVariants = buildBrazilPhoneLookupVariants(senderN);
  const connectedLog = optionalConnectedNormalized(payload);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "[received-whatsapp-message] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes",
    );
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — configuração do servidor incompleta.",
      { code: "SERVER_CONFIG" },
    );
    return {
      authorized: false,
      reason: "Configuração do servidor incompleta.",
      code: "SERVER_CONFIG",
    };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  console.log(
    "[received-whatsapp-message] VALIDAÇÃO: consultando owner e membros ativos com variantes de normalização:",
    { remetenteNormalizado: senderN, variantes: lookupVariants },
  );

  const { data: ownerCompanies, error: ownerErr } = await supabase
    .from("companies")
    .select("id, owner_whatsapp_normalized")
    .in("owner_whatsapp_normalized", lookupVariants);

  if (ownerErr) {
    console.error(
      "[received-whatsapp-message] DB owner lookup:",
      ownerErr.message,
    );
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — erro ao consultar proprietário no banco.",
      { code: "SENDER_NOT_AUTHORIZED" },
    );
    return {
      authorized: false,
      reason: "Erro ao consultar empresas.",
      code: "SENDER_NOT_AUTHORIZED",
    };
  }

  const { data: memberRows, error: memErr } = await supabase
    .from("company_members")
    .select("company_id, id")
    .in("phone_normalized", lookupVariants)
    .eq("is_active", true);

  if (memErr) {
    console.error("[received-whatsapp-message] DB members:", memErr.message);
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — erro ao consultar company_members.",
      { code: "SENDER_NOT_AUTHORIZED" },
    );
    return {
      authorized: false,
      reason: "Erro ao consultar membros.",
      code: "SENDER_NOT_AUTHORIZED",
    };
  }

  const companyIds = new Set<string>();
  for (const row of ownerCompanies ?? []) {
    companyIds.add(row.id);
  }
  for (const row of memberRows ?? []) {
    companyIds.add(row.company_id);
  }

  if (companyIds.size === 0) {
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — remetente não é owner (owner_whatsapp) nem membro ativo (company_members) em nenhuma empresa.",
      {
        code: "SENDER_NOT_AUTHORIZED",
        senderNormalized: senderN,
        variantesConsideradas: lookupVariants,
        connectedPhoneLog: connectedLog,
        ownerMatches: (ownerCompanies ?? []).length,
        memberMatches: (memberRows ?? []).length,
      },
    );
    return {
      authorized: false,
      reason:
        "Telefone do remetente não está autorizado em nenhuma empresa (proprietário ou membro ativo).",
      code: "SENDER_NOT_AUTHORIZED",
    };
  }

  if (companyIds.size > 1) {
    console.log(
      "[received-whatsapp-message] VALIDAÇÃO: INVÁLIDA — mesmo telefone resolve mais de uma empresa (ambiguidade).",
      {
        code: "AMBIGUOUS_COMPANY",
        senderNormalized: senderN,
        variantesConsideradas: lookupVariants,
        companyIds: [...companyIds],
      },
    );
    return {
      authorized: false,
      reason:
        "Este telefone está associado a mais de uma empresa. Ajuste o cadastro para que seja único.",
      code: "AMBIGUOUS_COMPANY",
    };
  }

  const companyId = [...companyIds][0];
  const isOwner = (ownerCompanies ?? []).some((c) => c.id === companyId);
  const memberRow = (memberRows ?? []).find((r) => r.company_id === companyId);
  const companyMemberId = isOwner ? null : (memberRow?.id ?? null);

  console.log(
    "[received-whatsapp-message] VALIDAÇÃO: VÁLIDA — remetente autorizado.",
    {
      companyId,
      companyMemberId,
      papel: isOwner
        ? "proprietário (companies.owner_whatsapp_normalized)"
        : "membro ativo (company_members)",
      role: isOwner ? "owner" : "member",
      senderNormalized: senderN,
      variantesConsideradas: lookupVariants,
      connectedPhoneLog: connectedLog,
    },
  );

  return {
    authorized: true,
    companyId,
    senderNormalized: senderN,
    connectedNormalized: connectedLog,
    role: isOwner ? "owner" : "member",
    companyMemberId,
    lookupVariants,
  };
}

// --- Texto: lista de recebimentos + menu numérico (Z-API) ------------------

const MENU_TTL_MS = 24 * 60 * 60 * 1000;

function extractTextMessage(
  payload: ZApiReceivedCallbackPayload,
): string | null {
  const t = payload.text?.message;
  if (typeof t === "string" && t.trim()) return t.trim();
  const m = payload.message;
  if (typeof m === "string" && m.trim()) return m.trim();
  return null;
}

/** Uma única palavra, minúscula e sem acento (para comandos *lista* / *comandos*). */
function normalizeSingleCommandWord(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function isListaCommand(text: string): boolean {
  return normalizeSingleCommandWord(text) === "lista";
}

function isComandosCommand(text: string): boolean {
  return normalizeSingleCommandWord(text) === "comandos";
}

/** Frase completa (minúscula, sem acento, espaços colapsados, sem * nas pontas). */
function normalizeCommandPhrase(text: string): string {
  return text
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isContasAPagarCommand(text: string): boolean {
  return normalizeCommandPhrase(text) === "contas a pagar";
}

/** Data local (America/Sao_Paulo) em YYYY-MM-DD. */
function brazilTodayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

function addCalendarDaysIso(isoDate: string, daysToAdd: number): string {
  const [y, m, d] = isoDate.split("-").map((x) => parseInt(x, 10, 10));
  const ms = Date.UTC(y, m - 1, d + daysToAdd);
  return new Date(ms).toISOString().slice(0, 10);
}

function formatDateBrFromIso(iso: string): string {
  const [yy, mm, dd] = iso.split("-");
  if (!yy || !mm || !dd) return iso;
  return `${dd}/${mm}/${yy}`;
}

function formatMoneyBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

type BoletoWhatsappRow = {
  due_date: string;
  description: string;
  amount: number;
  status: string;
  category?: string | null;
};

const BOLETO_CATEGORY_WHATSAPP_SHORT: Record<string, string> = {
  insumos: "Insum.",
  fornecedores: "Fornec.",
  custo_fixo: "Fixo",
  estabelecimento: "Estab.",
  outros: "Outros",
};

const BOLETOS_WHATSAPP_MAX_ITEMS = 45;

/** Linha de um boleto: pendente 🔘; pago ☑️ com ~riscado~ (WhatsApp). Inclui categoria. */
function formatBoletoLineWhatsapp(b: BoletoWhatsappRow): string {
  const raw =
    (b.description ?? "").trim().replace(/\s+/g, " ") || "(sem descrição)";
  const desc = raw.replace(/~/g, "");
  const money = formatMoneyBrl(Number(b.amount));
  const cat =
    BOLETO_CATEGORY_WHATSAPP_SHORT[b.category ?? "outros"] ?? "Outros";
  const core = `${desc} · ${cat} · ${money}`;
  if (b.status === "paid") {
    return `☑️ ~${core}~`;
  }
  return `🔘 ${core}`;
}

async function buildContasAPagarWhatsappMessage(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
): Promise<string> {
  const startIso = brazilTodayIsoDate();
  const endIso = addCalendarDaysIso(startIso, 6);

  const { data, error } = await supabase
    .from("boletos")
    .select("due_date, description, amount, status, category")
    .eq("company_id", companyId)
    .gte("due_date", startIso)
    .lte("due_date", endIso)
    .order("due_date", { ascending: true })
    .order("amount", { ascending: true })
    .limit(BOLETOS_WHATSAPP_MAX_ITEMS + 1);

  if (error) {
    console.error(
      "[received-whatsapp-message] fetch boletos 7 dias:",
      error.message,
    );
    return "Não foi possível carregar as contas a pagar agora. Tente de novo em instantes.";
  }

  const rows = (data ?? []) as BoletoWhatsappRow[];
  const header = ["*Contas a pagar* — próximos 7 dias\n\n"].join("\n\n");

  if (rows.length === 0) {
    return `${header}Nenhuma conta com vencimento nesse período.`;
  }

  const truncated = rows.length > BOLETOS_WHATSAPP_MAX_ITEMS;
  const slice = truncated ? rows.slice(0, BOLETOS_WHATSAPP_MAX_ITEMS) : rows;

  const dayOrder: string[] = [];
  const byDay = new Map<string, BoletoWhatsappRow[]>();
  for (const r of slice) {
    const key = String(r.due_date).slice(0, 10);
    if (!byDay.has(key)) {
      dayOrder.push(key);
      byDay.set(key, []);
    }
    byDay.get(key)!.push(r);
  }
  for (const k of dayOrder) {
    byDay.get(k)!.sort((a, b) => Number(a.amount) - Number(b.amount));
  }

  const blocks: string[] = [];
  for (const dayIso of dayOrder) {
    const items = byDay.get(dayIso)!;
    const dateHeading = formatDateBrFromIso(dayIso);
    const lines = items.map(formatBoletoLineWhatsapp);
    blocks.push([dateHeading, ...lines].join("\n"));
  }

  const footer = truncated
    ? `\n\n_(Mostrando as primeiras ${BOLETOS_WHATSAPP_MAX_ITEMS} contas; há mais no período.)_`
    : "";

  return `${header}${blocks.join("\n\n")}${footer}`;
}

function buildComandosWhatsappMessage(isOwner: boolean): string {
  const lines = [
    "*Comandos disponíveis*",
    "",
    "*lista* — mostra os recebimentos pendentes.",
    "",
    "*comandos* — mostra esta lista de comandos.",
  ];
  if (isOwner) {
    lines.push(
      "",
      "*contas a pagar* — contas com vencimento nos próximos 7 dias.",
    );
  }
  return lines.join("\n");
}

function parseMenuOptionNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 20) return n;
  return null;
}

type RecebimentoWhatsappRow = {
  id: string;
  token: string;
  assigned_company_member_id: string | null;
  expenses: {
    supplier_name: string | null;
    display_name: string | null;
    invoice_number: string | null;
    company_id: string;
  } | null;
};

async function fetchPendingRecebimentosForWhatsapp(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  companyMemberId: string | null,
  isOwner: boolean,
): Promise<{ id: string; token: string; label: string }[]> {
  const { data, error } = await supabase
    .from("recebimentos")
    .select(
      `
      id,
      token,
      assigned_company_member_id,
      expenses ( supplier_name, display_name, invoice_number, company_id )
    `,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.error(
      "[received-whatsapp-message] fetch recebimentos:",
      error.message,
    );
    return [];
  }

  const rows = (data ?? []) as unknown as RecebimentoWhatsappRow[];
  const filtered = rows.filter((r) => {
    const exp = r.expenses;
    if (!exp || exp.company_id !== companyId) return false;
    if (isOwner) return true;
    if (companyMemberId && r.assigned_company_member_id === companyMemberId) {
      return true;
    }
    return false;
  });

  return filtered.slice(0, 15).map((r) => {
    const exp = r.expenses!;
    const supplier =
      exp.display_name?.trim() || exp.supplier_name?.trim() || "Fornecedor";
    const nf = exp.invoice_number?.trim();
    const label = nf ? `${supplier} — NF ${nf}` : `${supplier} — sem NF`;
    return { id: r.id, token: r.token, label };
  });
}

async function saveMenuState(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  senderPhone: string,
  recebimentoIds: string[],
): Promise<void> {
  await supabase
    .from("whatsapp_recebimento_menu")
    .delete()
    .eq("sender_phone_normalized", senderPhone)
    .eq("company_id", companyId);

  const { error } = await supabase.from("whatsapp_recebimento_menu").insert({
    company_id: companyId,
    sender_phone_normalized: senderPhone,
    recebimento_ids: recebimentoIds,
  });
  if (error) {
    console.error("[received-whatsapp-message] saveMenuState:", error.message);
  }
}

async function loadLatestMenu(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  senderPhone: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("whatsapp_recebimento_menu")
    .select("recebimento_ids, created_at")
    .eq("company_id", companyId)
    .eq("sender_phone_normalized", senderPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.recebimento_ids?.length) return null;
  const age = Date.now() - new Date(data.created_at as string).getTime();
  if (age > MENU_TTL_MS) return null;
  return data.recebimento_ids as string[];
}

async function getRecebimentoTokenById(
  supabase: ReturnType<typeof createClient>,
  recebimentoId: string,
  companyId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("recebimentos")
    .select("token, expenses ( company_id )")
    .eq("id", recebimentoId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    token: string;
    expenses: { company_id: string } | null;
  };
  if (row.expenses?.company_id !== companyId) return null;
  return row.token;
}

function randomShortSlug(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Cria ou reutiliza slug em `recebimento_short_links` (service role). */
async function ensureRecebimentoShortSlug(
  supabase: ReturnType<typeof createClient>,
  recebimentoId: string,
  tokenUuid: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("recebimento_short_links")
    .select("slug")
    .eq("recebimento_id", recebimentoId)
    .maybeSingle();

  const existingSlug = existing as { slug?: string } | null;
  if (existingSlug?.slug && typeof existingSlug.slug === "string") {
    return existingSlug.slug;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    const slug = randomShortSlug(8);
    const { error } = await supabase.from("recebimento_short_links").insert({
      slug,
      recebimento_id: recebimentoId,
      token: tokenUuid,
    });
    if (!error) return slug;
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error(
        "[received-whatsapp-message] ensureRecebimentoShortSlug:",
        error.message,
      );
      return null;
    }
  }
  return null;
}

/** Garante apenas dígitos (E.164 BR) para o campo `phone` da Z-API. */
function normalizePhoneForZApiSend(phoneDigits: string): string {
  return stripToDigits(phoneDigits);
}

export type SendWhatsappMessageResult =
  | { ok: true }
  | { ok: false; error: string; code: "zapi_not_configured" | "zapi_http" };

/**
 * Envia mensagem de texto ao WhatsApp via Z-API (`send-text`).
 * Documentação: https://developer.z-api.io/message/send-message-text
 *
 * Secrets: ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN (header Client-Token)
 */
async function sendWhatsappMessage(
  phoneDigits: string,
  message: string,
  logContext?: string,
  flowId?: string,
): Promise<SendWhatsappMessageResult> {
  const phone = normalizePhoneForZApiSend(phoneDigits);
  if (!phone) {
    console.warn(
      "[received-whatsapp-message] sendWhatsappMessage: telefone vazio",
      logContext ?? "",
    );
    flowLog("envio_resposta", {
      flowId: flowId ?? null,
      context: logContext ?? "sem_contexto",
      ok: false,
      code: "phone_empty",
    });
    return { ok: false, error: "phone_empty", code: "zapi_http" };
  }

  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN");
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN");
  if (!instanceId || !instanceToken || !clientToken) {
    console.warn(
      "[received-whatsapp-message] Z-API não configurada (ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN)",
      logContext ?? "",
    );
    flowLog("envio_resposta", {
      flowId: flowId ?? null,
      context: logContext ?? "sem_contexto",
      ok: false,
      code: "zapi_not_configured",
    });
    return {
      ok: false,
      error: "zapi_not_configured",
      code: "zapi_not_configured",
    };
  }

  const url = `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`;

  console.log(
    "[received-whatsapp-message] sendWhatsappMessage → Z-API",
    logContext ? { context: logContext, flowId: flowId ?? null } : {},
  );
  flowLog("envio_zapi_inicio", {
    flowId: flowId ?? null,
    context: logContext ?? "sem_contexto",
    phoneLen: phone.length,
    messageLen: message.length,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Token": clientToken,
    },
    body: JSON.stringify({ phone, message }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error(
      "[received-whatsapp-message] sendWhatsappMessage falhou (HTTP):",
      res.status,
      t,
      logContext ?? "",
    );
    flowLog("envio_resposta", {
      flowId: flowId ?? null,
      context: logContext ?? "sem_contexto",
      ok: false,
      code: "zapi_http",
      httpStatus: res.status,
    });
    return { ok: false, error: t, code: "zapi_http" };
  }

  console.log(
    "[received-whatsapp-message] sendWhatsappMessage OK",
    logContext ? { context: logContext } : {},
  );
  flowLog("envio_resposta", {
    flowId: flowId ?? null,
    context: logContext ?? "sem_contexto",
    ok: true,
  });
  return { ok: true };
}

/** Monta o texto da listagem de recebimentos pendentes (menu numerado). */
function buildRecebimentosListMessage(items: { label: string }[]): string {
  const lines = items.map((it, i) => `${i + 1}) ${it.label}`);
  return [
    "*Recebimentos pendentes*",
    "",
    ...lines,
    "",
    "Responda *somente com o número* da opção (ex.: 1) para receber o link de confirmação.",
  ].join("\n");
}

/**
 * Envia ao remetente a listagem de recebimentos (formato menu) pela Z-API.
 * Deve ser chamado após `saveMenuState` com os mesmos `items` (ordem = opções).
 */
async function sendRecebimentosListToWhatsapp(
  phoneDigits: string,
  items: { label: string }[],
  flowId?: string,
): Promise<SendWhatsappMessageResult> {
  const body = buildRecebimentosListMessage(items);
  return sendWhatsappMessage(
    phoneDigits,
    body,
    "recebimentos_lista_menu",
    flowId,
  );
}

function publicAppBaseUrl(): string {
  const u = Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  return u.replace(/\/$/, "");
}

/** Base pública com esquema (evita `https://https://...` se a env já incluir https). */
function publicAppAbsoluteBase(): string {
  const raw = publicAppBaseUrl();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return `https://${raw.replace(/\/$/, "")}`;
}

async function handleRecebimentoTextFlow(
  payload: ZApiReceivedCallbackPayload,
  auth: WebhookAuthSuccess,
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  const flowId = correlationIdFromPayload(payload);

  if (payload.isGroup) {
    flowLog("processamento_recebimento", {
      flowId,
      companyId: auth.companyId,
      ignorado: true,
      motivo: "grupo",
    });
    return false;
  }

  const text = extractTextMessage(payload);
  if (!text) {
    flowLog("processamento_recebimento", {
      flowId,
      companyId: auth.companyId,
      ignorado: true,
      motivo: "sem_texto",
    });
    return false;
  }

  flowLog("processamento_recebimento", {
    flowId,
    companyId: auth.companyId,
    role: auth.role,
    textoLen: text.length,
    textoPreview: text.length > 80 ? `${text.slice(0, 80)}…` : text,
  });

  const isOwner = auth.role === "owner";
  const companyMemberId = auth.companyMemberId;

  const opt = parseMenuOptionNumber(text);
  if (opt !== null) {
    flowLog("menu_numerico", { flowId, companyId: auth.companyId, opcao: opt });
    const ids = await loadLatestMenu(
      supabase,
      auth.companyId,
      auth.senderNormalized,
    );
    flowLog("menu_estado_db", {
      flowId,
      opcoesNoMenu: ids?.length ?? 0,
      temEstado: !!(ids && ids.length > 0),
    });
    if (!ids || ids.length === 0) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        "Não encontrei um menu de recebimentos recente. Envie *lista* para ver as opções pendentes.",
        "recebimento_menu_sem_estado",
        flowId,
      );
      flowLog("processamento_fim", {
        flowId,
        branch: "menu_sem_estado",
        handled: true,
      });
      return true;
    }
    const idx = opt - 1;
    if (idx < 0 || idx >= ids.length) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        `Opção inválida. Responda com um número de 1 a ${ids.length}.`,
        "recebimento_opcao_invalida",
        flowId,
      );
      flowLog("processamento_fim", {
        flowId,
        branch: "menu_opcao_invalida",
        handled: true,
      });
      return true;
    }
    const rid = ids[idx];
    const token = await getRecebimentoTokenById(supabase, rid, auth.companyId);
    if (!token) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        "Não foi possível encontrar esse recebimento. Peça a lista novamente.",
        "recebimento_token_nao_encontrado",
        flowId,
      );
      flowLog("processamento_fim", {
        flowId,
        branch: "menu_token_ausente",
        handled: true,
      });
      return true;
    }
    const base = publicAppAbsoluteBase();
    if (!base) {
      console.error(
        "[received-whatsapp-message] PUBLIC_APP_URL / SITE_URL ausente",
      );
      await sendWhatsappMessage(
        auth.senderNormalized,
        "Link indisponível no momento (configuração do servidor). Tente pelo painel do Faro.",
        "recebimento_link_publico_ausente",
        flowId,
      );
      flowLog("processamento_fim", {
        flowId,
        branch: "link_publico_ausente",
        handled: true,
      });
      return true;
    }
    const slug = await ensureRecebimentoShortSlug(supabase, rid, token);
    const link = slug ? `${base}/s/${slug}` : `${base}/c/${token}`;
    if (!slug) {
      console.warn(
        "[received-whatsapp-message] slug curto indisponível; usando /c/",
        { flowId, recebimentoId: rid },
      );
    } else {
      flowLog("link_curto_slug", { flowId, slug, recebimentoId: rid });
    }
    await sendWhatsappMessage(
      auth.senderNormalized,
      `Aqui está o link para confirmar o recebimento:\n\n${link}\n\nAbra no navegador para conferir os itens.`,
      "recebimento_link_confirmacao",
      flowId,
    );
    flowLog("processamento_fim", {
      flowId,
      branch: "menu_link_enviado",
      handled: true,
      recebimentoId: rid,
    });
    return true;
  }

  if (isComandosCommand(text)) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      buildComandosWhatsappMessage(isOwner),
      "recebimento_comandos_ajuda",
      flowId,
    );
    flowLog("processamento_fim", {
      flowId,
      branch: "comandos_ajuda",
      handled: true,
    });
    return true;
  }

  if (isContasAPagarCommand(text)) {
    if (!isOwner) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        "Este comando não está disponível para o seu perfil. Envie *comandos* para ver o que você pode usar.",
        "contas_a_pagar_somente_owner",
        flowId,
      );
      flowLog("processamento_fim", {
        flowId,
        branch: "contas_a_pagar_negado_membro",
        handled: true,
      });
      return true;
    }
    const msg = await buildContasAPagarWhatsappMessage(
      supabase,
      auth.companyId,
    );
    await sendWhatsappMessage(
      auth.senderNormalized,
      msg,
      "contas_a_pagar_lista_7_dias",
      flowId,
    );
    flowLog("processamento_fim", {
      flowId,
      branch: "contas_a_pagar_enviado",
      handled: true,
    });
    return true;
  }

  if (!isListaCommand(text)) {
    flowLog("processamento_fim", {
      flowId,
      branch: "nao_e_comando_reconhecido",
      handled: false,
    });
    return false;
  }

  flowLog("intencao_lista_recebimentos", { flowId, companyId: auth.companyId });

  const items = await fetchPendingRecebimentosForWhatsapp(
    supabase,
    auth.companyId,
    companyMemberId,
    isOwner,
  );

  flowLog("lista_recebimentos_query", {
    flowId,
    pendentes: items.length,
    isOwner,
  });

  if (items.length === 0) {
    console.log(
      "[received-whatsapp-message] Pedido de lista de recebimentos; nenhum pendente.",
    );
    await sendWhatsappMessage(
      auth.senderNormalized,
      isOwner
        ? "Não há recebimentos pendentes na empresa no momento."
        : "Não há recebimentos pendentes vinculados ao seu número no momento.",
      "recebimento_lista_vazia",
      flowId,
    );
    flowLog("processamento_fim", {
      flowId,
      branch: "lista_vazia",
      handled: true,
    });
    return true;
  }

  await saveMenuState(
    supabase,
    auth.companyId,
    auth.senderNormalized,
    items.map((x) => x.id),
  );
  flowLog("menu_persistido", {
    flowId,
    idsSalvos: items.length,
  });

  const sent = await sendRecebimentosListToWhatsapp(
    auth.senderNormalized,
    items,
    flowId,
  );
  if (!sent.ok) {
    console.error(
      "[received-whatsapp-message] Falha ao enviar lista via Z-API",
      sent,
    );
  }
  flowLog("processamento_fim", {
    flowId,
    branch: "lista_menu_enviada",
    handled: true,
    envioOk: sent.ok,
    code: sent.ok ? undefined : sent.code,
  });
  return true;
}

// --- Servidor HTTP ---------------------------------------------------------

Deno.serve(async (req) => {
  const allHeaders = headersToRecord(req.headers);

  if (req.method === "GET") {
    console.log(
      "[received-whatsapp-message] GET headers:",
      JSON.stringify(allHeaders, null, 2),
    );
    return jsonResponse({
      ok: true,
      name: "received-whatsapp-message",
      hint: "POST com JSON do webhook Z-API (on-message-received).",
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  console.log(
    "[received-whatsapp-message] POST headers:",
    JSON.stringify(allHeaders, null, 2),
  );
  console.log("[received-whatsapp-message] POST body bruto:", rawBody);

  const secret = Deno.env.get("ZAPI_WEBHOOK_SECRET");
  if (secret) {
    const token =
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
      req.headers.get("z-api-token");
    if (token !== secret) {
      console.warn("[received-whatsapp-message] token webhook inválido");
      return jsonResponse(
        { success: false, error: { code: "UNAUTHORIZED" } },
        401,
      );
    }
  }

  let payload: ZApiReceivedCallbackPayload;
  try {
    payload = JSON.parse(rawBody) as ZApiReceivedCallbackPayload;
  } catch {
    console.error("[received-whatsapp-message] JSON inválido");
    return jsonResponse(
      { success: false, error: { code: "INVALID_JSON" } },
      400,
    );
  }

  console.log(
    "[received-whatsapp-message] body parseado:",
    JSON.stringify(payload, null, 2),
  );

  const flowId = correlationIdFromPayload(payload);
  const textoBruto = extractTextMessage(payload);
  flowLog("webhook_recebido", {
    flowId,
    type: payload.type ?? null,
    fromMe: payload.fromMe === true,
    isGroup: payload.isGroup === true,
    textoLen: textoBruto?.length ?? 0,
    webhookAuth: Boolean(secret),
  });

  const auth = await authorizeIncomingMessage(payload);

  if (!auth.authorized) {
    const status = httpStatusForAuthFailure(auth);
    flowLog("webhook_autorizacao", {
      flowId,
      ok: false,
      code: auth.code,
      httpStatus: status,
    });
    console.log(
      "[received-whatsapp-message] Resposta HTTP: não processado (validação falhou).",
      { status, code: auth.code },
    );
    return jsonResponse(
      {
        success: false,
        processed: false,
        code: auth.code,
        message: auth.reason,
      },
      status,
    );
  }

  flowLog("webhook_autorizacao", {
    flowId,
    ok: true,
    companyId: auth.companyId,
    role: auth.role,
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let recebimentoFlow = false;
  if (supabaseUrl && serviceKey) {
    const supabase = createClient(supabaseUrl, serviceKey);
    recebimentoFlow = await handleRecebimentoTextFlow(payload, auth, supabase);
  } else {
    flowLog("webhook_processamento", {
      flowId,
      recebimentoFlow: false,
      motivo: "supabase_env_ausente",
    });
  }

  flowLog("webhook_resposta_http", {
    flowId,
    companyId: auth.companyId,
    recebimentoFlow,
    status: 200,
  });

  console.log(
    "[received-whatsapp-message] Resposta HTTP: processado (validação já logada acima).",
    {
      companyId: auth.companyId,
      role: auth.role,
      recebimentoFlow,
    },
  );

  return jsonResponse({
    success: true,
    processed: true,
  });
});

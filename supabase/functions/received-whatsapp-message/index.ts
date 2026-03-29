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
    .select("company_id")
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

  console.log(
    "[received-whatsapp-message] VALIDAÇÃO: VÁLIDA — remetente autorizado.",
    {
      companyId,
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
  };
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

  const auth = await authorizeIncomingMessage(payload);

  if (!auth.authorized) {
    const status = httpStatusForAuthFailure(auth);
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

  console.log(
    "[received-whatsapp-message] Resposta HTTP: processado (validação já logada acima).",
    { companyId: auth.companyId, role: auth.role },
  );

  return jsonResponse({
    success: true,
    processed: true,
    companyId: auth.companyId,
    role: auth.role,
    senderNormalized: auth.senderNormalized,
    connectedNormalized: auth.connectedNormalized,
    messageId: payload.messageId ?? null,
    type: payload.type ?? null,
  });
});

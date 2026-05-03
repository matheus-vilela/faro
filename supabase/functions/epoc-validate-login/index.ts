/**
 * Valida URL + usuário + senha do portal EPOC (login real) antes de concluir onboarding.
 * JWT de utilizador + membership em `user_companies`. Não persiste integração.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { performEpocPortalLogin } from "../_shared/epocPortalLoginSession.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-validate-login]";
const DEFAULT_LOGIN_PATH = "/index.php";
const VALIDATE_TIMEOUT_MS = 90_000;

export type ValidateEpocLoginErrorCode =
  | "INVALID_URL"
  | "INVALID_CREDENTIALS"
  | "SERVER_UNAVAILABLE"
  | "UNKNOWN_ERROR";

type ValidateEpocLoginResponse =
  | { success: true }
  | {
      success: false;
      errorCode: ValidateEpocLoginErrorCode;
      message: string;
    };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, errorCode: "UNKNOWN_ERROR", message: "Use POST" } satisfies ValidateEpocLoginResponse, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json(
      {
        success: false,
        errorCode: "UNKNOWN_ERROR",
        message: "Configuração do servidor incompleta",
      } satisfies ValidateEpocLoginResponse,
      500,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(
      {
        success: false,
        errorCode: "UNKNOWN_ERROR",
        message: "Não autenticado",
      } satisfies ValidateEpocLoginResponse,
      401,
    );
  }

  type Body = {
    company_id?: string;
    base_url?: string;
    username?: string;
    password?: string;
    /** NaoMenu / código filial EPOC (opcional; default 123A na probe). */
    codigo_filial?: string;
  };
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(
      {
        success: false,
        errorCode: "UNKNOWN_ERROR",
        message: "JSON inválido",
      } satisfies ValidateEpocLoginResponse,
      400,
    );
  }

  const companyId =
    typeof body.company_id === "string" ? body.company_id.trim() : "";
  const baseUrlRaw = typeof body.base_url === "string" ? body.base_url.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const codigoFilial =
    typeof body.codigo_filial === "string" ? body.codigo_filial.trim() : "";

  if (!companyId) {
    return json(
      {
        success: false,
        errorCode: "UNKNOWN_ERROR",
        message: "company_id é obrigatório",
      } satisfies ValidateEpocLoginResponse,
      400,
    );
  }
  if (!baseUrlRaw) {
    return json(
      {
        success: false,
        errorCode: "INVALID_URL",
        message: "URL base do EPOC é obrigatória",
      } satisfies ValidateEpocLoginResponse,
      400,
    );
  }
  if (!username || !password) {
    return json(
      {
        success: false,
        errorCode: "INVALID_CREDENTIALS",
        message: "Usuário e senha são obrigatórios",
      } satisfies ValidateEpocLoginResponse,
      400,
    );
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json(
      {
        success: false,
        errorCode: "UNKNOWN_ERROR",
        message: "Sessão inválida",
      } satisfies ValidateEpocLoginResponse,
      401,
    );
  }

  const { data: member } = await supabase
    .from("user_companies")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return json(
      {
        success: false,
        errorCode: "UNKNOWN_ERROR",
        message: "Sem acesso a esta unidade",
      } satisfies ValidateEpocLoginResponse,
      403,
    );
  }

  const timeout = AbortSignal.timeout(VALIDATE_TIMEOUT_MS);
  const result = await performEpocPortalLogin({
    normalizedBaseUrl: baseUrlRaw,
    username,
    password,
    loginPath: DEFAULT_LOGIN_PATH,
    userFieldFromSettings: "",
    passFieldFromSettings: "",
    hidden: {},
    signal: timeout,
    probeConteudoTelaAfterLogin: true,
    naoMenu: codigoFilial || undefined,
    sendToken: true,
  });

  if (result.ok) {
    console.log(LOG, "ok", { company_id: companyId, at: new Date().toISOString() });
    return json({ success: true } satisfies ValidateEpocLoginResponse);
  }

  console.warn(LOG, "falha", {
    company_id: companyId,
    errorCode: result.errorCode,
    at: new Date().toISOString(),
  });
  /** HTTP 200 para o cliente ler `success`/`errorCode` sem FunctionsHttpError. */
  return json({
    success: false,
    errorCode: result.errorCode as ValidateEpocLoginErrorCode,
    message: result.message,
  } satisfies ValidateEpocLoginResponse);
});

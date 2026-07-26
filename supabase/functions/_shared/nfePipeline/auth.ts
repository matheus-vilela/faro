import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export type AuthOk = {
  ok: true;
  mode: "cron" | "manual";
  admin: SupabaseClient;
  userId?: string;
};

export type AuthFail = { ok: false; response: Response };

/**
 * Cron: Bearer = FOCUS_NFE_RECEBIDAS_CRON_SECRET.
 * Manual: body.manual=true + JWT de sessão.
 */
export async function authorizeNfePipeline(
  req: Request,
  body: Record<string, unknown>,
): Promise<AuthOk | AuthFail> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return {
      ok: false,
      response: json({ ok: false, error: "Configuração do servidor incompleta." }, 500),
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const expected = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
  const isManual = body.manual === true;

  if (!isManual) {
    if (!expected) {
      return {
        ok: false,
        response: json(
          {
            ok: false,
            error:
              "Defina FOCUS_NFE_RECEBIDAS_CRON_SECRET (Bearer do cron) ou use { manual: true } com JWT.",
          },
          503,
        ),
      };
    }
    if (!bearer || bearer !== expected) {
      return {
        ok: false,
        response: json({ ok: false, error: "Não autorizado." }, 401),
      };
    }
    return { ok: true, mode: "cron", admin };
  }

  if (!authHeader.startsWith("Bearer ") || !bearer) {
    return {
      ok: false,
      response: json(
        { ok: false, error: "Envie Authorization: Bearer <JWT da sessão>." },
        401,
      ),
    };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return {
      ok: false,
      response: json({ ok: false, error: "Sessão inválida." }, 401),
    };
  }

  return { ok: true, mode: "manual", admin, userId: user.id };
}

export function parseJsonBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Orquestra sincronização EPOC só do dia anterior (America/Sao_Paulo) para todas
 * as unidades com integração ativa. Protegida por `EPOC_DAILY_CRON_SECRET` no header
 * Authorization (verify_jwt = false). Cada unidade chama `epoc-sync-csv` com a
 * service role e `sync_mode: "previous_day"`.
 *
 * Após cada tentativa atualiza `company_integrations.settings` com os campos:
 * epoc_daily_sync_last_attempt_at, epoc_daily_sync_last_attempt_ok,
 * epoc_daily_sync_last_attempt_error (para o dashboard mostrar falhas/atrasos).
 *
 * Agendar às 05:00 em São Paulo (≈ 08:00 UTC em horário padrão Brasília): no Dashboard
 * Supabase (Cron / pg_net) ou serviço externo, POST nesta função com o secret.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-daily-sync]";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function persistDailyAttempt(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  ok: boolean,
  errorSummary: string | null,
): Promise<void> {
  const { data: fresh } = await admin
    .from("company_integrations")
    .select("settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();
  const base = (fresh?.settings ?? {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const nextSettings: Record<string, unknown> = {
    ...base,
    epoc_daily_sync_last_attempt_at: nowIso,
    epoc_daily_sync_last_attempt_ok: ok,
    epoc_daily_sync_last_attempt_error: ok ? null : (errorSummary ?? "Erro").slice(
      0,
      900,
    ),
  };
  const { error } = await admin
    .from("company_integrations")
    .update({
      settings: nextSettings,
      updated_at: nowIso,
    })
    .eq("company_id", companyId)
    .eq("provider", "epoc");
  if (error) {
    console.error(LOG, "persist_daily_attempt_falhou", {
      company_id: companyId,
      message: error.message,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST" }, 405);
  }

  const expected = Deno.env.get("EPOC_DAILY_CRON_SECRET")?.trim();
  if (!expected) {
    return json(
      {
        ok: false,
        error:
          "Defina o secret EPOC_DAILY_CRON_SECRET no projeto (Edge Functions secrets).",
      },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (bearer !== expected) {
    return json({ ok: false, error: "Não autorizado" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: integrations, error: listErr } = await admin
    .from("company_integrations")
    .select("company_id")
    .eq("provider", "epoc")
    .eq("enabled", true);

  if (listErr) {
    return json({ ok: false, error: listErr.message }, 500);
  }

  const companyIds = [
    ...new Set(
      (integrations ?? [])
        .map((r) => r.company_id as string | undefined)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const syncUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/epoc-sync-csv`;
  const results: {
    company_id: string;
    ok: boolean;
    error?: string;
    csv_revenue_import_job_id?: string | null;
    epoc_csv_sync_run_id?: string | null;
  }[] = [];

  for (const companyId of companyIds) {
    let syncOk = false;
    let errText: string | null = null;
    try {
      const res = await fetch(syncUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company_id: companyId,
          sync_mode: "previous_day",
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        csv_revenue_import_job_id?: string | null;
        epoc_csv_sync_run_id?: string | null;
      };
      syncOk = res.ok && data?.ok === true;
      errText = syncOk ? null : (data?.error ?? `HTTP ${res.status}`);
      results.push({
        company_id: companyId,
        ok: syncOk,
        error: errText ?? undefined,
        csv_revenue_import_job_id: data?.csv_revenue_import_job_id ?? null,
        epoc_csv_sync_run_id: data?.epoc_csv_sync_run_id ?? null,
      });
      if (!syncOk) {
        console.warn(LOG, "unidade_falhou", {
          company_id: companyId,
          error: errText,
          epoc_csv_sync_run_id: data?.epoc_csv_sync_run_id ?? null,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errText = msg;
      results.push({
        company_id: companyId,
        ok: false,
        error: msg,
      });
      console.error(LOG, "unidade_excecao", { company_id: companyId, msg });
    }

    await persistDailyAttempt(admin, companyId, syncOk, errText);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(LOG, "concluido", {
    companies: companyIds.length,
    failed,
    at: new Date().toISOString(),
  });

  return json({
    ok: failed === 0,
    companies: companyIds.length,
    failed,
    results,
  });
});

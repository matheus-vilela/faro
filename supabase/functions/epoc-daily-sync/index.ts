/**
 * Orquestra sincronização EPOC só do dia anterior (America/Sao_Paulo) para todas
 * as unidades com integração ativa. Protegida por `EPOC_DAILY_CRON_SECRET` no header
 * Authorization (verify_jwt = false). Cada unidade chama `epoc-sync-csv` com a
 * service role e `sync_mode: "previous_day"`.
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
      const ok = res.ok && data?.ok === true;
      results.push({
        company_id: companyId,
        ok,
        error: ok ? undefined : (data?.error ?? `HTTP ${res.status}`),
        csv_revenue_import_job_id: data?.csv_revenue_import_job_id ?? null,
        epoc_csv_sync_run_id: data?.epoc_csv_sync_run_id ?? null,
      });
      if (!ok) {
        console.warn(LOG, "unidade_falhou", {
          company_id: companyId,
          error: data?.error ?? res.status,
          epoc_csv_sync_run_id: data?.epoc_csv_sync_run_id ?? null,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ company_id: companyId, ok: false, error: msg });
      console.error(LOG, "unidade_excecao", { company_id: companyId, msg });
    }
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

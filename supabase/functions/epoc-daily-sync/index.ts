/**
 * Rotina EPOC do dia anterior (America/Sao_Paulo), uma unidade por invocação.
 *
 * Cron (pg_cron a cada 10 min): processa no máximo um estabelecimento com integração
 * EPOC ativa. Rodízio (`epoc_daily_sync_rotacao_at`):
 * - última tentativa **ok** (com ou sem vendas): só no **dia civil seguinte** (SP);
 * - última tentativa **falhou**: nova tentativa após **12 h**.
 * Ao reservar a unidade, grava `epoc_daily_sync_rotacao_at` antes de chamar `epoc-sync-csv`.
 *
 * Protegida por `EPOC_DAILY_CRON_SECRET` no header Authorization (verify_jwt = false).
 *
 * Body opcional:
 * - `{ "company_id": "<uuid>" }` — força uma unidade (ignora intervalo de 12 h).
 *
 * Após cada tentativa atualiza `epoc_daily_sync_last_attempt_*` (dashboard).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-daily-sync]";

const SP_TZ = "America/Sao_Paulo";

/** Intervalo mínimo entre tentativas após falha no rodízio cron. */
const ROTACAO_INTERVAL_MS = 12 * 60 * 60 * 1000;

type IntegrationRow = {
  company_id: string;
  settings: Record<string, unknown> | null;
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

function rotacaoAtMs(settings: Record<string, unknown> | null): number {
  const raw = settings?.epoc_daily_sync_rotacao_at;
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function ymdInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function spTodayYmd(): string {
  return ymdInTimeZone(new Date(), SP_TZ);
}

function lastDailyAttemptOk(
  settings: Record<string, unknown> | null,
): boolean | null {
  if (settings?.epoc_daily_sync_last_attempt_ok === true) return true;
  if (settings?.epoc_daily_sync_last_attempt_ok === false) return false;
  return null;
}

function isRotacaoDue(settings: Record<string, unknown> | null): boolean {
  const lastMs = rotacaoAtMs(settings);
  if (lastMs === 0) return true;

  const lastOk = lastDailyAttemptOk(settings);
  if (lastOk === true) {
    const rotacaoDay = ymdInTimeZone(new Date(lastMs), SP_TZ);
    return spTodayYmd() > rotacaoDay;
  }

  return Date.now() - lastMs >= ROTACAO_INTERVAL_MS;
}

function pickCompanyForRotation(
  rows: IntegrationRow[],
): IntegrationRow | null {
  const eligible = rows.filter((r) => isRotacaoDue(r.settings));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => rotacaoAtMs(a.settings) - rotacaoAtMs(b.settings));
  return eligible[0] ?? null;
}

async function reserveRotacaoAt(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ ok: boolean; rotacao_at?: string; error?: string }> {
  const { data: fresh, error: readErr } = await admin
    .from("company_integrations")
    .select("settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();

  if (readErr) {
    return { ok: false, error: readErr.message };
  }

  const base = (fresh?.settings ?? {}) as Record<string, unknown>;
  const rotacaoAt = new Date().toISOString();
  const { error } = await admin
    .from("company_integrations")
    .update({
      settings: {
        ...base,
        epoc_daily_sync_rotacao_at: rotacaoAt,
      },
      updated_at: rotacaoAt,
    })
    .eq("company_id", companyId)
    .eq("provider", "epoc");

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, rotacao_at: rotacaoAt };
}

async function persistDailyAttempt(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  ok: boolean,
  errorSummary: string | null,
  outcome?: string | null,
  consultedDayBr?: string | null,
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
    epoc_daily_sync_last_attempt_outcome: ok
      ? (outcome === "no_tbl_export" ? "no_tbl_export" : "success")
      : "failed",
    epoc_daily_sync_last_attempt_error: ok
      ? null
      : (errorSummary ?? "Erro").slice(0, 900),
  };
  if (ok && outcome === "no_tbl_export" && consultedDayBr?.trim()) {
    nextSettings.epoc_daily_sync_last_consulted_day_br = consultedDayBr.trim();
  } else if (ok && outcome === "success") {
    nextSettings.epoc_daily_sync_last_consulted_day_br = null;
  }
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

  let bodyCompanyId: string | null = null;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const body = JSON.parse(raw) as { company_id?: string };
      const id = typeof body.company_id === "string" ? body.company_id.trim() : "";
      if (id) bodyCompanyId = id;
    }
  } catch {
    /* corpo vazio ou JSON inválido: rodízio cron */
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
    .select("company_id, settings")
    .eq("provider", "epoc")
    .eq("enabled", true);

  if (listErr) {
    return json({ ok: false, error: listErr.message }, 500);
  }

  const rows: IntegrationRow[] = [
    ...new Map(
      (integrations ?? [])
        .map((r) => {
          const companyId = r.company_id as string | undefined;
          if (typeof companyId !== "string" || !companyId.length) return null;
          const settings =
            r.settings && typeof r.settings === "object" && !Array.isArray(r.settings)
              ? (r.settings as Record<string, unknown>)
              : null;
          return [companyId, { company_id: companyId, settings }] as const;
        })
        .filter((x): x is readonly [string, IntegrationRow] => x != null),
    ).values(),
  ];

  const totalEnabled = rows.length;
  let selected: IntegrationRow | null = null;
  let skipReason: string | null = null;

  if (bodyCompanyId) {
    selected = rows.find((r) => r.company_id === bodyCompanyId) ?? null;
    if (!selected) {
      return json(
        {
          ok: false,
          error: "Integração EPOC ativa não encontrada para company_id informado.",
          company_id: bodyCompanyId,
        },
        404,
      );
    }
  } else {
    selected = pickCompanyForRotation(rows);
    if (!selected) {
      skipReason =
        totalEnabled === 0
          ? "nenhuma integração EPOC ativa"
          : "todas as unidades aguardam o próximo dia (última sync ok) ou 12 h após falha";
      console.log(LOG, "rodizio_sem_unidade", {
        total_enabled: totalEnabled,
        skip: skipReason,
      });
      return json({
        ok: true,
        skipped: true,
        reason: skipReason,
        companies_enabled: totalEnabled,
        companies_processed: 0,
        rotacao_after_failure_hours: 12,
        rotacao_after_success: "proximo_dia_civil_sp",
      });
    }
  }

  const companyId = selected.company_id;
  const reserve = await reserveRotacaoAt(admin, companyId);
  if (!reserve.ok) {
    console.warn(LOG, "reserva_rotacao_falhou", {
      company_id: companyId,
      error: reserve.error,
    });
    return json(
      {
        ok: false,
        error: reserve.error ?? "Falha ao reservar rodízio",
        company_id: companyId,
      },
      500,
    );
  }

  console.log(LOG, "rodizio_inicio", {
    company_id: companyId,
    epoc_daily_sync_rotacao_at: reserve.rotacao_at,
    total_enabled: totalEnabled,
    manual: Boolean(bodyCompanyId),
  });

  const syncUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/epoc-sync-csv`;
  let syncOk = false;
  let errText: string | null = null;
  let attemptOutcome: string | null = null;
  let consultedDayBr: string | null = null;
  let syncPayload: {
    csv_revenue_import_job_id?: string | null;
    epoc_csv_sync_run_id?: string | null;
  } = {};

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
      outcome?: string;
      consulted_day_br?: string | null;
      csv_revenue_import_job_id?: string | null;
      epoc_csv_sync_run_id?: string | null;
    };
    syncOk = res.ok && data?.ok === true;
    attemptOutcome =
      typeof data?.outcome === "string" ? data.outcome.trim() : null;
    consultedDayBr =
      typeof data?.consulted_day_br === "string"
        ? data.consulted_day_br.trim()
        : null;
    errText = syncOk ? null : (data?.error ?? `HTTP ${res.status}`);
    syncPayload = {
      csv_revenue_import_job_id: data?.csv_revenue_import_job_id ?? null,
      epoc_csv_sync_run_id: data?.epoc_csv_sync_run_id ?? null,
    };
    if (!syncOk) {
      console.warn(LOG, "unidade_falhou", {
        company_id: companyId,
        error: errText,
        epoc_csv_sync_run_id: syncPayload.epoc_csv_sync_run_id,
      });
    }
  } catch (e) {
    errText = e instanceof Error ? e.message : String(e);
    console.error(LOG, "unidade_excecao", { company_id: companyId, msg: errText });
  }

  await persistDailyAttempt(
    admin,
    companyId,
    syncOk,
    errText,
    attemptOutcome,
    consultedDayBr,
  );

  console.log(LOG, "concluido", {
    company_id: companyId,
    ok: syncOk,
    total_enabled: totalEnabled,
    at: new Date().toISOString(),
  });

  return json({
    ok: syncOk,
    companies_enabled: totalEnabled,
    companies_processed: 1,
    company_id: companyId,
    rotacao_at: reserve.rotacao_at,
    rotacao_after_failure_hours: 12,
    rotacao_after_success: "proximo_dia_civil_sp",
    manual: Boolean(bodyCompanyId),
    result: {
      company_id: companyId,
      ok: syncOk,
      error: errText ?? undefined,
      ...syncPayload,
    },
  });
});

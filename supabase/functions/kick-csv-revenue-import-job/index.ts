/**
 * Retoma import CSV de receitas (EPOC): dispara job PENDING/PROCESSING,
 * reconcilia onboarding com job COMPLETED órfão, ou recria job a partir
 * do último CSV no Storage quando a fila ficou vazia.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { recoverEpocCsvRevenueImport } from "../_shared/enqueueEpocCsvRevenueImportJob.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[kick-csv-revenue-import-job]";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado" }, 401);
  }

  let body: { company_id?: string; job_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const companyId =
    typeof body.company_id === "string" ? body.company_id.trim() : "";
  const jobIdRaw = typeof body.job_id === "string" ? body.job_id.trim() : "";

  if (!companyId) {
    return json({ ok: false, error: "company_id é obrigatório" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return json({ ok: false, error: "Sessão inválida" }, 401);
  }

  const { data: member } = await userClient
    .from("user_companies")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return json({ ok: false, error: "Sem acesso a esta unidade" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const result = await recoverEpocCsvRevenueImport(admin, {
    companyId,
    requestedBy: user.id,
    supabaseUrl,
    serviceKey,
    anonKey,
    jobIdHint: jobIdRaw || undefined,
    logTag: LOG,
  });

  if (!result.ok) {
    return json(
      {
        ok: false,
        error: result.error ?? "Não foi possível retomar a importação do CSV.",
        action: result.action ?? null,
        job_id: result.job_id ?? null,
        trigger_status: result.trigger?.status ?? null,
        trigger_body: result.trigger?.body ?? null,
      },
      result.action === "recreated" ? 502 : 404,
    );
  }

  return json({
    ok: true,
    action: result.action,
    job_id: result.job_id,
    trigger_body: result.trigger?.body ?? null,
  });
});

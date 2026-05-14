/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runNfeExpenseProductMotor } from "../_shared/nfeExpenseProducts/motor.ts";
import { NFE_CATALOG_MOTOR_VERSION } from "../_shared/nfeExpenseProducts/types.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isServiceCaller = !!(serviceRole && bearer === serviceRole);
  if (!isServiceCaller) {
    return json({ ok: false, error: "Requer service role (chamada interna)." }, 403);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => ({}));
  const company_id = String((body as { company_id?: string }).company_id ?? "").trim();
  const expense_id = String((body as { expense_id?: string }).expense_id ?? "").trim();
  const import_job_file_id = String(
    (body as { import_job_file_id?: string }).import_job_file_id ?? "",
  ).trim() || undefined;
  const motor_version = String(
    (body as { motor_version?: string }).motor_version ?? NFE_CATALOG_MOTOR_VERSION,
  ).trim();
  const modeRaw = String((body as { mode?: string }).mode ?? "apply").trim().toLowerCase();
  const mode = modeRaw === "preview" ? "preview" : "apply";
  const rawFin = (body as { finalize_after_batch_insert?: unknown }).finalize_after_batch_insert;
  const finalize_after_batch_insert =
    rawFin === true || String(rawFin ?? "").trim().toLowerCase() === "true";

  if (!company_id || !expense_id) {
    return json({ ok: false, error: "company_id e expense_id obrigatórios." }, 400);
  }

  const result = await runNfeExpenseProductMotor(supabase, {
    company_id,
    expense_id,
    import_job_file_id,
    motor_version,
    mode,
    finalize_after_batch_insert,
  });

  return json({ ok: result.ok, ...result });
});

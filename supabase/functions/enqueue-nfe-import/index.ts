/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createHash } from "node:crypto";
import { unzipSync } from "npm:fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function base64FromBytes(input: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < input.length; i += 1) {
    binary += String.fromCharCode(input[i]!);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "Sessão inválida." }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "Body inválido." }, 400);
  }
  const companyId = String(form.get("company_id") ?? "").trim();
  const file = form.get("file");
  if (!companyId) return json({ ok: false, error: "company_id é obrigatório." }, 400);
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "Arquivo ZIP ausente." }, 400);
  }

  const { data: member, error: memErr } = await supabase
    .from("user_companies")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (memErr || !member) return json({ ok: false, error: "Sem acesso a esta empresa." }, 403);

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipBytes);
  } catch {
    return json({ ok: false, error: "ZIP inválido ou corrompido." }, 422);
  }
  const entries = Object.entries(unzipped).filter(([name, content]) =>
    name.toLowerCase().endsWith(".xml") && content && content.length > 0
  );
  if (!entries.length) {
    return json({ ok: false, error: "Nenhum XML válido encontrado no ZIP." }, 422);
  }

  const { data: batchRow, error: batchErr } = await supabase
    .from("import_job_batches")
    .insert({
      company_id: companyId,
      requested_by: user.id,
      source_file_name: file.name,
      status: "QUEUED",
      total_files: entries.length,
      progress_percent: 0,
    })
    .select("id")
    .single();
  if (batchErr || !batchRow?.id) {
    return json({ ok: false, error: batchErr?.message ?? "Falha ao criar lote." }, 500);
  }
  const batchId = String(batchRow.id);

  const rows = entries.map(([entryName, xmlBytes]) => ({
    batch_id: batchId,
    company_id: companyId,
    file_name: entryName,
    xml_hash: sha256Hex(xmlBytes),
    xml_content_base64: base64FromBytes(xmlBytes),
    status: "QUEUED",
  }));
  const { error: fileErr } = await supabase.from("import_job_files").insert(rows);
  if (fileErr) {
    await supabase
      .from("import_job_batches")
      .update({ status: "FAILED", last_error: fileErr.message, finished_at: new Date().toISOString() })
      .eq("id", batchId);
    return json({ ok: false, error: fileErr.message }, 500);
  }

  const triggerPromise = fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch_id: batchId }),
  }).catch(() => undefined);
  try {
    // @ts-ignore Edge runtime helper (quando disponível)
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(triggerPromise);
    }
  } catch {
    // no-op
  }

  return json({
    ok: true,
    job_batch_id: batchId,
    status: "QUEUED",
    total_xml: entries.length,
    message:
      "Importação iniciada em segundo plano. Você pode continuar usando o sistema.",
  });
});

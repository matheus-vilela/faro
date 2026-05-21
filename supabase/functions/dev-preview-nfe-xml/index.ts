/**
 * Laboratório: pré-visualiza NF-e a partir de XML (dados do parse + valor unitário efetivo).
 *
 * POST multipart: `company_id`, `file` (.xml). JWT + `user_companies`.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "./cors.ts";

const MAX_XML_BYTES = 4 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

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
    return json({ ok: false, error: "Envie um ficheiro XML." }, 400);
  }
  if (file.size > MAX_XML_BYTES) {
    return json({ ok: false, error: "XML demasiado grande (máx. 4 MB)." }, 413);
  }

  const { data: member, error: memErr } = await supabase
    .from("user_companies")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (memErr || !member) {
    return json({ ok: false, error: "Sem acesso a esta unidade." }, 403);
  }

  const name = (file.name ?? "").toLowerCase();
  if (!name.endsWith(".xml")) {
    return json({ ok: false, error: "Use um ficheiro .xml (NF-e autorizada)." }, 400);
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const xmlText = new TextDecoder().decode(buf);

  const { handleDevPreview } = await import("./preview_impl.ts");
  return handleDevPreview({
    fileName: file.name || "nota.xml",
    xmlText,
  });
});

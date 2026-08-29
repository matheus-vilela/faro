/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendZapiText } from "../_shared/zapiSendText.ts";

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

function publicAppBaseUrl(): string {
  const u = Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  return u.replace(/\/$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let runId = "";
  try {
    const body = await req.json();
    runId = String(body?.run_id ?? "").trim();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!runId) {
    return json({ ok: false, error: "run_id_required" }, 400);
  }

  const service = createClient(supabaseUrl, serviceKey);
  const { data: run, error: runErr } = await service
    .from("checklist_runs")
    .select(
      `
      id, company_id, status, review_notes, token,
      checklists ( title ),
      company_members ( name, phone_normalized ),
      checklist_run_short_links ( slug )
    `,
    )
    .eq("id", runId)
    .maybeSingle();

  if (runErr || !run) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  const { data: allowed } = await userClient.rpc("user_has_company_access", {
    p_company_id: run.company_id,
  });
  if (allowed !== true) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  if (run.status !== "needs_rework") {
    return json({ ok: false, error: "not_rework" }, 409);
  }

  const member = Array.isArray(run.company_members)
    ? run.company_members[0]
    : run.company_members;
  const phone = String(member?.phone_normalized ?? "").trim();
  if (!phone) {
    return json({ ok: false, error: "no_phone", skipped: true });
  }

  const linkEmbed = run.checklist_run_short_links;
  const slug = Array.isArray(linkEmbed)
    ? linkEmbed[0]?.slug
    : linkEmbed?.slug;
  const base = publicAppBaseUrl();
  const url = slug && base
    ? `${base}/k/${slug}`
    : slug
      ? `/k/${slug}`
      : run.token && base
        ? `${base}/checklist/${run.token}`
        : "";

  if (!url) {
    return json({ ok: false, error: "link_unavailable" }, 500);
  }

  const title =
    (Array.isArray(run.checklists) ? run.checklists[0]?.title : run.checklists?.title) ||
    "Checklist";
  const notes = String(run.review_notes ?? "").trim();
  const lines = [
    `*Refazer checklist*`,
    title,
    "",
    "O gestor pediu para você corrigir e enviar de novo. Use o mesmo link:",
    url,
  ];
  if (notes) {
    lines.push("", `Observação: ${notes}`);
  }

  const sent = await sendZapiText(
    phone,
    lines.join("\n"),
    "[notify-checklist-rework]",
  );
  if (!sent.ok) {
    return json({ ok: false, error: sent.code, detail: sent.error });
  }

  return json({ ok: true });
});

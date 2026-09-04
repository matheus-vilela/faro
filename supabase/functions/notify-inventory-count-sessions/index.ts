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

type NameRel = { name?: string | null } | { name?: string | null }[] | null;

function relationName(rel: NameRel): string {
  if (!rel) return "";
  if (Array.isArray(rel)) return (rel[0]?.name ?? "").trim();
  return (rel.name ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let sessionIds: string[] = [];
  try {
    const body = await req.json();
    const raw = body?.session_ids;
    if (Array.isArray(raw)) {
      sessionIds = raw.map((id) => String(id)).filter(Boolean);
    }
  } catch {
    sessionIds = [];
  }

  const service = createClient(supabaseUrl, serviceKey);
  let query = service
    .from("inventory_count_sessions")
    .select(
      `
      id, company_id, token, operator_notified_at,
      inventory_count_groups ( name ),
      inventory_count_listings ( name ),
      assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey (
        name, phone_normalized
      ),
      inventory_count_short_links ( slug )
    `,
    )
    .in("status", ["open", "returned"])
    .is("operator_notified_at", null)
    .not("assigned_company_member_id", "is", null);

  if (sessionIds.length > 0) {
    query = query.in("id", sessionIds);
  }

  const { data, error } = await query.limit(80);
  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  const base = publicAppBaseUrl();
  let sent = 0;
  let skipped = 0;

  for (const row of data ?? []) {
    const { data: allowed } = await userClient.rpc("user_has_company_access", {
      p_company_id: row.company_id,
    });
    if (allowed !== true) {
      skipped += 1;
      continue;
    }

    const member = Array.isArray(row.assigned_member)
      ? row.assigned_member[0]
      : row.assigned_member;
    const phone = String(member?.phone_normalized ?? "").trim();
    if (!phone) {
      skipped += 1;
      continue;
    }

    const linkEmbed = row.inventory_count_short_links;
    const slug = Array.isArray(linkEmbed)
      ? linkEmbed[0]?.slug
      : linkEmbed?.slug;
    const url = slug && base
      ? `${base}/i/${slug}`
      : row.token && base
        ? `${base}/contagem-estoque/${row.token}`
        : "";
    if (!url) {
      skipped += 1;
      continue;
    }

    const group = relationName(row.inventory_count_groups);
    const listing = relationName(row.inventory_count_listings);
    const title = [group, listing].filter(Boolean).join(" · ") || "Contagem de estoque";
    const lines = [
      "*Contagem de estoque*",
      title,
      "",
      "Abra o link, conte item a item (sem ver o esperado) e envie para aprovação.",
      url,
    ];

    const result = await sendZapiText(
      phone,
      lines.join("\n"),
      "[notify-inventory-count-sessions]",
    );
    if (!result.ok) {
      skipped += 1;
      continue;
    }

    await service
      .from("inventory_count_sessions")
      .update({ operator_notified_at: new Date().toISOString() })
      .eq("id", row.id);
    sent += 1;
  }

  return json({ ok: true, sent, skipped });
});

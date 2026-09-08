import { randomShortSlug } from "@/lib/randomSlug";
import { supabase } from "@/lib/supabase";
import type { OpenInventoryCountSessionResult } from "@/types/inventoryCount";

export type InventoryCountShortLinkEmbed =
  | { slug?: string | null }
  | { slug?: string | null }[]
  | null;

export type InventoryCountSessionSummary = {
  id: string;
  status: string;
  kind: string | null;
  inventory_count_listing_id: string | null;
  created_at: string;
  token: string | null;
  inventory_count_short_links?: InventoryCountShortLinkEmbed;
  inventory_count_lines?: { count: number }[] | { count: number } | null;
};

export function inventoryCountPublicUrl(params: {
  slug?: string | null;
  token?: string | null;
}): string {
  const base = window.location.origin.replace(/\/$/, "");
  if (params.slug) return `${base}/i/${params.slug}`;
  if (params.token) return `${base}/contagem-estoque/${params.token}`;
  return base;
}

export function isReusableCountStatus(status: string): boolean {
  return status === "open" || status === "returned";
}

export function slugFromCountShortLinks(
  raw: InventoryCountShortLinkEmbed | undefined,
): string | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  const s = row?.slug;
  return typeof s === "string" && s ? s : null;
}

export function publicUrlForSession(params: {
  slug?: string | null;
  token?: string | null;
  inventory_count_short_links?: InventoryCountShortLinkEmbed;
}): string {
  return inventoryCountPublicUrl({
    slug: params.slug ?? slugFromCountShortLinks(params.inventory_count_short_links),
    token: params.token,
  });
}

export function activeSessionsForListing(
  sessions: InventoryCountSessionSummary[],
  listingId: string,
): InventoryCountSessionSummary[] {
  return sessions
    .filter(
      (s) =>
        s.inventory_count_listing_id === listingId &&
        isReusableCountStatus(s.status),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

export function listingHasPendingApproval(
  sessions: InventoryCountSessionSummary[],
  listingId: string,
): boolean {
  return sessions.some(
    (s) =>
      s.inventory_count_listing_id === listingId &&
      s.status === "pending_approval",
  );
}

/** Status da sessão ativa mais recente por listagem (badge na aba Listas). */
export function listingActiveStatusById(
  sessions: InventoryCountSessionSummary[],
): Map<string, "open" | "returned"> {
  const out = new Map<string, "open" | "returned">();
  const newestFirst = [...sessions].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const s of newestFirst) {
    const listingId = s.inventory_count_listing_id;
    if (!listingId || out.has(listingId)) continue;
    if (s.status === "open" || s.status === "returned") {
      out.set(listingId, s.status);
    }
  }
  return out;
}

export function activeCountStatusLabel(status: string): string {
  return status === "returned" ? "Recontagem" : "Em andamento";
}

export function formatCountSessionWhen(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shouldAskToReuseCount(
  listingIds: string[],
  sessions: InventoryCountSessionSummary[],
): boolean {
  return listingIds.some(
    (id) => activeSessionsForListing(sessions, id).length > 0,
  );
}

export function splitListingsForCountMode(
  listingIds: string[],
  sessions: InventoryCountSessionSummary[],
  mode: "create-all" | "reuse-and-fill",
): { reuseIds: string[]; createIds: string[] } {
  if (mode === "create-all") {
    return { reuseIds: [], createIds: [...listingIds] };
  }
  const reuseIds: string[] = [];
  const createIds: string[] = [];
  for (const id of listingIds) {
    if (activeSessionsForListing(sessions, id)[0]) reuseIds.push(id);
    else createIds.push(id);
  }
  return { reuseIds, createIds };
}

export async function openInventoryCountSession(params: {
  companyId: string;
  listingId?: string | null;
  kind?: "regular" | "onboarding";
  assignedCompanyMemberId?: string | null;
}): Promise<OpenInventoryCountSessionResult> {
  const { data, error } = await supabase.rpc("open_inventory_count_session", {
    p_company_id: params.companyId,
    p_listing_id: params.listingId ?? null,
    p_kind: params.kind ?? "regular",
    p_assigned_company_member_id: params.assignedCompanyMemberId ?? null,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return (data ?? { ok: false, error: "empty" }) as OpenInventoryCountSessionResult;
}

/** Fallback local se a RPC ainda não estiver no banco. */
export async function openInventoryCountSessionFallback(params: {
  companyId: string;
  groupId: string | null;
  listingId: string | null;
  assignedCompanyMemberId: string | null;
  kind?: "regular" | "onboarding";
}): Promise<{ url: string; label: string; sessionId?: string }> {
  const rpc = await openInventoryCountSession({
    companyId: params.companyId,
    listingId: params.listingId,
    kind: params.kind,
    assignedCompanyMemberId: params.assignedCompanyMemberId,
  });
  if (rpc.ok && (rpc.slug || rpc.token)) {
    return {
      url: inventoryCountPublicUrl({ slug: rpc.slug, token: rpc.token }),
      label: rpc.listing_name || rpc.group_name || "Contagem",
      sessionId: rpc.session_id,
    };
  }

  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id ?? null;
  const { data: sess, error: se } = await supabase
    .from("inventory_count_sessions")
    .insert({
      company_id: params.companyId,
      status: "open",
      created_by_user_id: uid,
      inventory_count_group_id: params.groupId,
      inventory_count_listing_id: params.listingId,
      assigned_company_member_id: params.assignedCompanyMemberId,
      validate_live: false,
      kind: params.kind ?? "regular",
    })
    .select("id, token")
    .single();
  if (se || !sess?.id || !sess?.token) {
    throw new Error(se?.message ?? rpc.error ?? "Falha ao criar sessão.");
  }
  await supabase.rpc("seed_inventory_count_lines", { p_session_id: sess.id });
  let slug: string | null = null;
  for (let i = 0; i < 15; i++) {
    const s = randomShortSlug(8);
    const { error: le } = await supabase.from("inventory_count_short_links").insert({
      company_id: params.companyId,
      slug: s,
      session_id: sess.id,
      token: sess.token,
    });
    if (!le) {
      slug = s;
      break;
    }
    if ((le as { code?: string }).code !== "23505") {
      throw new Error(le.message);
    }
  }
  return {
    url: inventoryCountPublicUrl({ slug, token: sess.token }),
    label: "Contagem",
    sessionId: sess.id as string,
  };
}

export async function notifyInventoryCountSessions(
  sessionIds: string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  try {
    await supabase.functions.invoke("notify-inventory-count-sessions", {
      body: { session_ids: sessionIds },
    });
  } catch {
    /* WhatsApp é best-effort; o link já existe. */
  }
}

export async function processDueInventoryCountSchedules(): Promise<string[]> {
  const { data, error } = await supabase.rpc(
    "process_due_inventory_count_schedules",
  );
  if (error) {
    console.error(error);
    return [];
  }
  const row = data as { ok?: boolean; session_ids?: string[] } | null;
  return Array.isArray(row?.session_ids) ? row.session_ids : [];
}

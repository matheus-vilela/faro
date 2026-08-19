/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { ensureShortSlug } from "../_shared/randomShortSlug.ts";
import { withFaroFlowFooter } from "./whatsappFlowFooter.ts";

type SendWhatsappMessageFn = (
  phoneDigits: string,
  message: string,
  logContext?: string,
  flowId?: string,
) => Promise<{ ok: boolean }>;

type InventoryAuth = {
  companyId: string;
  senderNormalized: string;
  companyMemberId: string | null;
  role: "owner" | "member";
};

function normalizeSingleCommandWord(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Comandos: *estoque*, *inventario* (sem acento após normalizar). */
export function isInventoryCommand(text: string): boolean {
  const w = normalizeSingleCommandWord(text);
  return w === "estoque" || w === "inventario";
}

/**
 * *nova* ou *nova contagem* — força novo link (membro com pendências).
 * Não confundir com palavras como "novamente".
 */
export function isNovaInventoryCommand(text: string): boolean {
  const parts = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0] !== "nova") return false;
  if (parts.length === 1) return true;
  return parts[1] === "contagem";
}

function publicAppAbsoluteBase(): string {
  const raw = Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  const u = raw.replace(/\/$/, "");
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

async function ensureInventoryShortSlug(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  sessionId: string,
  tokenUuid: string,
): Promise<string | null> {
  return ensureShortSlug({
    supabase: supabase as Parameters<typeof ensureShortSlug>[0]["supabase"],
    table: "inventory_count_short_links",
    companyId,
    fkColumn: "session_id",
    fkValue: sessionId,
    token: tokenUuid,
    logPrefix: "[inventory-flow]",
  });
}

type SupabaseClient = ReturnType<typeof createClient>;

type NameRel =
  | { name?: string | null }
  | { name?: string | null }[]
  | null
  | undefined;

function relationName(rel: NameRel): string {
  if (!rel) return "";
  if (Array.isArray(rel)) return (rel[0]?.name ?? "").trim();
  return (rel.name ?? "").trim();
}

type PendingSessionRow = {
  id?: string;
  token: string;
  created_at: string;
  inventory_count_listing_id?: string | null;
  inventory_count_groups?: NameRel;
  inventory_count_listings?: NameRel;
  inventory_count_short_links?:
    | { slug?: string | null }
    | { slug?: string | null }[]
    | null;
};

type ListingWithProducts = {
  id: string;
  name: string;
  inventory_count_group_id: string;
  assigned_company_member_id: string | null;
  group_name: string;
};

type CountLink = {
  label: string;
  url: string;
};

function sessionLabel(groupName: string, listingName: string): string {
  const g = groupName.trim();
  const l = listingName.trim();
  if (g && l) return `Grupo: *${g}* · Lista: *${l}*`;
  if (g) return `Grupo: *${g}*`;
  if (l) return `Lista: *${l}*`;
  return "Sem grupo/lista definida";
}

function shortLinkSlugFromRow(row: PendingSessionRow): string | null {
  const raw = row.inventory_count_short_links;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const s = raw[0]?.slug;
    return typeof s === "string" && s ? s : null;
  }
  const s = raw.slug;
  return typeof s === "string" && s ? s : null;
}

const OPEN_SESSION_SELECT = `
  id,
  token,
  created_at,
  inventory_count_listing_id,
  inventory_count_groups ( name ),
  inventory_count_listings ( name ),
  inventory_count_short_links ( slug )
`;

async function fetchPendingAssignedOpenSessions(
  supabase: SupabaseClient,
  companyId: string,
  memberId: string,
  listingScopedOnly: boolean,
): Promise<PendingSessionRow[]> {
  let query = supabase
    .from("inventory_count_sessions")
    .select(OPEN_SESSION_SELECT)
    .eq("company_id", companyId)
    .eq("assigned_company_member_id", memberId)
    .in("status", ["open", "returned"])
    .order("created_at", { ascending: false });

  if (listingScopedOnly) {
    query = query.not("inventory_count_listing_id", "is", null);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[inventory-flow] fetch pending sessions:", error.message);
    return [];
  }
  return (data ?? []) as PendingSessionRow[];
}

async function fetchOpenListingSessions(
  supabase: SupabaseClient,
  companyId: string,
): Promise<PendingSessionRow[]> {
  const { data, error } = await supabase
    .from("inventory_count_sessions")
    .select(OPEN_SESSION_SELECT)
    .eq("company_id", companyId)
    .in("status", ["open", "returned"])
    .not("inventory_count_listing_id", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[inventory-flow] fetch open listing sessions:", error.message);
    return [];
  }
  return (data ?? []) as PendingSessionRow[];
}

async function companyHasCountGroups(
  supabase: SupabaseClient,
  companyId: string,
): Promise<boolean | null> {
  const { count, error } = await supabase
    .from("inventory_count_groups")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (error) {
    console.error("[inventory-flow] count groups:", error.message);
    return null;
  }
  return (count ?? 0) > 0;
}

async function fetchListingsWithProducts(
  supabase: SupabaseClient,
  companyId: string,
  assignedMemberId?: string | null,
): Promise<ListingWithProducts[] | null> {
  let query = supabase
    .from("inventory_count_listings")
    .select(
      `
      id,
      name,
      inventory_count_group_id,
      assigned_company_member_id,
      sort_order,
      inventory_count_groups ( name ),
      inventory_count_listing_products ( product_id )
    `,
    )
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (assignedMemberId) {
    query = query.eq("assigned_company_member_id", assignedMemberId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[inventory-flow] fetch listings:", error.message);
    return null;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    inventory_count_group_id: string;
    assigned_company_member_id: string | null;
    inventory_count_groups?: NameRel;
    inventory_count_listing_products?: { product_id?: string }[] | null;
  }>;

  return rows
    .filter((row) => (row.inventory_count_listing_products?.length ?? 0) > 0)
    .map((row) => ({
      id: row.id,
      name: row.name,
      inventory_count_group_id: row.inventory_count_group_id,
      assigned_company_member_id: row.assigned_company_member_id,
      group_name: relationName(row.inventory_count_groups),
    }));
}

async function memberHasAssignedListings(
  supabase: SupabaseClient,
  companyId: string,
  memberId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("inventory_count_listings")
    .select("id")
    .eq("company_id", companyId)
    .eq("assigned_company_member_id", memberId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[inventory-flow] fetch assigned listings:", error.message);
    return null;
  }
  return Boolean(data?.id);
}

async function sessionToCountLink(
  supabase: SupabaseClient,
  companyId: string,
  row: PendingSessionRow,
  base: string,
): Promise<CountLink> {
  let slug = shortLinkSlugFromRow(row);
  if (!slug && row.id) {
    slug = await ensureInventoryShortSlug(
      supabase,
      companyId,
      row.id,
      row.token,
    );
  }
  const url = slug
    ? `${base}/i/${slug}`
    : `${base}/contagem-estoque/${row.token}`;
  return {
    label: sessionLabel(
      relationName(row.inventory_count_groups),
      relationName(row.inventory_count_listings),
    ),
    url,
  };
}

async function createListingSessionLink(
  supabase: SupabaseClient,
  auth: InventoryAuth,
  listing: ListingWithProducts,
  base: string,
): Promise<CountLink | null> {
  const assignedMemberId =
    auth.role === "member"
      ? auth.companyMemberId
      : listing.assigned_company_member_id;

  const { data: sess, error: se } = await supabase
    .from("inventory_count_sessions")
    .insert({
      company_id: auth.companyId,
      company_member_id: auth.companyMemberId,
      assigned_company_member_id: assignedMemberId,
      status: "open",
      inventory_count_group_id: listing.inventory_count_group_id,
      inventory_count_listing_id: listing.id,
    })
    .select("id, token")
    .single();

  if (se || !sess?.id || !sess?.token) {
    console.error("[inventory-flow] insert listing session:", se?.message);
    return null;
  }

  await supabase.rpc("seed_inventory_count_lines", {
    p_session_id: sess.id,
  });

  const slug = await ensureInventoryShortSlug(
    supabase,
    auth.companyId,
    sess.id as string,
    sess.token as string,
  );
  const token = String(sess.token);
  return {
    label: sessionLabel(listing.group_name, listing.name),
    url: slug ? `${base}/i/${slug}` : `${base}/contagem-estoque/${token}`,
  };
}

function formatPendingInventoryMessage(
  rows: PendingSessionRow[],
  base: string,
): string {
  const lines: string[] = [
    "Você tem *contagens de estoque pendentes em seu nome* (ainda não enviadas):",
    "",
  ];
  rows.forEach((row, i) => {
    const slug = shortLinkSlugFromRow(row);
    const url = slug
      ? `${base}/i/${slug}`
      : `${base}/contagem-estoque/${row.token}`;
    lines.push(
      `${i + 1}) ${sessionLabel(
        relationName(row.inventory_count_groups),
        relationName(row.inventory_count_listings),
      )}`,
    );
    lines.push(url);
    lines.push("");
  });
  lines.push(
    "Para abrir um *novo* link de contagem (além destes), responda *nova* ou *nova contagem*.",
  );
  return lines.join("\n");
}

function formatCountLinksMessage(links: CountLink[]): string {
  const lines: string[] = [
    "*Contagem de estoque* 🍺",
    "",
    links.length === 1
      ? "Oi! Hora da contagem. Abra o link, conte item a item (sem ver o esperado) e envie para aprovação."
      : "Oi! Hora da contagem. Abra o link da *sua listagem*, conte item a item (sem ver o esperado) e envie para aprovação.",
    "",
  ];
  if (links.length === 1) {
    const only = links[0]!;
    if (only.label !== "Sem grupo/lista definida") {
      lines.push(only.label);
    }
    lines.push(only.url);
  } else {
    links.forEach((link, i) => {
      lines.push(`${i + 1}) ${link.label}`);
      lines.push(link.url);
      lines.push("");
    });
  }
  lines.push("");
  lines.push(
    "Se algo ficar fora da faixa, o Faro pede para conferir de novo — sem mostrar o número.",
  );
  return lines.join("\n");
}

export type SendInventoryCountLinkOptions = {
  /** Ignora lista de pendentes e cria nova sessão (comando *nova*). */
  forceNew?: boolean;
};

/**
 * Cria sessão de contagem e envia link curto /i/:slug (ou URL com token completo).
 */
export async function sendInventoryCountLink(
  supabase: ReturnType<typeof createClient>,
  auth: InventoryAuth,
  sendWhatsappMessage: SendWhatsappMessageFn,
  flowId?: string,
  options?: SendInventoryCountLinkOptions,
): Promise<void> {
  const forceNew = options?.forceNew === true;
  let hasGroups: boolean | null = null;

  if (auth.role === "member") {
    if (!auth.companyMemberId) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Não foi possível validar seu cadastro de membro. Tente novamente.",
        ),
        "inventory_membro_sem_id",
        flowId,
      );
      return;
    }
    const { data: mem, error: me } = await supabase
      .from("company_members")
      .select("can_inventory_count, is_active")
      .eq("id", auth.companyMemberId)
      .maybeSingle();

    if (me) {
      console.error("[inventory-flow] fetch member permission:", me.message);
      await sendWhatsappMessage(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Não foi possível verificar sua permissão agora. Tente de novo em instantes.",
        ),
        "inventory_erro_permissao",
        flowId,
      );
      return;
    }

    const row = mem as {
      can_inventory_count?: boolean;
      is_active?: boolean;
    } | null;

    if (!row?.is_active || !row.can_inventory_count) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Você não tem permissão para contagem de estoque. O proprietário pode habilitar em *Configurações* → *Usuários e membros* (coluna de permissão de inventário).",
        ),
        "inventory_sem_permissao_membro",
        flowId,
      );
      return;
    }

    hasGroups = await companyHasCountGroups(supabase, auth.companyId);
    if (hasGroups === null) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Não foi possível consultar os grupos de contagem agora. Tente de novo em instantes.",
        ),
        "inventory_erro_grupos",
        flowId,
      );
      return;
    }

    if (!forceNew && auth.companyMemberId) {
      const pending = await fetchPendingAssignedOpenSessions(
        supabase,
        auth.companyId,
        auth.companyMemberId,
        hasGroups,
      );
      if (pending.length > 0) {
        const base = publicAppAbsoluteBase();
        if (!base) {
          await sendWhatsappMessage(
            auth.senderNormalized,
            withFaroFlowFooter(
              "Você tem contagens pendentes, mas o link público não está configurado (PUBLIC_APP_URL). Configure no painel ou use o link enviado antes.",
            ),
            "inventory_pendentes_sem_base_url",
            flowId,
          );
          return;
        }
        await sendWhatsappMessage(
          auth.senderNormalized,
          withFaroFlowFooter(formatPendingInventoryMessage(pending, base)),
          "inventory_lista_pendentes",
          flowId,
        );
        return;
      }
    }
  }

  const { data: oneProduct, error: pe } = await supabase
    .from("products")
    .select("id")
    .eq("company_id", auth.companyId)
    .or("is_active.is.null,is_active.eq.true")
    .limit(1)
    .maybeSingle();

  if (pe) {
    console.error("[inventory-flow] list products:", pe.message);
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível consultar os produtos agora. Tente de novo em instantes.",
      ),
      "inventory_erro_produtos",
      flowId,
    );
    return;
  }

  if (!oneProduct?.id) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não há produtos ativos cadastrados. Cadastre produtos em *Produtos* no painel do Faro antes da contagem.",
      ),
      "inventory_sem_produtos",
      flowId,
    );
    return;
  }

  if (hasGroups === null) {
    hasGroups = await companyHasCountGroups(supabase, auth.companyId);
  }
  if (hasGroups === null) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível consultar os grupos de contagem agora. Tente de novo em instantes.",
      ),
      "inventory_erro_grupos",
      flowId,
    );
    return;
  }

  const base = publicAppAbsoluteBase();
  if (!base) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Link indisponível (PUBLIC_APP_URL). Use a contagem pelo painel em Produtos.",
      ),
      "inventory_sem_base_url",
      flowId,
    );
    return;
  }

  if (hasGroups) {
    await sendListingScopedCountLinks(
      supabase,
      auth,
      sendWhatsappMessage,
      flowId,
      base,
    );
    return;
  }

  const { data: sess, error: se } = await supabase
    .from("inventory_count_sessions")
    .insert({
      company_id: auth.companyId,
      company_member_id: auth.companyMemberId,
      assigned_company_member_id:
        auth.role === "member" ? auth.companyMemberId : null,
      status: "open",
    })
    .select("id, token")
    .single();

  if (se || !sess?.id || !sess?.token) {
    console.error("[inventory-flow] insert session:", se?.message);
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível abrir a contagem de estoque. Tente novamente.",
      ),
      "inventory_erro_sessao",
      flowId,
    );
    return;
  }

  await supabase.rpc("seed_inventory_count_lines", {
    p_session_id: sess.id,
  });

  const slug = await ensureInventoryShortSlug(
    supabase,
    auth.companyId,
    sess.id as string,
    sess.token as string,
  );
  const token = String(sess.token);
  const link = slug ? `${base}/i/${slug}` : `${base}/contagem-estoque/${token}`;

  await sendWhatsappMessage(
    auth.senderNormalized,
    withFaroFlowFooter(
      formatCountLinksMessage([{ label: "Sem grupo/lista definida", url: link }]),
    ),
    "inventory_link_enviado",
    flowId,
  );
}

async function sendListingScopedCountLinks(
  supabase: SupabaseClient,
  auth: InventoryAuth,
  sendWhatsappMessage: SendWhatsappMessageFn,
  flowId: string | undefined,
  base: string,
): Promise<void> {
  const assignedFilter =
    auth.role === "member" ? auth.companyMemberId : null;
  const listings = await fetchListingsWithProducts(
    supabase,
    auth.companyId,
    assignedFilter,
  );

  if (listings === null) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível consultar as listagens de contagem agora. Tente de novo em instantes.",
      ),
      "inventory_erro_listagens",
      flowId,
    );
    return;
  }

  if (listings.length === 0) {
    if (auth.role === "member" && auth.companyMemberId) {
      const assigned = await memberHasAssignedListings(
        supabase,
        auth.companyId,
        auth.companyMemberId,
      );
      if (assigned === null) {
        await sendWhatsappMessage(
          auth.senderNormalized,
          withFaroFlowFooter(
            "Não foi possível consultar as listagens de contagem agora. Tente de novo em instantes.",
          ),
          "inventory_erro_listagens",
          flowId,
        );
        return;
      }
      await sendWhatsappMessage(
        auth.senderNormalized,
        withFaroFlowFooter(
          assigned
            ? "As listagens atribuídas a você ainda não têm produtos. Peça ao responsável para incluir os itens em *Produtos* → *Contagem*."
            : "Sua empresa usa grupos de contagem. Você não está atribuído a nenhuma listagem. Peça ao responsável para atribuir você na aba *Contagem* ou gerar o link por lá.",
        ),
        assigned
          ? "inventory_listagem_sem_produtos"
          : "inventory_membro_sem_listagem",
        flowId,
      );
      return;
    }

    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Cadastre produtos nas listagens em *Produtos* → *Contagem* antes de contar pelo WhatsApp. Listagens vazias (como Lista principal) não entram na contagem.",
      ),
      "inventory_grupos_sem_produtos",
      flowId,
    );
    return;
  }

  const links: CountLink[] = [];

  if (auth.role === "owner") {
    const openByListing = new Map<string, PendingSessionRow>();
    const openRows = await fetchOpenListingSessions(supabase, auth.companyId);
    for (const row of openRows) {
      const listingId = row.inventory_count_listing_id;
      if (!listingId || openByListing.has(listingId)) continue;
      openByListing.set(listingId, row);
    }

    for (const listing of listings) {
      const existing = openByListing.get(listing.id);
      if (existing) {
        links.push(
          await sessionToCountLink(supabase, auth.companyId, existing, base),
        );
        continue;
      }
      const created = await createListingSessionLink(
        supabase,
        auth,
        listing,
        base,
      );
      if (created) links.push(created);
    }
  } else {
    for (const listing of listings) {
      const created = await createListingSessionLink(
        supabase,
        auth,
        listing,
        base,
      );
      if (created) links.push(created);
    }
  }

  if (links.length === 0) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível abrir a contagem de estoque. Tente novamente.",
      ),
      "inventory_erro_sessao",
      flowId,
    );
    return;
  }

  await sendWhatsappMessage(
    auth.senderNormalized,
    withFaroFlowFooter(formatCountLinksMessage(links)),
    "inventory_link_enviado",
    flowId,
  );
}

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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

function randomShortSlug(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
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
  sessionId: string,
  tokenUuid: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("inventory_count_short_links")
    .select("slug")
    .eq("session_id", sessionId)
    .maybeSingle();

  const row = existing as { slug?: string } | null;
  if (row?.slug && typeof row.slug === "string") return row.slug;

  for (let attempt = 0; attempt < 15; attempt++) {
    const slug = randomShortSlug(8);
    const { error } = await supabase.from("inventory_count_short_links").insert({
      slug,
      session_id: sessionId,
      token: tokenUuid,
    });
    if (!error) return slug;
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error("[inventory-flow] ensureInventoryShortSlug:", error.message);
      return null;
    }
  }
  return null;
}

/**
 * Cria sessão de contagem e envia link curto /i/:slug (ou URL com token completo).
 */
export async function sendInventoryCountLink(
  supabase: ReturnType<typeof createClient>,
  auth: InventoryAuth,
  sendWhatsappMessage: SendWhatsappMessageFn,
  flowId?: string,
): Promise<void> {
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

  const { data: sess, error: se } = await supabase
    .from("inventory_count_sessions")
    .insert({
      company_id: auth.companyId,
      company_member_id: auth.companyMemberId,
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

  const slug = await ensureInventoryShortSlug(
    supabase,
    sess.id as string,
    sess.token as string,
  );
  const token = String(sess.token);
  const link = slug ? `${base}/i/${slug}` : `${base}/contagem-estoque/${token}`;

  await sendWhatsappMessage(
    auth.senderNormalized,
    withFaroFlowFooter(
      [
        "*Contagem de estoque*",
        "",
        "Abra o link, informe a quantidade contada de cada item e envie ao final.",
        "",
        link,
        "",
        "O link expira após o envio da contagem.",
      ].join("\n"),
    ),
    "inventory_link_enviado",
    flowId,
  );
}

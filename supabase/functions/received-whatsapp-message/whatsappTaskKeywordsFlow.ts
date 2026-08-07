/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { randomShortSlug } from "../_shared/randomShortSlug.ts";
import { withFaroFlowFooter } from "./whatsappFlowFooter.ts";

type SendWhatsappMessageFn = (
  phoneDigits: string,
  message: string,
  logContext?: string,
  flowId?: string,
) => Promise<{ ok: boolean }>;

type Auth = {
  companyId: string;
  senderNormalized: string;
  companyMemberId: string | null;
};

function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function publicBase(): string {
  const raw = Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  const u = raw.replace(/\/$/, "");
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

/** hoje | semana | mes | contagens | desempenho | ajuda */
export function matchTaskKeyword(
  text: string,
): "hoje" | "semana" | "mes" | "contagens" | "desempenho" | "ajuda" | null {
  const w = norm(text);
  if (w === "hoje") return "hoje";
  if (w === "semana") return "semana";
  if (w === "mes" || w === "mês") return "mes";
  if (w === "contagens" || w === "contagem") return "contagens";
  if (w === "desempenho" || w === "meu desempenho") return "desempenho";
  if (w === "ajuda") return "ajuda";
  return null;
}

export async function handleTaskKeyword(params: {
  supabase: ReturnType<typeof createClient>;
  auth: Auth;
  keyword: NonNullable<ReturnType<typeof matchTaskKeyword>>;
  sendWhatsappMessage: SendWhatsappMessageFn;
  flowId?: string;
}): Promise<void> {
  const { supabase, auth, keyword, sendWhatsappMessage, flowId } = params;
  const base = publicBase();

  if (!auth.companyMemberId) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Essas palavras-chave são para operadores cadastrados como membros da equipe.",
      ),
      "kw_sem_membro",
      flowId,
    );
    return;
  }

  if (keyword === "ajuda") {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        [
          "Oi! Quer ver suas tarefas? É só me mandar uma palavra:",
          "",
          "🔸 *HOJE* — tarefas de hoje",
          "🔸 *CONTAGENS* — suas contagens de estoque",
          "🔸 *SEMANA* — a semana toda",
          "🔸 *MÊS* — seu resumo do mês",
          "🔸 *DESEMPENHO* — abrir Meu desempenho",
          "🔸 *CHECKLIST* — menu de checklists",
          "🔸 *ESTOQUE* — nova contagem",
        ].join("\n"),
      ),
      "kw_ajuda",
      flowId,
    );
    return;
  }

  if (keyword === "desempenho") {
    const { data: existing } = await supabase
      .from("staff_performance_links")
      .select("slug, token")
      .eq("company_member_id", auth.companyMemberId)
      .maybeSingle();

    let slug = existing?.slug as string | undefined;
    let token = existing?.token as string | undefined;
    if (!slug) {
      slug = randomShortSlug(8);
      const { data: inserted, error } = await supabase
        .from("staff_performance_links")
        .insert({
          slug,
          company_id: auth.companyId,
          company_member_id: auth.companyMemberId,
        })
        .select("slug, token")
        .single();
      if (error || !inserted) {
        // retry once via ensure helper shape
        slug = randomShortSlug(8);
        const ins2 = await supabase.from("staff_performance_links").insert({
          slug,
          company_id: auth.companyId,
          company_member_id: auth.companyMemberId,
        }).select("slug, token").single();
        if (ins2.error || !ins2.data) {
          await sendWhatsappMessage(
            auth.senderNormalized,
            withFaroFlowFooter("Não consegui gerar o link de desempenho agora."),
            "kw_desempenho_erro",
            flowId,
          );
          return;
        }
        slug = ins2.data.slug;
        token = ins2.data.token;
      } else {
        token = inserted.token;
      }
    }

    const link = base
      ? `${base}/d/${slug}`
      : token
        ? `(token ${token})`
        : "";
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        [
          "*Meu desempenho*",
          "",
          "Abra para ver prazo, completo e preciso dos últimos dias:",
          link,
        ].join("\n"),
      ),
      "kw_desempenho",
      flowId,
    );
    return;
  }

  if (keyword === "contagens") {
    const { data } = await supabase
      .from("inventory_count_sessions")
      .select("token, status, inventory_count_short_links(slug)")
      .eq("company_id", auth.companyId)
      .eq("assigned_company_member_id", auth.companyMemberId)
      .in("status", ["open", "returned"])
      .order("created_at", { ascending: false })
      .limit(5);

    if (!data?.length) {
      await sendWhatsappMessage(
        auth.senderNormalized,
        withFaroFlowFooter(
          "Você não tem contagens pendentes. Mande *estoque* para abrir uma nova.",
        ),
        "kw_contagens_vazio",
        flowId,
      );
      return;
    }

    const lines = ["Suas *contagens* abertas:", ""];
    for (const row of data) {
      const sl = Array.isArray(row.inventory_count_short_links)
        ? row.inventory_count_short_links[0]?.slug
        : row.inventory_count_short_links?.slug;
      const url = base
        ? sl
          ? `${base}/i/${sl}`
          : `${base}/contagem-estoque/${row.token}`
        : String(row.token);
      lines.push(`• ${row.status}: ${url}`);
    }
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(lines.join("\n")),
      "kw_contagens",
      flowId,
    );
    return;
  }

  // hoje / semana / mes — tarefas de checklist atribuídas
  const { data: assigned } = await supabase
    .from("checklist_assignments")
    .select("checklist_id, checklists(id, title, active)")
    .eq("company_member_id", auth.companyMemberId);

  const lists = (assigned ?? [])
    .map((a) => a.checklists)
    .filter((c) => c && (c as { active?: boolean }).active !== false) as {
    id: string;
    title: string;
  }[];

  if (keyword === "mes") {
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("checklist_runs")
      .select("id", { count: "exact", head: true })
      .eq("company_member_id", auth.companyMemberId)
      .gte("submitted_at", since.toISOString())
      .in("status", ["submitted", "in_review", "approved"]);

    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        [
          `Seu *mês* até agora:`,
          "",
          `✅ ${count ?? 0} checklists enviados`,
          `📋 ${lists.length} rotinas atribuídas`,
          "",
          "Mande *desempenho* para abrir o detalhe no celular.",
        ].join("\n"),
      ),
      "kw_mes",
      flowId,
    );
    return;
  }

  if (lists.length === 0) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Você ainda não tem checklists atribuídos. Peça ao gestor para te incluir.",
      ),
      "kw_sem_tarefas",
      flowId,
    );
    return;
  }

  const label = keyword === "hoje" ? "hoje" : "esta semana";
  const lines = [
    `Suas tarefas de *${label}*:`,
    "",
    ...lists.slice(0, 10).map((c, i) => `${i + 1}. ${c.title}`),
    "",
    "Mande *checklist* e o número para abrir o link de execução.",
  ];
  await sendWhatsappMessage(
    auth.senderNormalized,
    withFaroFlowFooter(lines.join("\n")),
    `kw_${keyword}`,
    flowId,
  );
}

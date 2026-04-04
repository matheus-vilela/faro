/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  formatChecklistMenuLine,
  includeInWhatsappMenu,
  monthBoundsSP,
  progressForChecklist,
  shortRecurrenceHint,
  type ChecklistRecurrenceMeta,
} from "./whatsappChecklistRecurrence.ts";
import { withFaroFlowFooter } from "./whatsappFlowFooter.ts";

type AssignedChecklistRow = {
  id: string;
  title: string;
  recurrence_kind: "daily" | "monthly";
  daily_executions_per_day: number | null;
  weekday_mask: number;
  monthly_executions: number | null;
};

const MENU_TTL_MS = 24 * 60 * 60 * 1000;

type ChecklistAuth = {
  companyId: string;
  senderNormalized: string;
  companyMemberId: string | null;
  role: "owner" | "member";
};

function normalizeSingleCommandWord(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function isChecklistCommand(text: string): boolean {
  return normalizeSingleCommandWord(text) === "checklist";
}

function parseMenuOptionNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 20) return n;
  return null;
}

async function saveChecklistMenuState(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  senderPhone: string,
  checklistIds: string[],
): Promise<void> {
  await supabase
    .from("whatsapp_recebimento_menu")
    .delete()
    .eq("sender_phone_normalized", senderPhone)
    .eq("company_id", companyId);

  await supabase
    .from("whatsapp_checklist_menu")
    .delete()
    .eq("sender_phone_normalized", senderPhone)
    .eq("company_id", companyId);

  const { error } = await supabase.from("whatsapp_checklist_menu").insert({
    company_id: companyId,
    sender_phone_normalized: senderPhone,
    checklist_ids: checklistIds,
  });
  if (error) {
    console.error("[checklist-flow] saveChecklistMenuState:", error.message);
  }
}

async function loadLatestChecklistMenu(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  senderPhone: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("whatsapp_checklist_menu")
    .select("checklist_ids, created_at")
    .eq("company_id", companyId)
    .eq("sender_phone_normalized", senderPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.checklist_ids?.length) return null;
  const age = Date.now() - new Date(data.created_at as string).getTime();
  if (age > MENU_TTL_MS) return null;
  return data.checklist_ids as string[];
}

async function fetchAssignedChecklists(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  companyMemberId: string,
): Promise<AssignedChecklistRow[]> {
  const { data, error } = await supabase
    .from("checklist_assignments")
    .select(
      "checklist_id, checklists ( id, title, company_id, active, recurrence_kind, daily_executions_per_day, weekday_mask, monthly_executions )",
    )
    .eq("company_member_id", companyMemberId);

  if (error) {
    console.error("[checklist-flow] fetchAssignedChecklists:", error.message);
    return [];
  }

  const rows = (data ?? []) as {
    checklists: {
      id: string;
      title: string;
      company_id: string;
      active: boolean;
      recurrence_kind: "daily" | "monthly";
      daily_executions_per_day: number | null;
      weekday_mask: number;
      monthly_executions: number | null;
    } | null;
  }[];

  return rows
    .filter((r) => r.checklists && r.checklists.company_id === companyId && r.checklists.active)
    .map((r) => {
      const c = r.checklists!;
      return {
        id: c.id,
        title: c.title,
        recurrence_kind: c.recurrence_kind ?? "daily",
        daily_executions_per_day: c.daily_executions_per_day,
        weekday_mask: typeof c.weekday_mask === "number" ? c.weekday_mask : 127,
        monthly_executions: c.monthly_executions,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
    .slice(0, 15);
}

async function createChecklistRun(
  supabase: ReturnType<typeof createClient>,
  checklistId: string,
  companyId: string,
  companyMemberId: string,
): Promise<{ token: string; runId: string } | null> {
  const { data: chk, error: e1 } = await supabase
    .from("checklists")
    .select("id, active")
    .eq("id", checklistId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (e1 || !chk?.active) return null;

  const { data: hasAssign, error: e2 } = await supabase
    .from("checklist_assignments")
    .select("checklist_id")
    .eq("checklist_id", checklistId)
    .limit(1)
    .maybeSingle();

  if (e2 || !hasAssign) return null;

  const { data: asg, error: eAsg } = await supabase
    .from("checklist_assignments")
    .select("checklist_id")
    .eq("checklist_id", checklistId)
    .eq("company_member_id", companyMemberId)
    .maybeSingle();

  if (eAsg || !asg) return null;

  const { data: run, error: e3 } = await supabase
    .from("checklist_runs")
    .insert({
      checklist_id: checklistId,
      company_member_id: companyMemberId,
    })
    .select("id, token")
    .single();

  if (e3 || !run?.token) {
    console.error("[checklist-flow] insert run:", e3?.message);
    return null;
  }

  const { data: items, error: e4 } = await supabase
    .from("checklist_items")
    .select("id")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: true });

  if (e4 || !items?.length) {
    await supabase.from("checklist_runs").delete().eq("id", run.id);
    return null;
  }

  const rows = items.map((it: { id: string }) => ({
    run_id: run.id,
    checklist_item_id: it.id,
  }));

  const { error: e5 } = await supabase.from("checklist_run_items").insert(rows);
  if (e5) {
    console.error("[checklist-flow] insert run items:", e5.message);
    await supabase.from("checklist_runs").delete().eq("id", run.id);
    return null;
  }

  return { token: run.token as string, runId: run.id as string };
}

function randomShortSlug(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Cria ou reutiliza slug em `checklist_run_short_links` (service role). */
async function ensureChecklistRunShortSlug(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  tokenUuid: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("checklist_run_short_links")
    .select("slug")
    .eq("run_id", runId)
    .maybeSingle();

  const row = existing as { slug?: string } | null;
  if (row?.slug && typeof row.slug === "string") {
    return row.slug;
  }

  for (let attempt = 0; attempt < 15; attempt++) {
    const slug = randomShortSlug(8);
    const { error } = await supabase.from("checklist_run_short_links").insert({
      slug,
      run_id: runId,
      token: tokenUuid,
    });
    if (!error) return slug;
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error(
        "[checklist-flow] ensureChecklistRunShortSlug:",
        error.message,
      );
      return null;
    }
  }
  return null;
}

async function fetchChecklistMetaForProgress(
  supabase: ReturnType<typeof createClient>,
  checklistId: string,
  companyId: string,
): Promise<ChecklistRecurrenceMeta | null> {
  const { data, error } = await supabase
    .from("checklists")
    .select(
      "recurrence_kind, daily_executions_per_day, weekday_mask, monthly_executions",
    )
    .eq("id", checklistId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    recurrence_kind: (data.recurrence_kind as "daily" | "monthly") ?? "daily",
    daily_executions_per_day: data.daily_executions_per_day,
    weekday_mask: typeof data.weekday_mask === "number" ? data.weekday_mask : 127,
    monthly_executions: data.monthly_executions,
  };
}

function publicAppAbsoluteBase(): string {
  const raw = Deno.env.get("PUBLIC_APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
  const u = raw.replace(/\/$/, "");
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u.replace(/\/$/, "");
  return `https://${u.replace(/\/$/, "")}`;
}

type SendWhatsapp = (
  phoneDigits: string,
  message: string,
  logContext?: string,
  flowId?: string,
) => Promise<{ ok: boolean; code?: string }>;

/**
 * Resposta numérica: se existir menu de checklist recente, resolve e envia link.
 * Retorna true se tratou (incluindo erro de opção inválida).
 */
export async function tryChecklistNumericReply(
  supabase: ReturnType<typeof createClient>,
  auth: ChecklistAuth,
  opt: number,
  sendWhatsappMessage: SendWhatsapp,
  flowId: string,
): Promise<boolean> {
  const ids = await loadLatestChecklistMenu(
    supabase,
    auth.companyId,
    auth.senderNormalized,
  );
  if (!ids || ids.length === 0) return false;

  const idx = opt - 1;
  if (idx < 0 || idx >= ids.length) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        `Opção inválida. Responda com um número de 1 a ${ids.length}.`,
      ),
      "checklist_opcao_invalida",
      flowId,
    );
    return true;
  }

  if (!auth.companyMemberId) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Checklists são atribuídos a membros cadastrados. Use o número vinculado ao seu cadastro de membro.",
      ),
      "checklist_sem_membro",
      flowId,
    );
    return true;
  }

  const checklistId = ids[idx]!;
  const now = new Date();
  const meta = await fetchChecklistMetaForProgress(
    supabase,
    checklistId,
    auth.companyId,
  );
  if (!meta) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível abrir esse checklist. Peça a lista novamente ou fale com o gestor.",
      ),
      "checklist_meta_ausente",
      flowId,
    );
    return true;
  }

  const { start: monthStartMs } = monthBoundsSP(now);
  const { data: statRows } = await supabase
    .from("checklist_runs")
    .select("checklist_id, submitted_at")
    .eq("company_member_id", auth.companyMemberId)
    .eq("checklist_id", checklistId)
    .eq("status", "submitted")
    .not("submitted_at", "is", null)
    .gte("submitted_at", new Date(monthStartMs).toISOString());

  const submittedRuns = (statRows ?? []) as {
    checklist_id: string;
    submitted_at: string;
  }[];

  const { actual, expected } = progressForChecklist(
    meta,
    submittedRuns,
    checklistId,
    now,
  );

  if (expected > 0 && actual >= expected) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Esse checklist já foi realizado neste período. Envie *checklist* para ver a lista atualizada.",
      ),
      "checklist_ja_realizado_periodo",
      flowId,
    );
    return true;
  }

  const run = await createChecklistRun(
    supabase,
    checklistId,
    auth.companyId,
    auth.companyMemberId,
  );

  if (!run) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não foi possível abrir esse checklist. Peça a lista novamente ou fale com o gestor.",
      ),
      "checklist_run_falhou",
      flowId,
    );
    return true;
  }

  const base = publicAppAbsoluteBase();
  if (!base) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Link indisponível no momento (configuração do servidor). Tente pelo painel do Faro.",
      ),
      "checklist_link_ausente",
      flowId,
    );
    return true;
  }

  const slug = await ensureChecklistRunShortSlug(
    supabase,
    run.runId,
    run.token,
  );
  const link = slug
    ? `${base}/k/${slug}`
    : `${base}/checklist/${run.token}`;
  if (!slug) {
    console.warn(
      "[checklist-flow] slug curto indisponível; usando /checklist/",
      { flowId, runId: run.runId },
    );
  }
  await sendWhatsappMessage(
    auth.senderNormalized,
    withFaroFlowFooter(
      `Abra o link para executar o checklist e marcar os itens:\n\n${link}`,
      "registro",
    ),
    "checklist_link_enviado",
    flowId,
  );
  return true;
}

/** Usado pelo index: texto já validado como comando checklist */
export async function sendChecklistMenu(
  supabase: ReturnType<typeof createClient>,
  auth: ChecklistAuth,
  sendWhatsappMessage: SendWhatsapp,
  flowId: string,
): Promise<void> {
  if (!auth.companyMemberId) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Checklists no WhatsApp são para *membros* com número cadastrado no Faro.",
      ),
      "checklist_somente_membro",
      flowId,
    );
    return;
  }

  const items = await fetchAssignedChecklists(
    supabase,
    auth.companyId,
    auth.companyMemberId,
  );

  if (items.length === 0) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Não há checklists atribuídos ao seu número no momento.",
      ),
      "checklist_lista_vazia",
      flowId,
    );
    return;
  }

  const now = new Date();
  const { start: monthStartMs } = monthBoundsSP(now);
  const checklistIds = items.map((x) => x.id);
  const { data: runRows, error: runsErr } = await supabase
    .from("checklist_runs")
    .select("checklist_id, submitted_at")
    .eq("company_member_id", auth.companyMemberId)
    .in("checklist_id", checklistIds)
    .eq("status", "submitted")
    .not("submitted_at", "is", null)
    .gte("submitted_at", new Date(monthStartMs).toISOString());

  if (runsErr) {
    console.error("[checklist-flow] checklist_runs stats:", runsErr.message);
  }

  const submittedRuns = (runRows ?? []) as {
    checklist_id: string;
    submitted_at: string;
  }[];

  const filtered = items.filter((it) => {
    const meta: ChecklistRecurrenceMeta = {
      recurrence_kind: it.recurrence_kind,
      daily_executions_per_day: it.daily_executions_per_day,
      weekday_mask: it.weekday_mask,
      monthly_executions: it.monthly_executions,
    };
    const { expected } = progressForChecklist(
      meta,
      submittedRuns,
      it.id,
      now,
    );
    return includeInWhatsappMenu(meta, expected);
  });

  if (filtered.length === 0) {
    await sendWhatsappMessage(
      auth.senderNormalized,
      withFaroFlowFooter(
        "Hoje não há checklists agendados para o seu número (folga). Quando for dia de rotina, envie *checklist* de novo.",
      ),
      "checklist_lista_somente_folga",
      flowId,
    );
    return;
  }

  await saveChecklistMenuState(
    supabase,
    auth.companyId,
    auth.senderNormalized,
    filtered.map((x) => x.id),
  );

  const lines = filtered.map((it, i) => {
    const meta: ChecklistRecurrenceMeta = {
      recurrence_kind: it.recurrence_kind,
      daily_executions_per_day: it.daily_executions_per_day,
      weekday_mask: it.weekday_mask,
      monthly_executions: it.monthly_executions,
    };
    const { actual, expected } = progressForChecklist(
      meta,
      submittedRuns,
      it.id,
      now,
    );
    const hint = shortRecurrenceHint(meta, expected);
    return formatChecklistMenuLine(i + 1, it.title, hint, actual, expected);
  });

  const body = [
    "*Checklists disponíveis*",
    "",
    ...lines,
    "",
    "Responda *somente com o número* da opção (ex.: 1) para receber o link de execução.",
  ].join("\n");

  await sendWhatsappMessage(
    auth.senderNormalized,
    withFaroFlowFooter(body),
    "checklist_menu_lista",
    flowId,
  );
}

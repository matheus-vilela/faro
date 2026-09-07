/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { withFaroFlowFooter } from "./whatsappFlowFooter.ts";
import {
  buildCompanyPickerMessage,
  buildCompanySelectedMessage,
  buildSingleUnitLojaMessage,
  decideCompanyContext,
  displayCompanyMatchName,
  findMatchByCompanyId,
  isLojaCommand,
  normalizeWhatsappCommandPhrase,
  sortCompanyMatches,
  type CompanyWhatsappMatch,
  type WhatsappCompanyContextRow,
} from "./whatsappCompanyContext.ts";

type SendWhatsappMessageFn = (
  phoneDigits: string,
  message: string,
  logContext?: string,
  flowId?: string,
) => Promise<{ ok: boolean }>;

export type WhatsappCompanyLookup = {
  authorized: true;
  senderNormalized: string;
  connectedNormalized: string | null;
  lookupVariants: string[];
  matches: CompanyWhatsappMatch[];
};

export type WhatsappCompanyResolved = WhatsappCompanyLookup & {
  companyId: string;
  companyName: string;
  role: "owner" | "member";
  companyMemberId: string | null;
};

export type ResolveCompanyResult =
  | { kind: "resolved"; auth: WhatsappCompanyResolved }
  | { kind: "handled" };

const KNOWN_COMMAND_PHRASES = new Set([
  "lista",
  "estoque",
  "inventario",
  "checklist",
  "comandos",
  "contas a pagar",
  "nova",
  "nova contagem",
]);

function looksLikeCommand(text: string | null): boolean {
  if (!text) return false;
  if (isLojaCommand(text)) return false;
  const phrase = normalizeWhatsappCommandPhrase(text);
  return KNOWN_COMMAND_PHRASES.has(phrase);
}

function mapRow(
  data: Record<string, unknown> | null,
): WhatsappCompanyContextRow | null {
  if (!data) return null;
  const pending = data.pending_company_ids;
  return {
    selected_company_id:
      typeof data.selected_company_id === "string"
        ? data.selected_company_id
        : null,
    selected_at: typeof data.selected_at === "string" ? data.selected_at : null,
    pending_company_ids: Array.isArray(pending)
      ? pending.filter((id): id is string => typeof id === "string")
      : [],
    pending_at: typeof data.pending_at === "string" ? data.pending_at : null,
  };
}

async function loadContext(
  supabase: ReturnType<typeof createClient>,
  sender: string,
): Promise<WhatsappCompanyContextRow | null> {
  const { data, error } = await supabase
    .from("whatsapp_company_context")
    .select(
      "selected_company_id, selected_at, pending_company_ids, pending_at",
    )
    .eq("sender_phone_normalized", sender)
    .maybeSingle();
  if (error) {
    console.error(
      "[whatsapp-company-context] load:",
      error.message,
    );
    return null;
  }
  return mapRow((data ?? null) as Record<string, unknown> | null);
}

async function saveContext(
  supabase: ReturnType<typeof createClient>,
  sender: string,
  patch: {
    selected_company_id?: string | null;
    selected_at?: string | null;
    pending_company_ids?: string[];
    pending_at?: string | null;
    keepSelected?: boolean;
    previous?: WhatsappCompanyContextRow | null;
  },
): Promise<void> {
  const prev = patch.previous;
  const selectedId = patch.keepSelected
    ? (prev?.selected_company_id ?? null)
    : (patch.selected_company_id ?? null);
  const selectedAt = patch.keepSelected
    ? (prev?.selected_at ?? null)
    : (patch.selected_at ?? null);
  const row = {
    sender_phone_normalized: sender,
    selected_company_id: selectedId,
    selected_at: selectedAt,
    pending_company_ids: patch.pending_company_ids ?? [],
    pending_at: patch.pending_at ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("whatsapp_company_context")
    .upsert(row, { onConflict: "sender_phone_normalized" });
  if (error) {
    console.error(
      "[whatsapp-company-context] save:",
      error.message,
    );
  }
}

function resolvedAuth(
  lookup: WhatsappCompanyLookup,
  match: CompanyWhatsappMatch,
): WhatsappCompanyResolved {
  return {
    ...lookup,
    companyId: match.companyId,
    companyName: displayCompanyMatchName(match),
    role: match.role,
    companyMemberId: match.companyMemberId,
  };
}

export async function resolveWhatsappCompanyContext(args: {
  supabase: ReturnType<typeof createClient>;
  lookup: WhatsappCompanyLookup;
  text: string | null;
  hasMedia: boolean;
  sendWhatsappMessage: SendWhatsappMessageFn;
  flowId: string;
}): Promise<ResolveCompanyResult> {
  const { supabase, lookup, text, hasMedia, sendWhatsappMessage, flowId } =
    args;
  const matches = sortCompanyMatches(lookup.matches);
  const nowMs = Date.now();
  const context = await loadContext(supabase, lookup.senderNormalized);
  const decision = decideCompanyContext({
    matches,
    context,
    text,
    nowMs,
  });

  const sendAsk = async (
    reason: "no_selection" | "expired" | "switch" | "stale",
  ) => {
    const current = findMatchByCompanyId(
      matches,
      context?.selected_company_id ?? null,
    );
    const body = buildCompanyPickerMessage(matches, {
      hadCommand: looksLikeCommand(text),
      hadMedia,
      currentName: reason === "switch"
        ? (current ? displayCompanyMatchName(current) : null)
        : null,
    });
    await saveContext(supabase, lookup.senderNormalized, {
      keepSelected: true,
      previous: context,
      pending_company_ids: matches.map((m) => m.companyId),
      pending_at: new Date().toISOString(),
    });
    await sendWhatsappMessage(
      lookup.senderNormalized,
      withFaroFlowFooter(body),
      `company_picker_${reason}`,
      flowId,
    );
  };

  switch (decision.action) {
    case "single": {
      const match = findMatchByCompanyId(matches, decision.companyId);
      if (!match) return { kind: "handled" };
      return { kind: "resolved", auth: resolvedAuth(lookup, match) };
    }
    case "single_loja_info": {
      const match = findMatchByCompanyId(matches, decision.companyId);
      if (!match) return { kind: "handled" };
      await sendWhatsappMessage(
        lookup.senderNormalized,
        withFaroFlowFooter(
          buildSingleUnitLojaMessage(displayCompanyMatchName(match)),
        ),
        "company_picker_unica",
        flowId,
      );
      return { kind: "handled" };
    }
    case "use": {
      const match = findMatchByCompanyId(matches, decision.companyId);
      if (!match) {
        await sendAsk("stale");
        return { kind: "handled" };
      }
      return { kind: "resolved", auth: resolvedAuth(lookup, match) };
    }
    case "select": {
      const match = findMatchByCompanyId(matches, decision.companyId);
      if (!match) {
        await sendAsk("stale");
        return { kind: "handled" };
      }
      const nowIso = new Date().toISOString();
      await saveContext(supabase, lookup.senderNormalized, {
        selected_company_id: match.companyId,
        selected_at: nowIso,
        pending_company_ids: [],
        pending_at: null,
      });
      await sendWhatsappMessage(
        lookup.senderNormalized,
        withFaroFlowFooter(
          buildCompanySelectedMessage(displayCompanyMatchName(match)),
        ),
        "company_picker_selecionada",
        flowId,
      );
      return { kind: "handled" };
    }
    case "invalid_option": {
      await sendWhatsappMessage(
        lookup.senderNormalized,
        withFaroFlowFooter(
          `Opção inválida. Responda com um número de 1 a ${decision.max}.`,
        ),
        "company_picker_opcao_invalida",
        flowId,
      );
      return { kind: "handled" };
    }
    case "ask": {
      await sendAsk(decision.reason);
      return { kind: "handled" };
    }
    default:
      return { kind: "handled" };
  }
}

export const COMPANY_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const COMPANY_PICKER_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPANY_PICKER_MAX = 20;

export type CompanyWhatsappMatch = {
  companyId: string;
  companyName: string;
  role: "owner" | "member";
  companyMemberId: string | null;
};

export type WhatsappCompanyContextRow = {
  selected_company_id: string | null;
  selected_at: string | null;
  pending_company_ids: string[] | null;
  pending_at: string | null;
};

export type CompanyContextDecision =
  | { action: "use"; companyId: string }
  | { action: "single"; companyId: string }
  | { action: "single_loja_info"; companyId: string }
  | { action: "ask"; reason: "no_selection" | "expired" | "switch" | "stale" }
  | { action: "select"; companyId: string }
  | { action: "invalid_option"; max: number };

function stripMarks(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeWhatsappCommandWord(text: string): string {
  return stripMarks(text.trim().toLowerCase());
}

export function normalizeWhatsappCommandPhrase(text: string): string {
  return stripMarks(text.trim().replace(/^\*+|\*+$/g, "").trim().toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

/** *loja*, *unidade*, *unidades*, *trocar loja*. */
export function isLojaCommand(text: string): boolean {
  const phrase = normalizeWhatsappCommandPhrase(text);
  if (
    phrase === "loja" ||
    phrase === "unidade" ||
    phrase === "unidades" ||
    phrase === "trocar loja"
  ) {
    return true;
  }
  return normalizeWhatsappCommandWord(text) === "loja";
}

export function parseCompanyPickerOption(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  if (n >= 1 && n <= COMPANY_PICKER_MAX) return n;
  return null;
}

export function displayCompanyMatchName(match: CompanyWhatsappMatch): string {
  const name = match.companyName.trim();
  return name || "Unidade";
}

export function sortCompanyMatches(
  matches: CompanyWhatsappMatch[],
): CompanyWhatsappMatch[] {
  return [...matches].sort((a, b) => {
    const byName = displayCompanyMatchName(a).localeCompare(
      displayCompanyMatchName(b),
      "pt-BR",
    );
    if (byName !== 0) return byName;
    return a.companyId.localeCompare(b.companyId);
  });
}

export function findMatchByCompanyId(
  matches: CompanyWhatsappMatch[],
  companyId: string | null | undefined,
): CompanyWhatsappMatch | null {
  if (!companyId) return null;
  return matches.find((m) => m.companyId === companyId) ?? null;
}

function isFresh(iso: string | null | undefined, nowMs: number, ttlMs: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= ttlMs;
}

export function isCompanySelectionActive(
  row: WhatsappCompanyContextRow | null,
  nowMs: number,
): boolean {
  if (!row?.selected_company_id) return false;
  return isFresh(row.selected_at, nowMs, COMPANY_SESSION_TTL_MS);
}

export function isCompanyPickerActive(
  row: WhatsappCompanyContextRow | null,
  nowMs: number,
): boolean {
  const ids = row?.pending_company_ids ?? [];
  if (ids.length === 0) return false;
  return isFresh(row?.pending_at, nowMs, COMPANY_PICKER_TTL_MS);
}

export function buildCompanyPickerMessage(
  matches: CompanyWhatsappMatch[],
  opts?: {
    hadCommand?: boolean;
    hadMedia?: boolean;
    currentName?: string | null;
  },
): string {
  const listed = sortCompanyMatches(matches).slice(0, COMPANY_PICKER_MAX);
  const lines = listed.map(
    (m, i) => `${i + 1}) ${displayCompanyMatchName(m)}`,
  );
  const extra: string[] = [];
  if (opts?.currentName?.trim()) {
    extra.push(`Unidade atual: *${opts.currentName.trim()}*.`);
  }
  extra.push(
    "Responda *somente com o número* da unidade.",
  );
  if (opts?.hadMedia) {
    extra.push("Depois de escolher, envie a foto ou o PDF de novo.");
  } else if (opts?.hadCommand) {
    extra.push("Depois de escolher, envie o comando de novo.");
  }
  extra.push("Para trocar depois, envie *loja*.");
  const truncated = matches.length > COMPANY_PICKER_MAX
    ? `\n\nMostrando as ${COMPANY_PICKER_MAX} primeiras unidades.`
    : "";
  return [
    "*Qual unidade?*",
    "",
    "Seu WhatsApp está em mais de uma loja.",
    "",
    ...lines,
    "",
    ...extra,
  ].join("\n") + truncated;
}

export function buildCompanySelectedMessage(name: string): string {
  const unit = name.trim() || "Unidade";
  return [
    `Unidade selecionada: *${unit}*.`,
    "",
    "Envie *lista*, *estoque*, *checklist* ou uma foto de nota. Para trocar, envie *loja*.",
  ].join("\n");
}

export function buildSingleUnitLojaMessage(name: string): string {
  const unit = name.trim() || "Unidade";
  return `Você está vinculado a uma única unidade: *${unit}*.`;
}

export function decideCompanyContext(args: {
  matches: CompanyWhatsappMatch[];
  context: WhatsappCompanyContextRow | null;
  text: string | null;
  nowMs: number;
}): CompanyContextDecision {
  const matches = sortCompanyMatches(args.matches);
  if (matches.length === 0) {
    return { action: "ask", reason: "stale" };
  }

  if (matches.length === 1) {
    const only = matches[0];
    if (args.text && isLojaCommand(args.text)) {
      return { action: "single_loja_info", companyId: only.companyId };
    }
    return { action: "single", companyId: only.companyId };
  }

  const text = args.text?.trim() ?? "";
  if (text && isLojaCommand(text)) {
    return { action: "ask", reason: "switch" };
  }

  const pickerOn = isCompanyPickerActive(args.context, args.nowMs);
  if (pickerOn && text) {
    const opt = parseCompanyPickerOption(text);
    if (opt !== null) {
      const pending = (args.context?.pending_company_ids ?? []).filter(
        Boolean,
      );
      const max = Math.min(pending.length, COMPANY_PICKER_MAX);
      if (opt < 1 || opt > max) {
        return { action: "invalid_option", max: Math.max(max, 1) };
      }
      const pickedId = pending[opt - 1];
      const still = findMatchByCompanyId(matches, pickedId);
      if (!still) {
        return { action: "ask", reason: "stale" };
      }
      return { action: "select", companyId: still.companyId };
    }
  }

  if (isCompanySelectionActive(args.context, args.nowMs)) {
    const selected = findMatchByCompanyId(
      matches,
      args.context?.selected_company_id,
    );
    if (selected) {
      return { action: "use", companyId: selected.companyId };
    }
    return { action: "ask", reason: "stale" };
  }

  if (args.context?.selected_company_id) {
    return { action: "ask", reason: "expired" };
  }
  return { action: "ask", reason: "no_selection" };
}

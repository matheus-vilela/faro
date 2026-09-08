import { cn } from "@/lib/utils";

/**
 * Seletores da tela de contagem: altura e largura fixas.
 * `data-[size=default]:h-11` é necessário porque o SelectTrigger traz `h-9`.
 */
export const COUNT_SELECT_TRIGGER_CLASS =
  "h-11 w-full max-w-full shrink-0 data-[size=default]:h-11";
export const COUNT_FILTER_INPUT_CLASS = "h-11 w-full max-w-full shrink-0";

/** Chip à direita das linhas clicáveis (Conferir / Abrir). */
export const COUNT_ROW_ACTION_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors group-hover:bg-muted";

/** Embed PostgREST `inventory_count_lines(count)`. */
export function inventoryCountLineCount(
  embed: { count: number }[] | { count: number } | null | undefined,
): number {
  if (embed == null) return 0;
  const row = Array.isArray(embed) ? embed[0] : embed;
  const n = Number(row?.count);
  return Number.isFinite(n) ? n : 0;
}

export function countClickableRowClass(active?: boolean): string {
  return cn(
    "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors",
    "border-border bg-card shadow-sm",
    "hover:bg-muted/50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active && "border-foreground/20 bg-muted",
  );
}

export function inventoryCountSessionGroupLabel(params: {
  kind?: string | null;
  groupName?: string | null;
  onboardingLabel?: string;
}): string {
  if (params.kind === "onboarding") {
    return params.onboardingLabel ?? "Onboarding";
  }
  const name = params.groupName?.trim();
  return name || "Única";
}

export function canCancelCountSession(status: string): boolean {
  return status === "open" || status === "returned" || status === "pending_approval";
}

/** Rótulo da fila de agenda: lista única, listagem de setor ou grupo inteiro. */
export function inventoryCountScheduleTargetLabel(params: {
  listingId: string | null;
  listingName?: string | null;
  listingGroupId?: string | null;
  groupName?: string | null;
}): string {
  if (params.listingId) {
    const name = params.listingName?.trim() || "Listagem";
    if (!params.listingGroupId) return `Única · ${name}`;
    const group = params.groupName?.trim();
    return group ? `${group} · ${name}` : name;
  }
  const group = params.groupName?.trim();
  return group ? `${group} · todas as listagens` : "Grupo";
}

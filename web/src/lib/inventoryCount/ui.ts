import { cn } from "@/lib/utils";

/**
 * Seletores da tela de contagem: altura e largura fixas.
 * `data-[size=default]:h-11` é necessário porque o SelectTrigger traz `h-9`.
 */
export const COUNT_SELECT_TRIGGER_CLASS =
  "h-11 w-[14rem] max-w-full shrink-0 data-[size=default]:h-11";
export const COUNT_FILTER_INPUT_CLASS = "h-11 w-[14rem] max-w-full shrink-0";

/** Chip à direita das linhas clicáveis (Conferir / Abrir). */
export const COUNT_ROW_ACTION_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/90";

export function countClickableRowClass(active?: boolean): string {
  return cn(
    "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all",
    "border-primary/50 bg-primary/10 shadow-sm",
    "hover:border-primary hover:bg-primary/20 hover:shadow-md",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active && "border-primary bg-primary/25 shadow-md ring-1 ring-primary/30",
  );
}

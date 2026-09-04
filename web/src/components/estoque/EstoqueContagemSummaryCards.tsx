import { cn } from "@/lib/utils";
import {
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Loader2,
} from "lucide-react";

export type ContagemTab = "aprovar" | "listas" | "historico";

export function EstoqueContagemSummaryCards({
  pendingApproval,
  inProgress,
  scheduled,
  onboardingPending,
  onSelect,
}: {
  pendingApproval: number;
  inProgress: number;
  scheduled: number;
  onboardingPending: number;
  onSelect: (tab: ContagemTab, card: "aprovar" | "andamento" | "agenda" | "onboarding") => void;
}) {
  const cards = [
    {
      id: "aprovar" as const,
      tab: "aprovar" as const,
      label: "Aprovar agora",
      value: pendingApproval,
      hint: "Aguardando conferência",
      icon: CheckCheck,
      className:
        pendingApproval > 0
          ? "border-amber-400/60 bg-amber-500/15 hover:bg-amber-500/25"
          : "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10",
      valueClass: pendingApproval > 0 ? "text-amber-900 dark:text-amber-100" : "",
    },
    {
      id: "andamento" as const,
      tab: "historico" as const,
      label: "Em andamento",
      value: inProgress,
      hint: "Abertas e recontagens",
      icon: Loader2,
      className:
        inProgress > 0
          ? "border-sky-400/60 bg-sky-500/15 hover:bg-sky-500/25"
          : "border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10",
      valueClass: inProgress > 0 ? "text-sky-900 dark:text-sky-100" : "",
    },
    {
      id: "agenda" as const,
      tab: "listas" as const,
      label: "Agendadas",
      value: scheduled,
      hint: "Próximas datas maleáveis",
      icon: CalendarClock,
      className:
        scheduled > 0
          ? "border-violet-400/60 bg-violet-500/15 hover:bg-violet-500/25"
          : "border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10",
      valueClass: scheduled > 0 ? "text-violet-900 dark:text-violet-100" : "",
    },
    {
      id: "onboarding" as const,
      tab: "aprovar" as const,
      label: "Onboarding",
      value: onboardingPending,
      hint:
        onboardingPending > 0
          ? "Obrigatória para o estoque atualizar"
          : "Contagem geral concluída",
      icon: ClipboardList,
      className:
        onboardingPending > 0
          ? "border-orange-500 bg-orange-500/20 ring-1 ring-orange-500/40 hover:bg-orange-500/30"
          : "border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10",
      valueClass:
        onboardingPending > 0
          ? "text-orange-950 dark:text-orange-100"
          : "text-emerald-800 dark:text-emerald-200",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.tab, c.id)}
            className={cn(
              "cursor-pointer rounded-xl border-2 px-4 py-3 text-left shadow-sm transition-colors",
              c.className,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{c.label}</p>
              <Icon className="h-4 w-4 opacity-70" />
            </div>
            <p className={cn("mt-2 text-2xl font-semibold tabular-nums", c.valueClass)}>
              {c.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
          </button>
        );
      })}
    </div>
  );
}

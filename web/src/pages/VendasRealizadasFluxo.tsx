import { VENDAS_REALIZADAS_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";
import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { VendasRealizadasResumo } from "@/components/revenue/VendasRealizadasResumo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarDays, LayoutDashboard, TrendingUp } from "lucide-react";
import { useState } from "react";

type VendasTab = "resumo" | "calendario";

function VendasRealizadasTabToggle({
  value,
  onChange,
}: {
  value: VendasTab;
  onChange: (value: VendasTab) => void;
}) {
  const options: {
    value: VendasTab;
    label: string;
    icon: typeof LayoutDashboard;
  }[] = [
    { value: "resumo", label: "Resumo", icon: LayoutDashboard },
    { value: "calendario", label: "Calendário", icon: CalendarDays },
  ];

  return (
    <div
      className="inline-flex max-w-full flex-wrap rounded-full bg-muted p-1"
      role="tablist"
      aria-label="Visão de vendas realizadas"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <Button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            variant="ghost"
            size="sm"
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-8 rounded-full px-3 text-sm font-medium shadow-none",
              active
                ? "bg-ring text-foreground shadow-sm hover:!bg-ring/80"
                : "text-muted-foreground hover:bg-ring hover:text-foreground",
            )}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

/** Vendas realizadas no fluxo financeiro (entradas / contas a receber). */
export function VendasRealizadasFluxo() {
  const [tab, setTab] = useState<VendasTab>("resumo");
  const tabToggle = <VendasRealizadasTabToggle value={tab} onChange={setTab} />;

  if (tab === "calendario") {
    return (
      <FluxoBoletosPage
        config={VENDAS_REALIZADAS_FLUXO_CONFIG}
        afterHeader={tabToggle}
      />
    );
  }

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Vendas realizadas"
        description="Panorama das vendas do período e comparação com o intervalo anterior."
        icon={TrendingUp}
      />
      {tabToggle}
      <VendasRealizadasResumo />
    </PageShell>
  );
}

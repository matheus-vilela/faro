import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { VENDAS_REALIZADAS_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { VendasRealizadasResumo } from "@/components/revenue/VendasRealizadasResumo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CalendarDays, CreditCard, LayoutDashboard, Receipt, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

type VendasTab = "resumo" | "calendario";

function VendasRealizadasTabToggle({
  value,
  onChange,
}: {
  value: VendasTab;
  onChange: (value: VendasTab) => void;
}) {
  const options: { value: VendasTab; label: string; icon: typeof LayoutDashboard }[] =
    [
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
                ? "bg-background text-foreground shadow-sm hover:bg-background"
                : "text-muted-foreground hover:bg-transparent hover:text-foreground",
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
  const tabToggle = (
    <VendasRealizadasTabToggle value={tab} onChange={setTab} />
  );

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
        description="Panorama das vendas e calendário de recebimentos. O faturamento diário do PDV (EPOC) fica numa vista separada."
        icon={TrendingUp}
      />
      {tabToggle}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Receipt className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">Faturamento EPOC</p>
              <p className="text-muted-foreground text-xs">
                Consulte o Total Geral, produtos/serviços, fiscal e formas de
                pagamento por dia, gravados na sincronização.
              </p>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link to="/app/faturamento">Ver faturamento</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <CreditCard className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">Formas de pagamento</p>
              <p className="text-muted-foreground text-xs">
                Visualize e ajuste os nomes das formas usadas no faturamento.
              </p>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link to="/app/formas-de-pagamento">Configurar</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <VendasRealizadasResumo />
    </PageShell>
  );
}

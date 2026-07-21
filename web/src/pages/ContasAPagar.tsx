import { BankReconciliationPanel } from "@/components/fluxo/BankReconciliationPanel";
import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { CONTAS_A_PAGAR_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Landmark, List, TrendingDown } from "lucide-react";
import { useState } from "react";

type ContasTab = "contas" | "concil";

function ContasAPagarTabToggle({
  value,
  onChange,
  pendingCount,
}: {
  value: ContasTab;
  onChange: (value: ContasTab) => void;
  pendingCount?: number;
}) {
  const options: {
    value: ContasTab;
    label: string;
    icon: typeof List;
  }[] = [
    { value: "contas", label: "Contas", icon: List },
    { value: "concil", label: "Conciliação bancária", icon: Landmark },
  ];

  return (
    <div
      className="inline-flex w-fit max-w-full flex-wrap rounded-full bg-muted p-1"
      role="tablist"
      aria-label="Visão de contas a pagar"
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
            {opt.value === "concil" &&
              pendingCount != null &&
              pendingCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 rounded-full px-1.5 text-[10px]"
                >
                  {pendingCount}
                </Badge>
              )}
          </Button>
        );
      })}
    </div>
  );
}

export function ContasAPagar() {
  const [tab, setTab] = useState<ContasTab>("contas");

  return (
    <PageShell className="space-y-4">
      <div className="flex flex-col gap-2">
        <PageHeader
          title="Contas a pagar"
          icon={TrendingDown}
          className="gap-2 sm:items-center"
        />
        <ContasAPagarTabToggle value={tab} onChange={setTab} />
      </div>

      {tab === "concil" ? (
        <BankReconciliationPanel embedded />
      ) : (
        <FluxoBoletosPage
          config={CONTAS_A_PAGAR_FLUXO_CONFIG}
          embedded
        />
      )}
    </PageShell>
  );
}

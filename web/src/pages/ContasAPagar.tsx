import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { CONTAS_A_PAGAR_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { TrendingDown } from "lucide-react";

export function ContasAPagar() {
  return (
    <PageShell className="space-y-4">
      <PageHeader
        title="Contas a pagar"
        icon={TrendingDown}
        className="gap-2 sm:items-center"
      />
      <FluxoBoletosPage config={CONTAS_A_PAGAR_FLUXO_CONFIG} embedded />
    </PageShell>
  );
}

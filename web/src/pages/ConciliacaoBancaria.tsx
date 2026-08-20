import { BankReconciliationPanel } from "@/components/fluxo/BankReconciliationPanel";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Landmark } from "lucide-react";

export function ConciliacaoBancaria() {
  return (
    <PageShell className="space-y-4">
      <PageHeader
        title="Conciliação bancária"
        icon={Landmark}
        className="gap-2 sm:items-center"
      />
      <BankReconciliationPanel embedded />
    </PageShell>
  );
}

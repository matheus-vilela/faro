import { BankReconciliationPanel } from "@/components/fluxo/BankReconciliationPanel";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ExportButton } from "@/components/reports/ExportButton";
import { Landmark } from "lucide-react";

export function ConciliacaoBancaria() {
  return (
    <PageShell className="space-y-4">
      <PageHeader
        title="Conciliação bancária"
        icon={Landmark}
        className="gap-2 sm:items-center"
        action={<ExportButton reportId="reconciliation" />}
      />
      <BankReconciliationPanel embedded />
    </PageShell>
  );
}

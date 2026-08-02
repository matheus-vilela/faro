import { IntegrationFlowDiagnosticPanel } from "@/components/integrations/IntegrationFlowDiagnosticPanel";
import {
  NFE_FLOW_PHASE_LABELS,
  NFE_FLOW_PHASE_ORDER,
  nfeFlowPhaseStatusLabel,
  type NfeFlowDiagnostic,
} from "@/lib/nfeFlowDiagnostic";

export function FiscalFlowDiagnosticPanel({
  diagnostic,
  compact = false,
  className,
}: {
  diagnostic: NfeFlowDiagnostic;
  compact?: boolean;
  className?: string;
}) {
  return (
    <IntegrationFlowDiagnosticPanel
      diagnostic={diagnostic}
      phaseOrder={NFE_FLOW_PHASE_ORDER}
      phaseLabels={NFE_FLOW_PHASE_LABELS}
      titleOk="Fluxo fiscal concluído"
      titleBlocked="Fluxo fiscal interrompido"
      statusLabel={nfeFlowPhaseStatusLabel}
      compact={compact}
      className={className}
    />
  );
}

import { IntegrationFlowDiagnosticPanel } from "@/components/integrations/IntegrationFlowDiagnosticPanel";
import {
  EPOC_FLOW_PHASE_LABELS,
  EPOC_FLOW_PHASE_ORDER,
  epocFlowPhaseStatusLabel,
  type EpocFlowDiagnostic,
} from "@/lib/epocFlowDiagnostic";

export function EpocFlowDiagnosticPanel({
  diagnostic,
  compact = false,
  className,
}: {
  diagnostic: EpocFlowDiagnostic;
  compact?: boolean;
  className?: string;
}) {
  return (
    <IntegrationFlowDiagnosticPanel
      diagnostic={diagnostic}
      phaseOrder={EPOC_FLOW_PHASE_ORDER}
      phaseLabels={EPOC_FLOW_PHASE_LABELS}
      titleOk="Fluxo EPOC concluído"
      titleBlocked="Fluxo EPOC interrompido"
      statusLabel={epocFlowPhaseStatusLabel}
      compact={compact}
      className={className}
    />
  );
}

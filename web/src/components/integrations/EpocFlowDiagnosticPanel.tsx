import {
  EPOC_FLOW_PHASE_LABELS,
  EPOC_FLOW_PHASE_ORDER,
  epocFlowPhaseStatusLabel,
  type EpocFlowDiagnostic,
  type EpocFlowPhaseStatus,
} from "@/lib/epocFlowDiagnostic";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";

function statusIcon(status: EpocFlowPhaseStatus) {
  if (status === "ok") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />;
  }
  if (status === "fail") {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }
  if (status === "pending") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
  }
  return <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground/70" />;
}

function statusBadgeClass(status: EpocFlowPhaseStatus): string {
  if (status === "ok") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "warn") return "text-amber-800 bg-amber-50 border-amber-200";
  if (status === "fail") return "text-destructive bg-destructive/10 border-destructive/30";
  if (status === "pending") return "text-muted-foreground bg-muted/40 border-border";
  return "text-muted-foreground bg-muted/20 border-border/60";
}

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
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-muted/15 p-3 text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {diagnostic.blocked_at ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">
            {diagnostic.blocked_at
              ? "Fluxo EPOC interrompido"
              : "Fluxo EPOC concluído"}
          </p>
          <p className="text-xs text-muted-foreground">{diagnostic.summary}</p>
        </div>
      </div>

      <ol
        className={cn(
          "mt-3 space-y-2",
          compact ? "text-xs" : "text-sm",
        )}
      >
        {EPOC_FLOW_PHASE_ORDER.map((phaseKey, index) => {
          const report = diagnostic.phases[phaseKey];
          const label = report?.label || EPOC_FLOW_PHASE_LABELS[phaseKey];
          const status = report?.status ?? "skipped";
          const isBlocked = diagnostic.blocked_at === phaseKey;
          return (
            <li
              key={phaseKey}
              className={cn(
                "flex gap-2 rounded-md border px-2 py-1.5",
                isBlocked
                  ? "border-amber-300/80 bg-amber-50/50"
                  : "border-transparent bg-background/60",
              )}
            >
              <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {statusIcon(status)}
                  <span className="font-medium">{label}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-medium",
                      statusBadgeClass(status),
                    )}
                  >
                    {epocFlowPhaseStatusLabel(status)}
                  </span>
                </div>
                {report?.message ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {report.message}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {diagnostic.blocked_at ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Investigue primeiro a fase marcada em amarelo; as etapas seguintes
          dependem dela.
        </p>
      ) : null}
    </div>
  );
}

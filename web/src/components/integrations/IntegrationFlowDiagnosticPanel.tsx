import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";

export type IntegrationFlowPhaseStatus =
  | "ok"
  | "warn"
  | "fail"
  | "pending"
  | "skipped";

export type IntegrationFlowPhaseReport = {
  status: IntegrationFlowPhaseStatus;
  label: string;
  message?: string;
};

export type IntegrationFlowDiagnosticLike = {
  blocked_at: string | null;
  summary: string;
  phases: Record<string, IntegrationFlowPhaseReport>;
};

function statusIcon(status: IntegrationFlowPhaseStatus) {
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
    return (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  return <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground/70" />;
}

function statusBadgeClass(status: IntegrationFlowPhaseStatus): string {
  if (status === "ok") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "warn") return "text-amber-800 bg-amber-50 border-amber-200";
  if (status === "fail") {
    return "text-destructive bg-destructive/10 border-destructive/30";
  }
  if (status === "pending") return "text-muted-foreground bg-muted/40 border-border";
  return "text-muted-foreground bg-muted/20 border-border/60";
}

function defaultStatusLabel(status: IntegrationFlowPhaseStatus): string {
  if (status === "ok") return "OK";
  if (status === "warn") return "Atenção";
  if (status === "fail") return "Falha";
  if (status === "pending") return "Em curso";
  return "—";
}

export function IntegrationFlowDiagnosticPanel({
  diagnostic,
  phaseOrder,
  phaseLabels,
  titleOk,
  titleBlocked,
  statusLabel = defaultStatusLabel,
  compact = false,
  className,
}: {
  diagnostic: IntegrationFlowDiagnosticLike;
  phaseOrder: string[];
  phaseLabels?: Record<string, string>;
  titleOk: string;
  titleBlocked: string;
  statusLabel?: (status: IntegrationFlowPhaseStatus) => string;
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
            {diagnostic.blocked_at ? titleBlocked : titleOk}
          </p>
          <p className="text-xs text-muted-foreground">{diagnostic.summary}</p>
        </div>
      </div>

      <ol className={cn("mt-3 space-y-2", compact ? "text-xs" : "text-sm")}>
        {phaseOrder.map((phaseKey, index) => {
          const report = diagnostic.phases[phaseKey];
          const label =
            report?.label || phaseLabels?.[phaseKey] || phaseKey;
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
                    {statusLabel(status)}
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

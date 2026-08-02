import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CashFlowDiagnostics } from "@/lib/cashFlowSimulation/types";
import { formatBrl } from "@/lib/dre/formatBrl";
import { Info } from "lucide-react";
import { Link } from "react-router-dom";

export function CashFlowEmptyState({
  diagnostics,
  partialAccess,
  includePayables,
  includeReceivables,
  horizonWeeks,
  clampedToLastBucketCount,
}: {
  diagnostics: CashFlowDiagnostics;
  partialAccess: boolean;
  includePayables: boolean;
  includeReceivables: boolean;
  horizonWeeks: number;
  clampedToLastBucketCount: number;
}) {
  const reasons: string[] = [];

  if (partialAccess) {
    const missing = !includePayables
      ? "contas a pagar"
      : !includeReceivables
        ? "vendas realizadas"
        : "";
    if (missing) {
      reasons.push(
        `Seu perfil não inclui acesso a ${missing}, então parte do fluxo não entra na simulação.`,
      );
    }
  }

  if (diagnostics.pendingOutsideHorizon > 0) {
    reasons.push(
      `${diagnostics.pendingOutsideHorizon} conta(s) pendente(s) vencem após as próximas ${horizonWeeks} semanas. Aumente o horizonte para incluí-las.`,
    );
  }

  if (diagnostics.overduePendingCount > 0) {
    reasons.push(
      `${diagnostics.overduePendingCount} conta(s) vencida(s) pendente(s) (${formatBrl(diagnostics.overduePendingPayablesAmount)} a pagar, ${formatBrl(diagnostics.overduePendingReceivablesAmount)} a receber) — ficam fora das semanas do horizonte (vencimento anterior à semana atual); use o saldo inicial para refletir o caixa real.`,
    );
  }

  if (diagnostics.pendingInHorizon === 0 && diagnostics.pendingOutsideHorizon === 0) {
    reasons.push(
      "Não há contas pendentes cadastradas no período consultado. Cadastre contas a pagar ou a receber com status pendente.",
    );
  }

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <CardTitle className="text-base">
              Nenhuma movimentação visível no horizonte
            </CardTitle>
            <CardDescription>
              A simulação usa apenas contas pendentes (a pagar e a receber) dentro
              do período selecionado.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {reasons.length > 0 ? (
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {clampedToLastBucketCount > 0 ? (
          <p className="text-muted-foreground">
            {clampedToLastBucketCount} movimentação(ões) foi(foram) alocada(s) na
            última semana por extrapolação do cenário.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 pt-1">
          {includePayables ? (
            <Link
              to="/app/contas-a-pagar"
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver contas a pagar
            </Link>
          ) : null}
          {includeReceivables ? (
            <Link
              to="/app/vendas-realizadas"
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver vendas realizadas
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

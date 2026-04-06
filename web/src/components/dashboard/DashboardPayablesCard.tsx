import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Boleto } from "@/types/expense";
import { ArrowRight, CalendarDays, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardBoletoDayBlock } from "./DashboardBoletoDayBlock";

export function DashboardPayablesCard({
  loading,
  todayLabel,
  tomorrowLabel,
  todayBoletos,
  tomorrowBoletos,
  formatCurrency,
}: {
  loading: boolean;
  todayLabel: string;
  tomorrowLabel: string;
  todayBoletos: Boleto[];
  tomorrowBoletos: Boleto[];
  formatCurrency: (v: number) => string;
}) {
  return (
    <Card className="overflow-hidden border-primary/20 shadow-sm ring-1 ring-border/50">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <CalendarDays className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <CardTitle className="text-lg">Contas a pagar</CardTitle>
              <CardDescription className="mt-1 max-w-prose">
                Boletos pendentes com vencimento hoje e amanhã — priorize o que
                vence primeiro.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <Link to="/app/fluxo-de-caixa">
              Fluxo completo
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando vencimentos…
          </div>
        ) : (
          <>
            <DashboardBoletoDayBlock
              label="Hoje"
              sublabel={todayLabel}
              items={todayBoletos}
              formatCurrency={formatCurrency}
            />
            <DashboardBoletoDayBlock
              label="Amanhã"
              sublabel={tomorrowLabel}
              items={tomorrowBoletos}
              formatCurrency={formatCurrency}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

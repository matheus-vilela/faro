import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChecklistRankingTable } from "@/components/checklist/ChecklistRankingTable";
import { buildOverviewDashboard } from "@/lib/checklistOverview";
import { loadChecklistOverviewInputs } from "@/lib/loadChecklistOverview";
import { spAddCalendarDays, spTodayYmd } from "@/lib/checklistSpDay";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function ChecklistRankingSection({
  companyId,
  reloadNonce = 0,
}: {
  companyId: string;
  reloadNonce?: number;
}) {
  const [rows, setRows] = useState(
    () =>
      buildOverviewDashboard({
        kind: "custom",
        customFrom: spAddCalendarDays(spTodayYmd(), -29),
        customTo: spTodayYmd(),
        assignments: [],
        runs: [],
      }).ranking,
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const today = spTodayYmd();
    const from = spAddCalendarDays(today, -29);
    try {
      const inputs = await loadChecklistOverviewInputs(companyId, from, today);
      setRows(
        buildOverviewDashboard({
          kind: "custom",
          customFrom: from,
          customTo: today,
          todayYmd: today,
          assignments: inputs.assignments,
          runs: inputs.runs,
        }).ranking,
      );
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, reloadNonce]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Qualidade das execuções · 30 dias
        </CardTitle>
        <CardDescription>
          Nota = média de Prazo, Completo e Preciso. Feito / esperado pela
          recorrência no mesmo período.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Como calculamos</p>
          <p>
            <span className="font-medium text-foreground">Prazo</span> — no
            horário (se não houver prazo, conta 100).
          </p>
          <p>
            <span className="font-medium text-foreground">Completo</span> — %
            de itens feitos naquele envio.
          </p>
          <p>
            <span className="font-medium text-foreground">Preciso</span> — 100
            se não foi devolvido; menor se está para refazer.
          </p>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
          </div>
        ) : (
          <ChecklistRankingTable
            rows={rows}
            emptyLabel="Nenhuma atribuição em checklist ativo nos últimos 30 dias."
          />
        )}
      </CardContent>
    </Card>
  );
}

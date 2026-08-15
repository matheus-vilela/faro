import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { staffScoreAxes, type ScoreRunInput } from "@/lib/checklistStaffScore";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type RankRow = {
  memberId: string;
  name: string;
  score: number;
  prazo: number;
  completo: number;
  preciso: number;
  runs: number;
};

export function ChecklistRankingSection({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data: members } = await supabase
      .from("company_members")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true);

    const { data: runs } = await supabase
      .from("checklist_runs")
      .select(
        `
        id, company_member_id, checklist_id, status, on_time, geofence_ok, submitted_at
      `,
      )
      .eq("company_id", companyId)
      .gte("submitted_at", since.toISOString())
      .in("status", ["submitted", "in_review", "approved", "needs_rework"]);

    const runList = runs ?? [];
    const runIds = runList.map((r) => r.id as string);
    let itemsByRun = new Map<string, { done: number; total: number }>();

    if (runIds.length > 0) {
      const { data: runItems } = await supabase
        .from("checklist_run_items")
        .select("run_id, completed_at")
        .in("run_id", runIds);
      const tmp = new Map<string, { done: number; total: number }>();
      for (const ri of runItems ?? []) {
        const id = ri.run_id as string;
        const cur = tmp.get(id) ?? { done: 0, total: 0 };
        cur.total += 1;
        if (ri.completed_at) cur.done += 1;
        tmp.set(id, cur);
      }
      itemsByRun = tmp;
    }

    const byMember = new Map<string, ScoreRunInput[]>();
    for (const r of runList) {
      const mid = r.company_member_id as string;
      const counts = itemsByRun.get(r.id as string) ?? { done: 0, total: 0 };
      const arr = byMember.get(mid) ?? [];
      arr.push({
        on_time: (r.on_time as boolean | null) ?? null,
        items_done: counts.done,
        items_total: counts.total,
        needs_rework: r.status === "needs_rework",
        geofence_ok: (r.geofence_ok as boolean | null) ?? null,
      });
      byMember.set(mid, arr);
    }

    const out: RankRow[] = [];
    for (const m of members ?? []) {
      const inputs = byMember.get(m.id as string) ?? [];
      if (inputs.length === 0) continue;
      const axes = staffScoreAxes(inputs);
      out.push({
        memberId: m.id as string,
        name: (m.name as string) || "—",
        ...axes,
        runs: inputs.length,
      });
    }
    out.sort((a, b) => b.score - a.score);
    setRows(out);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ranking · 30 dias</CardTitle>
        <CardDescription>
          Score Prazo · Completo · Preciso por colaborador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda sem execuções suficientes.
          </p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.memberId}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <div>
                  <span className="mr-2 font-bold text-muted-foreground">
                    {i + 1}º
                  </span>
                  <span className="font-semibold">{r.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.runs} exec.
                  </span>
                </div>
                <div className="text-right text-xs">
                  <p className="text-base font-extrabold">{r.score}</p>
                  <p className="text-muted-foreground">
                    P{r.prazo} · C{r.completo} · Pr{r.preciso}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

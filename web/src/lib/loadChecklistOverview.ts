import type {
  OverviewAssignmentInput,
  OverviewRunInput,
} from "@/lib/checklistOverview";
import { CHECKLIST_COMPLETED_STATUSES } from "@/lib/checklistOperationalTypes";
import type { ChecklistRecurrenceMeta } from "@/lib/checklistRecurrence";
import { spCivilRangeBoundsUtc } from "@/lib/checklistSpDay";
import { supabase } from "@/lib/supabase";

type ChecklistRow = ChecklistRecurrenceMeta & {
  id: string;
  title: string;
  deadline_time: string | null;
  window_end: string | null;
};

function timeOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export async function loadChecklistOverviewInputs(
  companyId: string,
  startYmd: string,
  endYmd: string,
): Promise<{
  assignments: OverviewAssignmentInput[];
  runs: OverviewRunInput[];
}> {
  const { data: cl, error: e1 } = await supabase
    .from("checklists")
    .select(
      "id, title, recurrence_kind, daily_executions_per_day, weekday_mask, monthly_executions, deadline_time, window_end",
    )
    .eq("company_id", companyId)
    .eq("active", true);
  if (e1) throw e1;

  const checklists = (cl ?? []) as ChecklistRow[];
  if (checklists.length === 0) {
    return { assignments: [], runs: [] };
  }

  const byId = new Map(checklists.map((c) => [c.id, c]));
  const checklistIds = checklists.map((c) => c.id);

  const { data: asg, error: e2 } = await supabase
    .from("checklist_assignments")
    .select("checklist_id, company_member_id, company_members ( id, name, is_active )")
    .eq("company_id", companyId)
    .in("checklist_id", checklistIds);
  if (e2) throw e2;

  const assignments: OverviewAssignmentInput[] = [];
  for (const row of asg ?? []) {
    const cid = row.checklist_id as string;
    const checklist = byId.get(cid);
    const m = row.company_members as
      | { id?: string; name?: string; is_active?: boolean }
      | null;
    if (!checklist || !m?.id || m.is_active === false) continue;
    assignments.push({
      checklistId: cid,
      checklistTitle: checklist.title,
      memberId: m.id,
      memberName: m.name?.trim() || "Operador",
      meta: {
        recurrence_kind: checklist.recurrence_kind,
        daily_executions_per_day: checklist.daily_executions_per_day,
        weekday_mask: checklist.weekday_mask,
        monthly_executions: checklist.monthly_executions,
      },
      deadlineOrWindowEnd:
        timeOrNull(checklist.deadline_time) ?? timeOrNull(checklist.window_end),
    });
  }

  const { startIso, endIso } = spCivilRangeBoundsUtc(startYmd, endYmd);
  const scoreStatuses = [...CHECKLIST_COMPLETED_STATUSES, "needs_rework"];

  const [{ data: submitted, error: e3 }, { data: openRuns, error: e4 }] =
    await Promise.all([
      supabase
        .from("checklist_runs")
        .select(
          "id, checklist_id, company_member_id, status, submitted_at, on_time, geofence_ok",
        )
        .eq("company_id", companyId)
        .in("checklist_id", checklistIds)
        .in("status", scoreStatuses)
        .not("submitted_at", "is", null)
        .gte("submitted_at", startIso)
        .lte("submitted_at", endIso),
      supabase
        .from("checklist_runs")
        .select(
          "id, checklist_id, company_member_id, status, submitted_at, on_time, geofence_ok",
        )
        .eq("company_id", companyId)
        .in("checklist_id", checklistIds)
        .eq("status", "open"),
    ]);
  if (e3) throw e3;
  if (e4) throw e4;

  const runRows = [...(submitted ?? []), ...(openRuns ?? [])];
  const runIds = runRows
    .filter((r) => r.status !== "open")
    .map((r) => r.id as string);

  const itemsByRun = new Map<string, { done: number; total: number }>();
  if (runIds.length > 0) {
    const { data: runItems, error: e5 } = await supabase
      .from("checklist_run_items")
      .select("run_id, completed_at")
      .in("run_id", runIds);
    if (e5) throw e5;
    for (const ri of runItems ?? []) {
      const id = ri.run_id as string;
      const cur = itemsByRun.get(id) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (ri.completed_at) cur.done += 1;
      itemsByRun.set(id, cur);
    }
  }

  const runs: OverviewRunInput[] = runRows.map((r) => {
    const counts = itemsByRun.get(r.id as string) ?? { done: 0, total: 0 };
    return {
      checklistId: r.checklist_id as string,
      memberId: r.company_member_id as string,
      status: r.status as string,
      submittedAt: (r.submitted_at as string | null) ?? null,
      on_time: (r.on_time as boolean | null) ?? null,
      geofence_ok: (r.geofence_ok as boolean | null) ?? null,
      itemsDone: counts.done,
      itemsTotal: counts.total,
    };
  });

  return { assignments, runs };
}

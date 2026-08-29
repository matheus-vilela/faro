import {
  CHECKLIST_COMPLETED_STATUSES,
  type ChecklistRunStatus,
} from "@/lib/checklistOperationalTypes";
import {
  expectedInYmds,
  expectedOnYmdInRange,
  type ChecklistRecurrenceMeta,
} from "@/lib/checklistRecurrence";
import {
  isChecklistSlotPastDue,
  isoToSpYmd,
  listSpYmdsInclusive,
  minYmd,
  spAddCalendarDays,
  spMondayOfWeek,
  spMonthEndYmd,
  spMonthStartYmd,
  spTodayYmd,
} from "@/lib/checklistSpDay";
import { staffScoreAxes, type ScoreRunInput } from "@/lib/checklistStaffScore";

export type OverviewPeriodKind = "today" | "week" | "month" | "custom";

export type OverviewKpis = {
  scheduled: number;
  notStarted: number;
  inProgress: number;
  late: number;
  finished: number;
};

export type OverviewDayPoint = {
  ymd: string;
  label: string;
  expected: number;
  finished: number;
  rate: number;
};

const WD_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export function overviewPeriodRange(
  kind: OverviewPeriodKind,
  customFrom?: string,
  customTo?: string,
  today = spTodayYmd(),
): { startYmd: string; endYmd: string } {
  if (kind === "today") return { startYmd: today, endYmd: today };
  if (kind === "week") {
    const mon = spMondayOfWeek(today);
    return { startYmd: mon, endYmd: spAddCalendarDays(mon, 6) };
  }
  if (kind === "month") {
    return { startYmd: spMonthStartYmd(today), endYmd: spMonthEndYmd(today) };
  }
  const from = customFrom && customFrom <= today ? customFrom : today;
  const to = customTo && customTo >= from ? customTo : today;
  return { startYmd: from, endYmd: to };
}

export function overviewPeriodLabel(kind: OverviewPeriodKind): string {
  if (kind === "today") return "Hoje";
  if (kind === "week") return "Esta semana";
  if (kind === "month") return "Este mês";
  return "Período";
}

export function ymdChartLabel(ymd: string, kind: OverviewPeriodKind): string {
  if (kind === "month" || kind === "custom") {
    const [, , d] = ymd.split("-");
    return String(Number(d));
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return WD_SHORT[map[wd.slice(0, 3)] ?? 0] ?? ymd;
}

export function accumulateAssignmentKpis(input: {
  ymds: string[];
  todayYmd: string;
  expectedOnYmd: (ymd: string) => number;
  finishedOnYmd: (ymd: string) => number;
  openCount: number;
  isPastDue: (ymd: string) => boolean;
}): OverviewKpis {
  let scheduled = 0;
  let finished = 0;
  let notStarted = 0;
  let inProgress = 0;
  let late = 0;
  let openLeft = Math.max(0, input.openCount);

  for (const ymd of input.ymds) {
    const exp = Math.max(0, input.expectedOnYmd(ymd));
    scheduled += exp;
    const done = Math.max(0, input.finishedOnYmd(ymd));
    finished += done;
    const rem = Math.max(0, exp - done);
    if (rem === 0) continue;
    if (input.isPastDue(ymd)) {
      if (ymd === input.todayYmd) {
        const take = Math.min(rem, openLeft);
        inProgress += take;
        openLeft -= take;
        late += rem - take;
      } else {
        late += rem;
      }
    } else {
      const take = Math.min(rem, openLeft);
      inProgress += take;
      openLeft -= take;
      notStarted += rem - take;
    }
  }

  return { scheduled, notStarted, inProgress, late, finished };
}

export function sumKpis(parts: OverviewKpis[]): OverviewKpis {
  return parts.reduce(
    (acc, p) => ({
      scheduled: acc.scheduled + p.scheduled,
      notStarted: acc.notStarted + p.notStarted,
      inProgress: acc.inProgress + p.inProgress,
      late: acc.late + p.late,
      finished: acc.finished + p.finished,
    }),
    { scheduled: 0, notStarted: 0, inProgress: 0, late: 0, finished: 0 },
  );
}

export function completionRate(kpis: OverviewKpis): number {
  if (kpis.scheduled <= 0) return kpis.finished > 0 ? 100 : 0;
  return Math.min(100, Math.round((kpis.finished / kpis.scheduled) * 100));
}

export function kpiPercent(part: number, scheduled: number): number {
  if (scheduled <= 0) return 0;
  return Math.round((part / scheduled) * 100);
}

export function scoreTone(score: number): "good" | "mid" | "low" {
  if (score >= 85) return "good";
  if (score >= 70) return "mid";
  return "low";
}

export function buildDayPoints(
  chartYmds: string[],
  kind: OverviewPeriodKind,
  expectedByYmd: Map<string, number>,
  finishedByYmd: Map<string, number>,
): OverviewDayPoint[] {
  return chartYmds.map((ymd) => {
    const expected = expectedByYmd.get(ymd) ?? 0;
    const finished = finishedByYmd.get(ymd) ?? 0;
    const rate =
      expected > 0
        ? Math.min(100, Math.round((finished / expected) * 100))
        : finished > 0
          ? 100
          : 0;
    return {
      ymd,
      label: ymdChartLabel(ymd, kind),
      expected,
      finished,
      rate,
    };
  });
}

export function clippedYmdsForKpis(
  startYmd: string,
  endYmd: string,
  todayYmd = spTodayYmd(),
): string[] {
  return listSpYmdsInclusive(startYmd, minYmd(endYmd, todayYmd));
}

export function expectedMapForMeta(
  meta: ChecklistRecurrenceMeta,
  ymds: string[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ymd of ymds) {
    map.set(ymd, expectedOnYmdInRange(meta, ymd, ymds));
  }
  return map;
}

/** Mensal: soma os envios do mês no dia em que a cota aparece. Diária: o próprio dia. */
export function finishedAttributedToYmd(
  meta: ChecklistRecurrenceMeta,
  ymd: string,
  ymds: string[],
  countByYmd: Map<string, number>,
): number {
  if (meta.recurrence_kind !== "monthly") {
    return countByYmd.get(ymd) ?? 0;
  }
  const ym = ymd.slice(0, 7);
  const first = ymds.find((d) => d.startsWith(ym));
  if (first !== ymd) return 0;
  let n = 0;
  for (const d of ymds) {
    if (d.startsWith(ym)) n += countByYmd.get(d) ?? 0;
  }
  return n;
}

export function formatYmdRangeLabel(startYmd: string, endYmd: string): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
    return dt.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
      month: "short",
    });
  };
  if (startYmd === endYmd) return fmt(startYmd);
  return `${fmt(startYmd)} – ${fmt(endYmd)}`;
}

export function scoreToneClass(score: number): string {
  const tone = scoreTone(score);
  if (tone === "good") {
    return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
  }
  if (tone === "mid") {
    return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
  }
  return "bg-red-500/15 text-red-800 dark:text-red-300";
}

export type OverviewAssignmentInput = {
  checklistId: string;
  checklistTitle: string;
  memberId: string;
  memberName: string;
  meta: ChecklistRecurrenceMeta;
  deadlineOrWindowEnd: string | null;
};

export type OverviewRunInput = {
  checklistId: string;
  memberId: string;
  status: string;
  submittedAt: string | null;
  on_time: boolean | null;
  geofence_ok: boolean | null;
  itemsDone: number;
  itemsTotal: number;
};

export type OverviewRankAssignment = {
  checklistId: string;
  checklistTitle: string;
  finished: number;
  expected: number;
};

export type OverviewRankRow = {
  memberId: string;
  name: string;
  score: number | null;
  prazo: number | null;
  completo: number | null;
  preciso: number | null;
  runs: number;
  finished: number;
  expected: number;
  assignments: OverviewRankAssignment[];
};

function asgKey(checklistId: string, memberId: string): string {
  return `${checklistId}|${memberId}`;
}

const COMPLETED = new Set<string>(CHECKLIST_COMPLETED_STATUSES);
const SCORE_STATUSES = new Set<string>([
  ...CHECKLIST_COMPLETED_STATUSES,
  "needs_rework",
]);

export function buildOverviewDashboard(input: {
  kind: OverviewPeriodKind;
  customFrom?: string;
  customTo?: string;
  todayYmd?: string;
  assignments: OverviewAssignmentInput[];
  runs: OverviewRunInput[];
}): {
  range: { startYmd: string; endYmd: string };
  kpis: OverviewKpis;
  dayPoints: OverviewDayPoint[];
  ranking: OverviewRankRow[];
} {
  const todayYmd = input.todayYmd ?? spTodayYmd();
  const range = overviewPeriodRange(
    input.kind,
    input.customFrom,
    input.customTo,
    todayYmd,
  );
  const chartYmds = listSpYmdsInclusive(range.startYmd, range.endYmd);
  const kpiYmds = clippedYmdsForKpis(range.startYmd, range.endYmd, todayYmd);

  const finishedByAsgYmd = new Map<string, Map<string, number>>();
  const openByAsg = new Map<string, number>();

  for (const run of input.runs) {
    const k = asgKey(run.checklistId, run.memberId);
    if (run.status === "open") {
      openByAsg.set(k, (openByAsg.get(k) ?? 0) + 1);
      continue;
    }
    if (!run.submittedAt || !COMPLETED.has(run.status as ChecklistRunStatus)) {
      continue;
    }
    const ymd = isoToSpYmd(run.submittedAt);
    if (ymd < range.startYmd || ymd > range.endYmd) continue;
    const m = finishedByAsgYmd.get(k) ?? new Map<string, number>();
    m.set(ymd, (m.get(ymd) ?? 0) + 1);
    finishedByAsgYmd.set(k, m);
  }

  const expectedByYmd = new Map<string, number>();
  const finishedByYmd = new Map<string, number>();
  for (const ymd of chartYmds) {
    expectedByYmd.set(ymd, 0);
    finishedByYmd.set(ymd, 0);
  }

  const kpiParts: OverviewKpis[] = [];
  type MemberAcc = {
    name: string;
    expected: number;
    finished: number;
    scoreInputs: ScoreRunInput[];
    assignments: OverviewRankAssignment[];
  };
  const byMember = new Map<string, MemberAcc>();

  const memberAcc = (memberId: string, name: string): MemberAcc => {
    let acc = byMember.get(memberId);
    if (!acc) {
      acc = {
        name,
        expected: 0,
        finished: 0,
        scoreInputs: [],
        assignments: [],
      };
      byMember.set(memberId, acc);
    }
    return acc;
  };

  for (const asg of input.assignments) {
    const k = asgKey(asg.checklistId, asg.memberId);
    const countByYmd = finishedByAsgYmd.get(k) ?? new Map<string, number>();

    for (const ymd of chartYmds) {
      const exp = expectedOnYmdInRange(asg.meta, ymd, chartYmds);
      expectedByYmd.set(ymd, (expectedByYmd.get(ymd) ?? 0) + exp);
      finishedByYmd.set(
        ymd,
        (finishedByYmd.get(ymd) ?? 0) + (countByYmd.get(ymd) ?? 0),
      );
    }

    kpiParts.push(
      accumulateAssignmentKpis({
        ymds: kpiYmds,
        todayYmd,
        expectedOnYmd: (ymd) => expectedOnYmdInRange(asg.meta, ymd, kpiYmds),
        finishedOnYmd: (ymd) =>
          finishedAttributedToYmd(asg.meta, ymd, kpiYmds, countByYmd),
        openCount: openByAsg.get(k) ?? 0,
        isPastDue: (ymd) =>
          isChecklistSlotPastDue(ymd, todayYmd, asg.deadlineOrWindowEnd),
      }),
    );

    const expTotal = expectedInYmds(asg.meta, kpiYmds);
    const finTotal = kpiYmds.reduce(
      (sum, ymd) =>
        sum + finishedAttributedToYmd(asg.meta, ymd, kpiYmds, countByYmd),
      0,
    );
    const acc = memberAcc(asg.memberId, asg.memberName);
    acc.expected += expTotal;
    acc.finished += finTotal;
    acc.assignments.push({
      checklistId: asg.checklistId,
      checklistTitle: asg.checklistTitle,
      finished: finTotal,
      expected: expTotal,
    });
  }

  for (const run of input.runs) {
    if (!SCORE_STATUSES.has(run.status) || !run.submittedAt) continue;
    const ymd = isoToSpYmd(run.submittedAt);
    if (!kpiYmds.includes(ymd)) continue;
    const acc = byMember.get(run.memberId);
    if (!acc) continue;
    acc.scoreInputs.push({
      on_time: run.on_time,
      items_done: run.itemsDone,
      items_total: run.itemsTotal,
      needs_rework: run.status === "needs_rework",
      geofence_ok: run.geofence_ok,
    });
  }

  const ranking: OverviewRankRow[] = [];
  for (const [memberId, acc] of byMember) {
    if (
      acc.expected <= 0 &&
      acc.finished <= 0 &&
      acc.scoreInputs.length === 0
    ) {
      continue;
    }
    const axes =
      acc.scoreInputs.length > 0 ? staffScoreAxes(acc.scoreInputs) : null;
    ranking.push({
      memberId,
      name: acc.name,
      score: axes?.score ?? null,
      prazo: axes?.prazo ?? null,
      completo: axes?.completo ?? null,
      preciso: axes?.preciso ?? null,
      runs: acc.scoreInputs.length,
      finished: acc.finished,
      expected: acc.expected,
      assignments: acc.assignments,
    });
  }
  ranking.sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sb !== sa) return sb - sa;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return {
    range,
    kpis: sumKpis(kpiParts),
    dayPoints: buildDayPoints(
      chartYmds,
      input.kind,
      expectedByYmd,
      finishedByYmd,
    ),
    ranking,
  };
}

export { isChecklistSlotPastDue };

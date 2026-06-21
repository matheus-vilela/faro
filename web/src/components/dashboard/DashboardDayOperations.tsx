import { DashboardBoletoDayBlock } from "@/components/dashboard/DashboardBoletoDayBlock";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import {
  expectedCompletionsRolling,
  getWeekdaySP,
  type ChecklistRecurrenceMeta,
} from "@/lib/checklistRecurrence";
import { spCivilDayBoundsUtc, spTodayYmd } from "@/lib/checklistSpDay";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Boleto } from "@/types/expense";
import {
  ArrowRight,
  ChevronRight,
  ClipboardList,
  ListChecks,
  Loader2,
  PackageCheck,
  TrendingDown,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type SheetKind = "payables" | "checklists" | "inventory" | "recebimento" | null;

type ChecklistRow = {
  id: string;
  title: string;
  active: boolean;
  recurrence_kind: "daily" | "monthly";
  daily_executions_per_day: number | null;
  weekday_mask: number;
  monthly_executions: number | null;
};

type ChecklistRunToday = {
  id: string;
  submitted_at: string;
  checklist_id: string;
  company_member_id: string;
  checklists: { title: string } | null;
  company_members: { name: string } | null;
};

type PendingAssignment = {
  checklistTitle: string;
  memberName: string;
  expected: number;
  actual: number;
};

type InventorySessionRow = {
  id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  inventory_count_groups: { name: string } | null;
  inventory_count_listings: { name: string } | null;
  assigned_member: { name: string } | null;
  initiator_member: { name: string } | null;
};

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dueDateKey(s: string): string {
  return s.slice(0, 10);
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function checklistMeta(r: ChecklistRow): ChecklistRecurrenceMeta {
  return {
    recurrence_kind: r.recurrence_kind,
    daily_executions_per_day: r.daily_executions_per_day,
    weekday_mask: r.weekday_mask,
    monthly_executions: r.monthly_executions,
  };
}

function isChecklistDueToday(r: ChecklistRow, now = new Date()): boolean {
  if (!r.active) return false;
  if (r.recurrence_kind === "monthly") {
    const day = Number(
      now.toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo",
        day: "numeric",
      }),
    );
    const perMonth = r.monthly_executions ?? 1;
    return day <= perMonth;
  }
  const mask = r.weekday_mask;
  return (mask & (1 << getWeekdaySP(now))) !== 0;
}

type RecebimentoDashboardRow = {
  id: string;
  status: "pending" | "received";
  created_at: string;
  received_at: string | null;
  expenses?: {
    supplier_name: string | null;
    display_name: string | null;
    invoice_number: string | null;
  } | null;
};

function recebimentoTitle(r: RecebimentoDashboardRow): string {
  return (
    r.expenses?.display_name?.trim() ||
    r.expenses?.supplier_name?.trim() ||
    "Sem fornecedor"
  );
}

export function DashboardDayOperations() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<SheetKind>(null);

  const [todayBoletos, setTodayBoletos] = useState<Boleto[]>([]);
  const [tomorrowBoletos, setTomorrowBoletos] = useState<Boleto[]>([]);

  const [checklistCompleted, setChecklistCompleted] = useState(0);
  const [checklistPending, setChecklistPending] = useState(0);
  const [checklistRunsToday, setChecklistRunsToday] = useState<
    ChecklistRunToday[]
  >([]);
  const [checklistPendingRows, setChecklistPendingRows] = useState<
    PendingAssignment[]
  >([]);

  const [inventoryPending, setInventoryPending] = useState(0);
  const [inventoryCompleted, setInventoryCompleted] = useState(0);
  const [inventoryOpenRows, setInventoryOpenRows] = useState<
    InventorySessionRow[]
  >([]);
  const [inventorySubmittedToday, setInventorySubmittedToday] = useState<
    InventorySessionRow[]
  >([]);

  const [recebPending, setRecebPending] = useState(0);
  const [recebReceivedToday, setRecebReceivedToday] = useState(0);
  const [recebPendingRows, setRecebPendingRows] = useState<
    RecebimentoDashboardRow[]
  >([]);
  const [recebReceivedTodayRows, setRecebReceivedTodayRows] = useState<
    RecebimentoDashboardRow[]
  >([]);

  const todayLabel = useMemo(() => formatLongDate(new Date()), []);
  const tomorrowLabel = useMemo(() => {
    const n = new Date();
    n.setDate(n.getDate() + 1);
    return formatLongDate(n);
  }, []);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      setTodayBoletos([]);
      setTomorrowBoletos([]);
      setChecklistCompleted(0);
      setChecklistPending(0);
      setChecklistRunsToday([]);
      setChecklistPendingRows([]);
      setInventoryPending(0);
      setInventoryCompleted(0);
      setInventoryOpenRows([]);
      setInventorySubmittedToday([]);
      setRecebPending(0);
      setRecebReceivedToday(0);
      setRecebPendingRows([]);
      setRecebReceivedTodayRows([]);
      return;
    }

    setLoading(true);
    const todayStr = localDateKey(new Date());
    const next = new Date();
    next.setDate(next.getDate() + 1);
    const tomorrowStr = localDateKey(next);
    const todayYmd = spTodayYmd();
    const { startIso, endIso } = spCivilDayBoundsUtc(todayYmd);

    const [boletosRes, checklistsRes, inventoryRes, expensesRes] =
      await Promise.all([
        supabase
          .from("boletos")
          .select("id, description, due_date, amount, status")
          .eq("company_id", companyId)
          .eq("flow_type", "payable")
          .eq("exclude_from_fluxo", false)
          .in("due_date", [todayStr, tomorrowStr])
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .order("amount", { ascending: false }),
        supabase
          .from("checklists")
          .select(
            "id, title, active, recurrence_kind, daily_executions_per_day, weekday_mask, monthly_executions",
          )
          .eq("company_id", companyId)
          .eq("active", true),
        supabase
          .from("inventory_count_sessions")
          .select(
            `
          id,
          status,
          created_at,
          submitted_at,
          inventory_count_groups ( name ),
          inventory_count_listings ( name ),
          assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey ( name ),
          initiator_member:company_members!inventory_count_sessions_company_member_id_fkey ( name )
        `,
          )
          .eq("company_id", companyId)
          .in("status", ["open", "submitted"])
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("expenses")
          .select("id")
          .eq("company_id", companyId)
          .or("expense_source.neq.whatsapp,status.eq.approved"),
      ]);

    const boletosList = (boletosRes.data ?? []) as Boleto[];
    setTodayBoletos(
      boletosList.filter((b) => dueDateKey(b.due_date) === todayStr),
    );
    setTomorrowBoletos(
      boletosList.filter((b) => dueDateKey(b.due_date) === tomorrowStr),
    );

    const checklistRows = (checklistsRes.data ?? []) as ChecklistRow[];
    const checklistIds = checklistRows.map((c) => c.id);

    if (checklistIds.length === 0) {
      setChecklistCompleted(0);
      setChecklistPending(0);
      setChecklistRunsToday([]);
      setChecklistPendingRows([]);
    } else {
      const [asgRes, runsRes] = await Promise.all([
        supabase
          .from("checklist_assignments")
          .select("checklist_id, company_member_id, company_members ( name )")
          .in("checklist_id", checklistIds),
        supabase
          .from("checklist_runs")
          .select(
            `
            id,
            submitted_at,
            checklist_id,
            company_member_id,
            checklists ( title ),
            company_members ( name )
          `,
          )
          .eq("status", "submitted")
          .not("submitted_at", "is", null)
          .gte("submitted_at", startIso)
          .lte("submitted_at", endIso)
          .in("checklist_id", checklistIds)
          .order("submitted_at", { ascending: false }),
      ]);

      const runsToday = (runsRes.data ?? []) as unknown as ChecklistRunToday[];
      setChecklistRunsToday(runsToday);
      setChecklistCompleted(runsToday.length);

      const byChecklist = new Map(checklistRows.map((c) => [c.id, c] as const));
      const now = new Date();
      const pendingList: PendingAssignment[] = [];
      let pendingSlots = 0;

      for (const row of asgRes.data ?? []) {
        const cid = row.checklist_id as string;
        const mid = row.company_member_id as string;
        const checklist = byChecklist.get(cid);
        if (!checklist) continue;
        if (checklist.recurrence_kind !== "daily") continue;
        if (!isChecklistDueToday(checklist, now)) continue;

        const expected = expectedCompletionsRolling(
          checklistMeta(checklist),
          1,
          now,
        );
        if (expected <= 0) continue;

        const actual = runsToday.filter(
          (r) => r.checklist_id === cid && r.company_member_id === mid,
        ).length;
        const missing = Math.max(0, expected - actual);
        pendingSlots += missing;

        if (missing > 0) {
          const m = row.company_members as { name?: string } | null;
          pendingList.push({
            checklistTitle: checklist.title,
            memberName: m?.name?.trim() || "Membro",
            expected,
            actual,
          });
        }
      }

      setChecklistPending(pendingSlots);
      setChecklistPendingRows(
        pendingList.sort((a, b) =>
          a.checklistTitle.localeCompare(b.checklistTitle, "pt-BR"),
        ),
      );
    }

    const invRows = (inventoryRes.data ?? []) as unknown as InventorySessionRow[];
    const open = invRows.filter((r) => r.status === "open");
    const submittedToday = invRows.filter(
      (r) =>
        r.status === "submitted" &&
        r.submitted_at &&
        r.submitted_at >= startIso &&
        r.submitted_at <= endIso,
    );
    setInventoryPending(open.length);
    setInventoryCompleted(submittedToday.length);
    setInventoryOpenRows(open);
    setInventorySubmittedToday(submittedToday);

    const expenseIds = (expensesRes.data ?? []).map((e) => e.id as string);
    if (expenseIds.length === 0) {
      setRecebPending(0);
      setRecebReceivedToday(0);
      setRecebPendingRows([]);
      setRecebReceivedTodayRows([]);
    } else {
      const { data: recData } = await supabase
        .from("recebimentos")
        .select(
          `
          id,
          status,
          created_at,
          received_at,
          expenses (
            supplier_name,
            display_name,
            invoice_number
          )
        `,
        )
        .in("expense_id", expenseIds)
        .order("updated_at", { ascending: false })
        .limit(120);

      const recList = (recData ?? []) as unknown as RecebimentoDashboardRow[];
      const pending = recList.filter((r) => r.status === "pending");
      const receivedToday = recList.filter(
        (r) =>
          r.status === "received" &&
          r.received_at &&
          r.received_at >= startIso &&
          r.received_at <= endIso,
      );
      setRecebPending(pending.length);
      setRecebReceivedToday(receivedToday.length);
      setRecebPendingRows(pending);
      setRecebReceivedTodayRows(receivedToday);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const todayTotal = useMemo(
    () => todayBoletos.reduce((s, b) => s + b.amount, 0),
    [todayBoletos],
  );
  const tomorrowTotal = useMemo(
    () => tomorrowBoletos.reduce((s, b) => s + b.amount, 0),
    [tomorrowBoletos],
  );

  if (!companyId) return null;

  return (
    <section aria-label="Operação do dia" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Operação do dia
          </h2>
          <p className="text-xs text-muted-foreground">Resumo de hoje</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DayOpCard
          icon={TrendingDown}
          title="Contas a pagar"
          loading={loading}
          tone="primary"
          metrics={[
            {
              label: "Vencem hoje",
              value: String(todayBoletos.length),
              hint:
                todayBoletos.length > 0
                  ? formatCurrency(todayTotal)
                  : "Sem pendências",
            },
            {
              label: "Vencem amanhã",
              value: String(tomorrowBoletos.length),
              hint:
                tomorrowBoletos.length > 0
                  ? formatCurrency(tomorrowTotal)
                  : "Sem pendências",
            },
          ]}
          onOpen={() => setSheet("payables")}
        />
        <DayOpCard
          icon={ListChecks}
          title="Checklists"
          loading={loading}
          tone="muted"
          metrics={[
            {
              label: "Concluídos hoje",
              value: String(checklistCompleted),
              hint: "Execuções enviadas",
            },
            {
              label: "Pendentes",
              value: String(checklistPending),
              hint:
                checklistPending > 0
                  ? "Execuções em falta hoje"
                  : "Meta do dia atingida",
            },
          ]}
          onOpen={() => setSheet("checklists")}
        />
        <DayOpCard
          icon={ClipboardList}
          title="Contagem de estoque"
          loading={loading}
          tone="muted"
          metrics={[
            {
              label: "Concluídas hoje",
              value: String(inventoryCompleted),
              hint: "Sessões enviadas hoje",
            },
            {
              label: "Pendentes",
              value: String(inventoryPending),
              hint:
                inventoryPending > 0
                  ? "Sessões abertas"
                  : "Nenhuma em andamento",
            },
          ]}
          onOpen={() => setSheet("inventory")}
        />
        <DayOpCard
          icon={PackageCheck}
          title="Recebimento de mercadorias"
          loading={loading}
          tone="muted"
          metrics={[
            {
              label: "Recebidos hoje",
              value: String(recebReceivedToday),
              hint: "Confirmados hoje",
            },
            {
              label: "Pendentes",
              value: String(recebPending),
              hint:
                recebPending > 0 ? "Aguardando confirmação" : "Nada em aberto",
            },
          ]}
          onOpen={() => setSheet("recebimento")}
        />
      </div>

      <Sheet
        open={sheet === "payables"}
        onOpenChange={(o) => !o && setSheet(null)}
      >
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Contas a pagar</SheetTitle>
            <SheetDescription>
              Boletos pendentes com vencimento hoje e amanhã.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
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
          </div>
          <SheetFooter className="border-t">
            <Button asChild className="w-full sm:w-auto">
              <Link to="/app/contas-a-pagar" onClick={() => setSheet(null)}>
                Abrir contas a pagar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={sheet === "checklists"}
        onOpenChange={(o) => !o && setSheet(null)}
      >
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Checklists do dia</SheetTitle>
            <SheetDescription>
              Execuções concluídas hoje e pendências por atribuição.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <DetailSection
              title="Concluídos"
              empty="Nenhuma execução concluída hoje."
              count={checklistRunsToday.length}
            >
              {checklistRunsToday.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-2 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {r.checklists?.title ?? "Checklist"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.company_members?.name?.trim() || "Membro"} ·{" "}
                      {formatDt(r.submitted_at)}
                    </p>
                  </div>
                </li>
              ))}
            </DetailSection>
            <DetailSection
              title="Pendentes"
              empty="Nenhuma pendência para o dia."
              count={checklistPendingRows.length}
            >
              {checklistPendingRows.map((p, i) => (
                <li
                  key={`${p.checklistTitle}-${p.memberName}-${i}`}
                  className="px-3 py-2.5 text-sm"
                >
                  <p className="font-medium">{p.checklistTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.memberName} · {p.actual}/{p.expected} realizados
                  </p>
                </li>
              ))}
            </DetailSection>
          </div>
          <SheetFooter className="border-t">
            <Button asChild className="w-full sm:w-auto">
              <Link to="/app/checklists" onClick={() => setSheet(null)}>
                Abrir checklists
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={sheet === "inventory"}
        onOpenChange={(o) => !o && setSheet(null)}
      >
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Contagem de estoque</SheetTitle>
            <SheetDescription>
              Sessões abertas e contagens concluídas hoje.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <DetailSection
              title="Pendentes (abertas)"
              empty="Nenhuma contagem em andamento."
              count={inventoryOpenRows.length}
            >
              {inventoryOpenRows.map((r) => (
                <InventoryListItem key={r.id} row={r} variant="open" />
              ))}
            </DetailSection>
            <DetailSection
              title="Concluídas hoje"
              empty="Nenhuma contagem concluída hoje."
              count={inventorySubmittedToday.length}
            >
              {inventorySubmittedToday.map((r) => (
                <InventoryListItem key={r.id} row={r} variant="submitted" />
              ))}
            </DetailSection>
          </div>
          <SheetFooter className="border-t">
            <Button asChild className="w-full sm:w-auto">
              <Link
                to="/app/produtos?aba=contagem"
                onClick={() => setSheet(null)}
              >
                Abrir contagem de estoque
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={sheet === "recebimento"}
        onOpenChange={(o) => !o && setSheet(null)}
      >
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Recebimento de mercadorias</SheetTitle>
            <SheetDescription>
              Recebimentos confirmados hoje e pendentes de confirmação.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <DetailSection
              title="Recebidos hoje"
              empty="Nenhum recebimento confirmado hoje."
              count={recebReceivedTodayRows.length}
            >
              {recebReceivedTodayRows.map((r) => (
                <RecebimentoListItem key={r.id} row={r} received />
              ))}
            </DetailSection>
            <DetailSection
              title="Pendentes"
              empty="Nenhum recebimento pendente."
              count={recebPendingRows.length}
            >
              {recebPendingRows.map((r) => (
                <RecebimentoListItem key={r.id} row={r} />
              ))}
            </DetailSection>
          </div>
          <SheetFooter className="border-t">
            <Button asChild className="w-full sm:w-auto">
              <Link to="/app/recebimento" onClick={() => setSheet(null)}>
                Abrir recebimento
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function DayOpCard({
  icon: Icon,
  title,
  metrics,
  loading,
  tone,
  onOpen,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  metrics: { label: string; value: string; hint: string }[];
  loading: boolean;
  tone: "primary" | "muted";
  onOpen: () => void;
}) {
  const isPrimary = tone === "primary";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-colors",
        "hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isPrimary
          ? "border-primary/30 ring-1 ring-primary/10"
          : "border-border/80",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-3.5 py-3",
          isPrimary
            ? "border-primary/15 bg-primary/[0.04]"
            : "border-border/60 bg-muted/20",
        )}
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            isPrimary
              ? "bg-primary/15 text-primary"
              : "bg-background text-muted-foreground shadow-sm",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {title}
        </p>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            "group-hover:translate-x-0.5 group-hover:text-foreground",
          )}
          aria-hidden
        />
      </div>

      {loading ? (
        <div className="flex min-h-[5.5rem] items-center justify-center px-3 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 divide-x divide-border/70">
          {metrics.map((m, i) => (
            <DayOpMetricCell
              key={m.label}
              label={m.label}
              value={m.value}
              hint={m.hint}
              emphasize={isPrimary && i === 0}
            />
          ))}
        </div>
      )}
    </button>
  );
}

function DayOpMetricCell({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint: string;
  emphasize?: boolean;
}) {
  const isZero = value === "0";
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
      <span className="text-[11px] font-medium text-muted-foreground leading-none">
        {label}
      </span>
      <span
        className={cn(
          "text-2xl font-bold tabular-nums leading-none tracking-tight",
          emphasize && !isZero && "text-primary",
          isZero && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-[11px] leading-snug",
          isZero ? "text-muted-foreground/80" : "text-foreground/70",
        )}
        title={hint}
      >
        {hint}
      </span>
    </div>
  );
}

function DetailSection({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/15 px-3 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border bg-muted/10">
          {children}
        </ul>
      )}
    </div>
  );
}

function InventoryListItem({
  row,
  variant,
}: {
  row: InventorySessionRow;
  variant: "open" | "submitted";
}) {
  const group = row.inventory_count_groups?.name?.trim() || "—";
  const listing = row.inventory_count_listings?.name?.trim() || "—";
  const assigned = row.assigned_member?.name?.trim();
  const initiator = row.initiator_member?.name?.trim();
  const who = assigned || initiator || "—";
  const when =
    variant === "open" ? formatDt(row.created_at) : formatDt(row.submitted_at);

  return (
    <li className="px-3 py-2.5 text-sm">
      <p className="font-medium">
        {group} · {listing}
      </p>
      <p className="text-xs text-muted-foreground">
        {who} · {when}
      </p>
    </li>
  );
}

function RecebimentoListItem({
  row,
  received,
}: {
  row: RecebimentoDashboardRow;
  received?: boolean;
}) {
  const nf = row.expenses?.invoice_number?.trim();
  return (
    <li className="px-3 py-2.5 text-sm">
      <p className="font-medium truncate">{recebimentoTitle(row)}</p>
      <p className="text-xs text-muted-foreground">
        {nf ? `NF ${nf} · ` : ""}
        {received
          ? formatDt(row.received_at)
          : `Criado ${formatDt(row.created_at)}`}
      </p>
    </li>
  );
}

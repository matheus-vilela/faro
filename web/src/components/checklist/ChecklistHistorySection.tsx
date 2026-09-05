import { type MonthYear } from "@/components/MonthSelector";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import {
  CHECKLIST_HISTORY_STATUSES,
  checklistRunStatusBadgeVariant,
  checklistRunStatusLabel,
} from "@/lib/checklistOperationalTypes";
import { spCivilRangeBoundsUtc } from "@/lib/checklistSpDay";
import { monthYmdBounds, orderedYmdRange } from "@/lib/monthYmdRange";
import { supabase } from "@/lib/supabase";
import type { CompanyMember } from "@/types/companyMember";
import { FilterX, History, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ChecklistOption = { id: string; title: string };

type HistoryRow = {
  id: string;
  submitted_at: string;
  status: string;
  checklist_id: string;
  company_member_id: string;
  checklists: { title: string } | null;
  company_members: { name: string } | null;
};

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  companyId: string | undefined;
  checklists: ChecklistOption[];
  members: CompanyMember[];
};

export function ChecklistHistorySection({
  companyId,
  checklists,
  members,
}: Props) {
  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [rangeFrom, setRangeFrom] = useState(
    () => monthYmdBounds(now.getMonth() + 1, now.getFullYear()).min,
  );
  const [rangeTo, setRangeTo] = useState(
    () => monthYmdBounds(now.getMonth() + 1, now.getFullYear()).max,
  );
  const [filterChecklist, setFilterChecklist] = useState<string>("all");
  const [filterMember, setFilterMember] = useState<string>("all");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const checklistIds = useMemo(() => checklists.map((c) => c.id), [checklists]);

  const monthBounds = useMemo(
    () => monthYmdBounds(period.month, period.year),
    [period.month, period.year],
  );
  const dateRangeIsCustom =
    rangeFrom !== monthBounds.min || rangeTo !== monthBounds.max;
  const hasListFilters =
    dateRangeIsCustom ||
    filterChecklist !== "all" ||
    filterMember !== "all";

  const applyPeriod = (next: MonthYear) => {
    const bounds = monthYmdBounds(next.month, next.year);
    setPeriod(next);
    setRangeFrom(bounds.min);
    setRangeTo(bounds.max);
  };

  const clearListFilters = () => {
    setRangeFrom(monthBounds.min);
    setRangeTo(monthBounds.max);
    setFilterChecklist("all");
    setFilterMember("all");
  };

  const bounds = useMemo(() => {
    try {
      const { gte, lte } = orderedYmdRange(
        rangeFrom || monthBounds.min,
        rangeTo || monthBounds.max,
      );
      return spCivilRangeBoundsUtc(gte, lte);
    } catch {
      return null;
    }
  }, [rangeFrom, rangeTo, monthBounds]);

  const load = useCallback(async () => {
    if (!companyId || checklistIds.length === 0 || !bounds) {
      setRows([]);
      return;
    }
    setLoading(true);
    let q = supabase
      .from("checklist_runs")
      .select(
        `
        id,
        submitted_at,
        status,
        checklist_id,
        company_member_id,
        checklists ( title ),
        company_members ( name )
      `,
      )
      .in("status", [...CHECKLIST_HISTORY_STATUSES])
      .not("submitted_at", "is", null)
      .gte("submitted_at", bounds.startIso)
      .lte("submitted_at", bounds.endIso)
      .in("checklist_id", checklistIds)
      .order("submitted_at", { ascending: false });

    if (filterChecklist !== "all") {
      q = q.eq("checklist_id", filterChecklist);
    }
    if (filterMember !== "all") {
      q = q.eq("company_member_id", filterMember);
    }

    const { data, error } = await q;
    setLoading(false);
    if (error) {
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as HistoryRow[]);
  }, [companyId, checklistIds, bounds, filterChecklist, filterMember]);

  useEffect(() => {
    void queueMicrotask(() => load());
  }, [load]);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    HistoryRow,
    "submittedAt" | "checklist" | "member" | "status"
  >(
    rows,
    "submittedAt",
    (a, b, key) => {
      if (key === "submittedAt") {
        return a.submitted_at.localeCompare(b.submitted_at);
      }
      if (key === "checklist") {
        return (a.checklists?.title ?? "").localeCompare(
          b.checklists?.title ?? "",
          "pt-BR",
        );
      }
      if (key === "member") {
        return (a.company_members?.name ?? "").localeCompare(
          b.company_members?.name ?? "",
          "pt-BR",
        );
      }
      return checklistRunStatusLabel(a.status).localeCompare(
        checklistRunStatusLabel(b.status),
        "pt-BR",
      );
    },
  );

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Histórico de execuções
        </CardTitle>
        <CardDescription>
          Envios no período (fuso America/Sao_Paulo). Use para conferir se a
          rotina foi feita em um dia específico.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ReferencePeriodCard
            value={period}
            onChange={applyPeriod}
            description="Mês da lista"
            className="rounded-lg p-1.5"
            compact
            monthSelectorClassName="shrink-0 [&_button]:h-8 [&_button]:w-8 [&_span]:min-w-36 [&_span]:text-sm [&_span]:font-semibold"
          />
          <Input
            id="hist-from"
            type="date"
            aria-label="Data de início"
            title="Data de início"
            value={rangeFrom}
            max={rangeTo || undefined}
            onChange={(e) =>
              setRangeFrom(e.target.value || monthBounds.min)
            }
            className="h-8 w-[9.5rem]"
          />
          <Input
            id="hist-to"
            type="date"
            aria-label="Data de fim"
            title="Data de fim"
            value={rangeTo}
            min={rangeFrom || undefined}
            onChange={(e) => setRangeTo(e.target.value || monthBounds.max)}
            className="h-8 w-[9.5rem]"
          />
          <Select value={filterChecklist} onValueChange={setFilterChecklist}>
            <SelectTrigger size="sm" className="w-[12rem]">
              <SelectValue placeholder="Checklist" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os checklists</SelectItem>
              {checklists.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterMember} onValueChange={setFilterMember}>
            <SelectTrigger size="sm" className="w-[12rem]">
              <SelectValue placeholder="Operador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os operadores</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name?.trim() || "Operador"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={!hasListFilters}
            onClick={clearListFilters}
          >
            <FilterX className="mr-1 size-3.5" />
            Limpar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando histórico…
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma execução enviada nesse período
            {filterChecklist !== "all" || filterMember !== "all"
              ? " com os filtros atuais"
              : ""}
            .
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <SortableTableHead
                    label="Data/hora do envio (SP)"
                    column="submittedAt"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Checklist"
                    column="checklist"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Operador"
                    column="member"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Status"
                    column="status"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {formatSubmittedAt(r.submitted_at)}
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      {r.checklists?.title ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.company_members?.name?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={checklistRunStatusBadgeVariant(r.status)}
                      >
                        {checklistRunStatusLabel(r.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {rows.length} envio{rows.length !== 1 ? "s" : ""} no período.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  spAddCalendarDays,
  spCivilDayBoundsUtc,
  spCivilRangeBoundsUtc,
  spTodayYmd,
} from "@/lib/checklistSpDay";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ChecklistOption = { id: string; title: string };

export type HistoryMode = "day" | "last7" | "range";

type HistoryRow = {
  id: string;
  submitted_at: string;
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
  const [mode, setMode] = useState<HistoryMode>("day");
  const [dayYmd, setDayYmd] = useState(() => spTodayYmd());
  const [rangeFrom, setRangeFrom] = useState(() =>
    spAddCalendarDays(spTodayYmd(), -6),
  );
  const [rangeTo, setRangeTo] = useState(() => spTodayYmd());
  const [filterChecklist, setFilterChecklist] = useState<string>("all");
  const [filterMember, setFilterMember] = useState<string>("all");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const checklistIds = useMemo(() => checklists.map((c) => c.id), [checklists]);

  const bounds = useMemo(() => {
    try {
      if (mode === "day") {
        return spCivilDayBoundsUtc(dayYmd);
      }
      if (mode === "last7") {
        const end = spTodayYmd();
        const start = spAddCalendarDays(end, -6);
        return spCivilRangeBoundsUtc(start, end);
      }
      return spCivilRangeBoundsUtc(rangeFrom, rangeTo);
    } catch {
      return null;
    }
  }, [mode, dayYmd, rangeFrom, rangeTo]);

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
        checklist_id,
        company_member_id,
        checklists ( title ),
        company_members ( name )
      `,
      )
      .eq("status", "submitted")
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

  const modeLabel =
    mode === "day"
      ? "Dia"
      : mode === "last7"
        ? "Últimos 7 dias (calendário)"
        : "Intervalo";

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Histórico de execuções
        </CardTitle>
        <CardDescription>
          Consulte envios concluídos por data (fuso America/Sao_Paulo, mesmo
          critério da recorrência). Útil para auditar se o checklist foi feito
          em um dia específico.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["day", "Um dia"],
              ["last7", "Últimos 7 dias"],
              ["range", "Intervalo"],
            ] as const
          ).map(([m, label]) => (
            <Button
              key={m}
              type="button"
              variant={mode === m ? "default" : "outline"}
              size="sm"
              className={cn(mode === m && "shadow-sm")}
              onClick={() => setMode(m)}
            >
              {label}
            </Button>
          ))}
        </div>

        {mode === "day" ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hist-day">Dia</Label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setDayYmd((d) => spAddCalendarDays(d, -1))}
                  aria-label="Dia anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  id="hist-day"
                  type="date"
                  className="w-44"
                  value={dayYmd}
                  onChange={(e) => setDayYmd(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setDayYmd((d) => spAddCalendarDays(d, 1))}
                  aria-label="Próximo dia"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDayYmd(spTodayYmd())}
            >
              Hoje (SP)
            </Button>
          </div>
        ) : null}

        {mode === "range" ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hist-from">De</Label>
              <Input
                id="hist-from"
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hist-to">Até</Label>
              <Input
                id="hist-to"
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {mode === "last7" ? (
          <p className="text-xs text-muted-foreground">
            Do dia{" "}
            <span className="font-medium text-foreground">
              {spAddCalendarDays(spTodayYmd(), -6)}
            </span>{" "}
            a{" "}
            <span className="font-medium text-foreground">{spTodayYmd()}</span>{" "}
            (inclusive), em horário de São Paulo.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Checklist</Label>
            <Select value={filterChecklist} onValueChange={setFilterChecklist}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
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
          </div>
          <div className="space-y-1.5">
            <Label>Operador</Label>
            <Select value={filterMember} onValueChange={setFilterMember}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os membros</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name?.trim() || "Membro"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            {modeLabel}
            {bounds ? (
              <>
                {" · "}
                <span className="font-mono text-[11px] text-foreground/90">
                  {bounds.startIso.slice(0, 16)} → {bounds.endIso.slice(0, 16)}{" "}
                  UTC
                </span>
              </>
            ) : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void load()}
          >
            Atualizar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando histórico…
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma execução concluída nesse período
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
                  <th className="px-3 py-2">Data/hora do envio (SP)</th>
                  <th className="px-3 py-2">Checklist</th>
                  <th className="px-3 py-2">Operador</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {rows.length} envio{rows.length !== 1 ? "s" : ""} · apenas runs
              com status concluído.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

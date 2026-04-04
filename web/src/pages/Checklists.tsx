import { ChecklistHistorySection } from "@/components/checklist/ChecklistHistorySection";
import { ChecklistPerformanceSection } from "@/components/checklist/ChecklistPerformanceSection";
import type {
  ChecklistAssignmentStatRow,
  ChecklistPerformancePeriod,
} from "@/components/checklist/checklistPerformanceTypes";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/contexts/CompanyContext";
import {
  expectedCompletionsRolling,
  formatRecurrenceSummary,
  toggleWeekdayBit,
  type ChecklistRecurrenceMeta,
} from "@/lib/checklistRecurrence";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import {
  History,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ChecklistRow = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  active: boolean;
  recurrence_kind: "daily" | "monthly";
  daily_executions_per_day: number | null;
  weekday_mask: number;
  monthly_executions: number | null;
  created_at: string;
  updated_at: string;
};

type ChecklistItemRow = {
  title: string;
  sort_order: number;
};

function rowToMeta(r: ChecklistRow): ChecklistRecurrenceMeta {
  return {
    recurrence_kind: r.recurrence_kind,
    daily_executions_per_day: r.daily_executions_per_day,
    weekday_mask: r.weekday_mask,
    monthly_executions: r.monthly_executions,
  };
}

function splitItemLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function Checklists() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [stats, setStats] = useState<ChecklistAssignmentStatRow[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [performancePeriod, setPerformancePeriod] =
    useState<ChecklistPerformancePeriod>("both");
  const [checklistsTab, setChecklistsTab] = useState<"overview" | "historico">(
    "overview",
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistRow | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [recurrenceKind, setRecurrenceKind] = useState<"daily" | "monthly">(
    "daily",
  );
  const [dailyExecutionsPerDay, setDailyExecutionsPerDay] = useState("1");
  const [weekdayMask, setWeekdayMask] = useState(127);
  const [monthlyExecutions, setMonthlyExecutions] = useState("1");
  const [itemLines, setItemLines] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("checklists")
      .select("*")
      .eq("company_id", companyId)
      .order("title", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar checklists");
      return;
    }
    setRows((data ?? []) as ChecklistRow[]);
  }, [companyId]);

  const loadMembers = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("company_members")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) return;
    setMembers((data ?? []) as CompanyMember[]);
  }, [companyId]);

  const loadStats = useCallback(async () => {
    if (!companyId) return;
    setLoadingStats(true);
    const endMs = Date.now();
    const nowRef = new Date(endMs);
    const start7ms = endMs - 7 * 86400000;
    const start30ms = endMs - 30 * 86400000;

    const { data: cl, error: e1 } = await supabase
      .from("checklists")
      .select(
        "id, title, recurrence_kind, daily_executions_per_day, weekday_mask, monthly_executions",
      )
      .eq("company_id", companyId);
    if (e1 || !cl?.length) {
      setStats([]);
      setLoadingStats(false);
      return;
    }

    const checklistIds = cl.map((c) => c.id);

    const { data: asg, error: e2 } = await supabase
      .from("checklist_assignments")
      .select("checklist_id, company_member_id, company_members ( id, name )")
      .in("checklist_id", checklistIds);
    if (e2) {
      setLoadingStats(false);
      return;
    }

    const { data: runs, error: e3 } = await supabase
      .from("checklist_runs")
      .select("checklist_id, company_member_id, submitted_at")
      .eq("status", "submitted")
      .in("checklist_id", checklistIds)
      .not("submitted_at", "is", null);

    if (e3) {
      setLoadingStats(false);
      return;
    }

    const runsList = (runs ?? []) as {
      checklist_id: string;
      company_member_id: string;
      submitted_at: string;
    }[];

    const countInRange = (
      cid: string,
      mid: string,
      startMs: number,
    ): number => {
      return runsList.filter(
        (r) =>
          r.checklist_id === cid &&
          r.company_member_id === mid &&
          new Date(r.submitted_at).getTime() >= startMs &&
          new Date(r.submitted_at).getTime() <= endMs,
      ).length;
    };

    const byChecklist = new Map(
      (cl as ChecklistRow[]).map((c) => [c.id, c] as const),
    );
    const out: ChecklistAssignmentStatRow[] = [];

    const metaExpected = (row: ChecklistRow, days: number) =>
      expectedCompletionsRolling(rowToMeta(row), days, nowRef);

    for (const row of asg ?? []) {
      const cid = row.checklist_id as string;
      const mid = row.company_member_id as string;
      const checklist = byChecklist.get(cid);
      const m = row.company_members as { name?: string } | null;
      if (!checklist) continue;
      const expected7 = metaExpected(checklist, 7);
      const expected30 = metaExpected(checklist, 30);
      const actual7 = countInRange(cid, mid, start7ms);
      const actual30 = countInRange(cid, mid, start30ms);
      const rate7 =
        expected7 > 0
          ? Math.min(100, Math.round((actual7 / expected7) * 100))
          : 0;
      const rate30 =
        expected30 > 0
          ? Math.min(100, Math.round((actual30 / expected30) * 100))
          : 0;
      out.push({
        key: `${cid}-${mid}`,
        checklistId: cid,
        checklistTitle: checklist.title,
        memberId: mid,
        memberName: m?.name?.trim() || "Membro",
        recurrenceSummary: formatRecurrenceSummary(rowToMeta(checklist)),
        expected7,
        actual7,
        rate7,
        expected30,
        actual30,
        rate30,
      });
    }

    out.sort((a, b) =>
      a.checklistTitle.localeCompare(b.checklistTitle, "pt-BR"),
    );
    setStats(out);
    setLoadingStats(false);
  }, [companyId]);

  useEffect(() => {
    void load();
    void loadMembers();
  }, [load, loadMembers]);

  useEffect(() => {
    void loadStats();
  }, [loadStats, rows.length]);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setActive(true);
    setRecurrenceKind("daily");
    setDailyExecutionsPerDay("1");
    setWeekdayMask(127);
    setMonthlyExecutions("1");
    setItemLines("");
    setMemberIds(new Set());
    setSheetOpen(true);
  };

  const openEdit = async (r: ChecklistRow) => {
    setEditing(r);
    setTitle(r.title);
    setDescription(r.description ?? "");
    setActive(r.active);
    setRecurrenceKind(r.recurrence_kind);
    setDailyExecutionsPerDay(String(r.daily_executions_per_day ?? 1));
    setWeekdayMask(r.weekday_mask);
    setMonthlyExecutions(String(r.monthly_executions ?? 1));
    const { data: items } = await supabase
      .from("checklist_items")
      .select("title, sort_order")
      .eq("checklist_id", r.id)
      .order("sort_order", { ascending: true });
    const lines = (items ?? [])
      .sort(
        (a: ChecklistItemRow, b: ChecklistItemRow) =>
          a.sort_order - b.sort_order,
      )
      .map((i: ChecklistItemRow) => i.title)
      .join("\n");
    setItemLines(lines);

    const { data: asg } = await supabase
      .from("checklist_assignments")
      .select("company_member_id")
      .eq("checklist_id", r.id);
    setMemberIds(
      new Set((asg ?? []).map((x) => x.company_member_id as string)),
    );
    setSheetOpen(true);
  };

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const save = async () => {
    if (!companyId) return;
    const t = title.trim();
    if (!t) {
      toast.error("Informe o título.");
      return;
    }
    const lines = splitItemLines(itemLines);
    if (lines.length === 0) {
      toast.error("Adicione pelo menos um item (um por linha).");
      return;
    }
    if (recurrenceKind === "daily" && weekdayMask < 1) {
      toast.error("Selecione ao menos um dia da semana.");
      return;
    }

    const recurrencePayload =
      recurrenceKind === "monthly"
        ? {
            recurrence_kind: "monthly" as const,
            monthly_executions: Math.min(
              3,
              Math.max(1, parseInt(monthlyExecutions, 10) || 1),
            ),
            daily_executions_per_day: null as number | null,
            weekday_mask: 127,
          }
        : {
            recurrence_kind: "daily" as const,
            daily_executions_per_day: Math.min(
              24,
              Math.max(1, parseInt(dailyExecutionsPerDay, 10) || 1),
            ),
            weekday_mask: weekdayMask,
            monthly_executions: null as number | null,
          };

    setSaving(true);
    try {
      if (editing) {
        const { error: uerr } = await supabase
          .from("checklists")
          .update({
            title: t,
            description: description.trim() || null,
            active,
            ...recurrencePayload,
          })
          .eq("id", editing.id)
          .eq("company_id", companyId);
        if (uerr) throw uerr;

        await supabase
          .from("checklist_items")
          .delete()
          .eq("checklist_id", editing.id);
        const itemRows = lines.map((line, i) => ({
          checklist_id: editing.id,
          title: line,
          sort_order: i,
        }));
        const { error: ierr } = await supabase
          .from("checklist_items")
          .insert(itemRows);
        if (ierr) throw ierr;

        await supabase
          .from("checklist_assignments")
          .delete()
          .eq("checklist_id", editing.id);
        if (memberIds.size > 0) {
          const { error: aerr } = await supabase
            .from("checklist_assignments")
            .insert(
              [...memberIds].map((mid) => ({
                checklist_id: editing.id,
                company_member_id: mid,
              })),
            );
          if (aerr) throw aerr;
        }
        toast.success("Checklist atualizado.");
      } else {
        const { data: ins, error: ierr } = await supabase
          .from("checklists")
          .insert({
            company_id: companyId,
            title: t,
            description: description.trim() || null,
            active,
            ...recurrencePayload,
          })
          .select("id")
          .single();
        if (ierr || !ins?.id) throw ierr ?? new Error("insert");

        const cid = ins.id as string;
        const itemRows = lines.map((line, i) => ({
          checklist_id: cid,
          title: line,
          sort_order: i,
        }));
        const { error: itErr } = await supabase
          .from("checklist_items")
          .insert(itemRows);
        if (itErr) throw itErr;

        if (memberIds.size > 0) {
          const { error: aerr } = await supabase
            .from("checklist_assignments")
            .insert(
              [...memberIds].map((mid) => ({
                checklist_id: cid,
                company_member_id: mid,
              })),
            );
          if (aerr) throw aerr;
        }
        toast.success("Checklist criado.");
      }
      setSheetOpen(false);
      void load();
      void loadStats();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: ChecklistRow) => {
    if (!companyId) return;
    if (!confirm(`Excluir o checklist "${r.title}"?`)) return;
    const { error } = await supabase.from("checklists").delete().eq("id", r.id);
    if (error) {
      toast.error("Não foi possível excluir.");
      return;
    }
    toast.success("Checklist excluído.");
    void load();
    void loadStats();
  };

  const dailyTimesOptions = useMemo(
    () => Array.from({ length: 24 }, (_, i) => i + 1),
    [],
  );

  const weekdayLabels = [
    "Dom",
    "Seg",
    "Ter",
    "Qua",
    "Qui",
    "Sex",
    "Sáb",
  ] as const;

  return (
    <PageShell>
      <PageHeader
        title="Checklists"
        description="Recorrência diária (dias da semana e quantas execuções em cada um) ou mensal (até 3× por mês). Envie no WhatsApp: 'checklist' e o número para abrir o link para a rotina."
        action={
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Novo checklist
          </Button>
        }
      />

      <div className="flex gap-1 border-b border-border/80">
        <button
          type="button"
          onClick={() => setChecklistsTab("overview")}
          className={cn(
            "inline-flex items-center gap-2 rounded-none border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            checklistsTab === "overview"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          Visão geral
        </button>
        <button
          type="button"
          onClick={() => setChecklistsTab("historico")}
          className={cn(
            "inline-flex items-center gap-2 rounded-none border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            checklistsTab === "historico"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="h-4 w-4 shrink-0" />
          Histórico
        </button>
      </div>

      <div className="space-y-8 pt-6">
        {checklistsTab === "overview" ? (
          <>
            <ChecklistPerformanceSection
              stats={stats}
              loading={loadingStats}
              period={performancePeriod}
              onPeriodChange={setPerformancePeriod}
            />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Checklists</CardTitle>
                <CardDescription>
                  Membros ativos aparecem na atribuição. Apenas números
                  cadastrados em membros recebem o fluxo no WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Carregando…</p>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum checklist ainda.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {rows.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 p-3"
                      >
                        <div>
                          <p className="font-medium">{r.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatRecurrenceSummary(rowToMeta(r))} ·{" "}
                            {r.active ? "ativo" : "inativo"}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void openEdit(r)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void remove(r)}
                            aria-label="Excluir"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <ChecklistHistorySection
            companyId={companyId}
            checklists={rows.map((r) => ({ id: r.id, title: r.title }))}
            members={members}
          />
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar checklist" : "Novo checklist"}
            </SheetTitle>
            <SheetDescription>
              Mensal: no máximo 3 execuções por mês civil; precisa de mais
              frequência semanal → use diária e marque os dias da semana.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 px-4 pb-2">
            <div className="space-y-2">
              <Label htmlFor="cl-title">Título</Label>
              <Input
                id="cl-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Abertura da loja"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cl-desc">Descrição (opcional)</Label>
              <Textarea
                id="cl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/80 px-3 py-2">
              <Switch
                id="cl-active"
                checked={active}
                onCheckedChange={(v) => setActive(v === true)}
              />
              <Label htmlFor="cl-active" className="cursor-pointer">
                Checklist ativo
              </Label>
            </div>
            <div className="space-y-2">
              <Label>Recorrência</Label>
              <Select
                value={recurrenceKind}
                onValueChange={(v) =>
                  setRecurrenceKind(v as "daily" | "monthly")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Diária (dias da semana)</SelectItem>
                  <SelectItem value="monthly">Mensal (até 3×/mês)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {recurrenceKind === "daily" ? (
              <>
                <div className="space-y-2">
                  <Label>Execuções em cada dia selecionado</Label>
                  <Select
                    value={dailyExecutionsPerDay}
                    onValueChange={setDailyExecutionsPerDay}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dailyTimesOptions.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}× por dia (em cada dia marcado)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Dias da semana</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {weekdayLabels.map((lb, i) => {
                      const on = (weekdayMask & (1 << i)) !== 0;
                      return (
                        <button
                          key={lb}
                          type="button"
                          onClick={() =>
                            setWeekdayMask((m) => toggleWeekdayBit(m, i))
                          }
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                            on
                              ? "border-primary bg-primary/15 text-foreground"
                              : "border-border bg-muted/30 text-muted-foreground",
                          )}
                        >
                          {lb}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>Execuções por mês</Label>
                <Select
                  value={monthlyExecutions}
                  onValueChange={setMonthlyExecutions}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1× por mês</SelectItem>
                    <SelectItem value="2">2× por mês</SelectItem>
                    <SelectItem value="3">3× por mês</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Acima de 3× no mês use recorrência diária com os dias da
                  semana desejados.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="cl-items">Itens (um por linha)</Label>
              <Textarea
                id="cl-items"
                value={itemLines}
                onChange={(e) => setItemLines(e.target.value)}
                rows={8}
                placeholder={"Ligar equipamentos\nConferir caixa\n..."}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Membros atribuídos</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2">
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Cadastre membros em Configurações.
                  </p>
                ) : (
                  members.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-input"
                        checked={memberIds.has(m.id)}
                        onChange={() => toggleMember(m.id)}
                      />
                      {m.name}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <SheetFooter className="gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

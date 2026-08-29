import { ChecklistCatalogList } from "@/components/checklist/ChecklistCatalogList";
import { ChecklistConferenceSection } from "@/components/checklist/ChecklistConferenceSection";
import { ChecklistHistorySection } from "@/components/checklist/ChecklistHistorySection";
import { ChecklistNotificationSettingsCard } from "@/components/checklist/ChecklistNotificationSettingsCard";
import { ChecklistOverviewDashboard } from "@/components/checklist/ChecklistOverviewDashboard";
import { ChecklistRankingSection } from "@/components/checklist/ChecklistRankingSection";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
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
  toggleWeekdayBit,
  type ChecklistRecurrenceMeta,
} from "@/lib/checklistRecurrence";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import {
  ClipboardCheck,
  History,
  LayoutGrid,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  Trophy,
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
  const [overviewTick, setOverviewTick] = useState(0);
  const [checklistsTab, setChecklistsTab] = useState<
    "overview" | "historico" | "conferencia" | "ranking"
  >("overview");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHint, setAiHint] = useState("");
  const [showPreview, setShowPreview] = useState(false);

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
  const [assignedByChecklist, setAssignedByChecklist] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  const [conferencePending, setConferencePending] = useState(0);

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

  const loadAssignments = useCallback(async () => {
    if (!companyId) {
      setAssignedByChecklist({});
      return;
    }
    const { data } = await supabase
      .from("checklist_assignments")
      .select("checklist_id, company_members ( id, name, is_active )")
      .eq("company_id", companyId);
    const map: Record<string, { id: string; name: string }[]> = {};
    for (const row of data ?? []) {
      const m = row.company_members as
        | { id?: string; name?: string; is_active?: boolean }
        | null;
      if (!m?.id || m.is_active === false) continue;
      const cid = row.checklist_id as string;
      (map[cid] ??= []).push({
        id: m.id,
        name: m.name?.trim() || "Operador",
      });
    }
    setAssignedByChecklist(map);
  }, [companyId]);

  const loadConferencePending = useCallback(async () => {
    if (!companyId) {
      setConferencePending(0);
      return;
    }
    const { count, error } = await supabase
      .from("checklist_runs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["submitted", "in_review"]);
    if (!error) setConferencePending(count ?? 0);
  }, [companyId]);

  const handleConferencePending = useCallback((n: number) => {
    setConferencePending(n);
  }, []);

  useEffect(() => {
    void load();
    void loadMembers();
    void loadAssignments();
    void loadConferencePending();
  }, [load, loadMembers, loadAssignments, loadConferencePending]);

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
    setAiPrompt("");
    setAiHint("");
    setShowPreview(false);
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

  const generateAiDraft = async () => {
    const p = aiPrompt.trim();
    if (!p) {
      toast.error("Descreva o checklist (ex.: abertura do bar).");
      return;
    }
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-checklist-draft",
        { body: { prompt: p } },
      );
      if (error) throw error;
      const row = data as {
        ok?: boolean;
        title?: string;
        description?: string;
        items?: { title: string }[];
        next_suggestion?: string;
      };
      if (!row?.ok) throw new Error("fail");
      if (row.title) setTitle(row.title);
      if (row.description) setDescription(row.description);
      if (row.items?.length) {
        setItemLines(row.items.map((i) => i.title).join("\n"));
      }
      setAiHint(row.next_suggestion ?? "");
      setShowPreview(true);
      toast.success("Rascunho montado pelo Faro.");
    } catch {
      toast.error("Não foi possível gerar com IA.");
    } finally {
      setAiBusy(false);
    }
  };

  const applyTemplate = async (slug: string) => {
    const { data, error } = await supabase
      .from("checklist_templates")
      .select("title, description, items")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) {
      toast.error(
        error?.message
          ? `Template indisponível: ${error.message}`
          : "Template indisponível.",
      );
      return;
    }
    setTitle((data.title as string) ?? "");
    setDescription((data.description as string) ?? "");
    const rawItems = data.items;
    const items = Array.isArray(rawItems)
      ? (rawItems as { title?: string }[])
      : [];
    setItemLines(items.map((i) => i.title ?? "").filter(Boolean).join("\n"));
    setShowPreview(true);
    toast.success("Template aplicado — revise e salve.");
  };

  const startRunForMember = async (checklistId: string, memberId: string) => {
    const { data, error } = await supabase.rpc(
      "create_checklist_run_for_member",
      {
        p_checklist_id: checklistId,
        p_company_member_id: memberId,
      },
    );
    let row = data as { ok?: boolean; error?: string; slug?: string; token?: string } | string | null;
    if (typeof row === "string") {
      try {
        row = JSON.parse(row) as typeof row;
      } catch {
        row = null;
      }
    }
    const payload = row && typeof row === "object" ? row : null;
    if (error || !payload?.ok) {
      const detail = error?.message || payload?.error;
      toast.error(detail ? `Falha ao gerar link: ${detail}` : "Falha ao gerar link.");
      return;
    }
    const base = window.location.origin.replace(/\/$/, "");
    const url = payload.slug
      ? `${base}/k/${payload.slug}`
      : `${base}/checklist/${payload.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      toast.message(url);
    }
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
          company_id: companyId,
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
                company_id: companyId,
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
          company_id: companyId,
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
                company_id: companyId,
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
      setOverviewTick((n) => n + 1);
      void loadAssignments();
      void loadConferencePending();
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
    setOverviewTick((n) => n + 1);
    void loadAssignments();
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
        description="Rotinas da equipe: quem faz, quando, e conferência dos envios."
        icon={ListChecks}
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
        <button
          type="button"
          onClick={() => setChecklistsTab("conferencia")}
          className={cn(
            "inline-flex items-center gap-2 rounded-none border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            checklistsTab === "conferencia"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <ClipboardCheck className="h-4 w-4 shrink-0" />
          Conferência
          {conferencePending > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {conferencePending}
            </Badge>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setChecklistsTab("ranking")}
          className={cn(
            "inline-flex items-center gap-2 rounded-none border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            checklistsTab === "ranking"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Trophy className="h-4 w-4 shrink-0" />
          Ranking
        </button>
      </div>

      <div className="space-y-8 pt-6">
        {checklistsTab === "overview" ? (
          <>
            {companyId ? (
              <ChecklistOverviewDashboard
                companyId={companyId}
                reloadNonce={overviewTick}
              />
            ) : null}

            {companyId ? (
              <ChecklistNotificationSettingsCard companyId={companyId} />
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rotinas cadastradas</CardTitle>
                <CardDescription>
                  Quem faz cada checklist e em quais dias. Só operadores
                  ativos entram na atribuição e no WhatsApp.
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
                  <ChecklistCatalogList
                    checklists={rows.map((r) => ({
                      id: r.id,
                      title: r.title,
                      active: r.active,
                      recurrence: rowToMeta(r),
                    }))}
                    assignedByChecklist={assignedByChecklist}
                    onGenerate={(checklistId, memberId) =>
                      void startRunForMember(checklistId, memberId)
                    }
                    onEdit={(id) => {
                      const r = rows.find((x) => x.id === id);
                      if (r) void openEdit(r);
                    }}
                    onRemove={(id) => {
                      const r = rows.find((x) => x.id === id);
                      if (r) void remove(r);
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </>
        ) : checklistsTab === "historico" ? (
          <ChecklistHistorySection
            companyId={companyId}
            checklists={rows.map((r) => ({ id: r.id, title: r.title }))}
            members={members}
          />
        ) : checklistsTab === "conferencia" && companyId ? (
          <ChecklistConferenceSection
            companyId={companyId}
            onPendingCount={handleConferencePending}
          />
        ) : checklistsTab === "ranking" && companyId ? (
          <ChecklistRankingSection
            companyId={companyId}
            reloadNonce={overviewTick}
          />
        ) : null}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto">
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
            {!editing ? (
              <div className="space-y-2 rounded-xl border border-dashed p-3">
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-orange-500" />
                  Criar com o Faro (IA)
                </Label>
                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder='Ex.: "Monta um checklist de abertura do bar"'
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={aiBusy}
                    onClick={() => void generateAiDraft()}
                  >
                    {aiBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Enviar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void applyTemplate("abertura-bar")}
                  >
                    Template abertura
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void applyTemplate("fechamento-bar")}
                  >
                    Template fechamento
                  </Button>
                </div>
                {aiHint ? (
                  <p className="text-xs text-muted-foreground">{aiHint}</p>
                ) : null}
                <div className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={showPreview}
                    onCheckedChange={setShowPreview}
                    id="cl-preview"
                  />
                  <Label htmlFor="cl-preview">Prévia PWA</Label>
                </div>
                {showPreview && itemLines.trim() ? (
                  <div className="rounded-2xl border bg-muted/30 p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Como o funcionário vê
                    </p>
                    <p className="mt-1 font-bold">{title || "Sem título"}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm">
                      {splitItemLines(itemLines)
                        .slice(0, 8)
                        .map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ) : null}
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
              <Label>Operadores atribuídos</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2">
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Cadastre operadores em Configurações → Usuários e acessos.
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

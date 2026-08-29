import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Textarea } from "@/components/ui/textarea";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  checklistItemTypeLabel,
  checklistRunStatusBadgeVariant,
  checklistRunStatusLabel,
  type ChecklistRunStatus,
} from "@/lib/checklistOperationalTypes";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { CheckCheck, Copy, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ShortLinkEmbed = { slug: string } | { slug: string }[] | null;

type RunRow = {
  id: string;
  status: ChecklistRunStatus | string;
  submitted_at: string | null;
  review_notes: string | null;
  checklists: { title: string } | null;
  company_members: { name: string } | null;
  checklist_run_short_links?: ShortLinkEmbed;
};

type ItemRow = {
  checklist_item_id: string;
  completed_at: string | null;
  value: Record<string, unknown> | null;
  evidence_paths: string[];
  is_ok: boolean | null;
  review_flag: string | null;
  checklist_items: { title: string; item_type: string } | null;
};

type QueueSortKey = "submittedAt" | "checklist" | "member" | "status";

function formatSubmittedAt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugFromRun(row: RunRow): string | null {
  const embed = row.checklist_run_short_links;
  if (!embed) return null;
  if (Array.isArray(embed)) return embed[0]?.slug ?? null;
  return embed.slug ?? null;
}

function publicRunUrl(slug: string): string {
  const base = window.location.origin.replace(/\/$/, "");
  return `${base}/k/${slug}`;
}

async function copyRunLink(slug: string): Promise<boolean> {
  const url = publicRunUrl(slug);
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
    return true;
  } catch {
    toast.message(url);
    return false;
  }
}

function CopyRunLinkButton({
  slug,
}: {
  slug: string | null;
}) {
  if (!slug) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={(e) => {
        e.stopPropagation();
        void copyRunLink(slug);
      }}
    >
      <Copy className="mr-1.5 h-3.5 w-3.5" />
      Copiar link
    </Button>
  );
}

function formatItemValue(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  if (typeof value.number === "number" && Number.isFinite(value.number)) {
    return String(value.number);
  }
  if (typeof value.text === "string" && value.text.trim()) {
    return value.text.trim();
  }
  if (value.signed === true) return "Assinado";
  return null;
}

function compareRuns(a: RunRow, b: RunRow, key: QueueSortKey): number {
  if (key === "submittedAt") {
    return (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "");
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
  return checklistRunStatusLabel(String(a.status)).localeCompare(
    checklistRunStatusLabel(String(b.status)),
    "pt-BR",
  );
}

function ChecklistEvidenceThumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const path of paths) {
        const trimmed = path.trim();
        if (!trimmed) continue;
        const { data, error } = await supabase.storage
          .from("checklist-evidence")
          .createSignedUrl(trimmed, 3600);
        if (!cancelled && !error && data?.signedUrl) {
          next[trimmed] = data.signedUrl;
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [paths]);

  if (paths.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {paths.map((path) => {
        const url = urls[path.trim()];
        const isImage = /\.(jpe?g|png|webp|gif|heic)$/i.test(path);
        if (!url) {
          return (
            <span
              key={path}
              className="text-xs text-muted-foreground"
            >
              Evidência…
            </span>
          );
        }
        if (isImage) {
          return (
            <a
              key={path}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              <img
                src={url}
                alt=""
                className="h-16 w-16 rounded-md border object-cover bg-muted"
              />
            </a>
          );
        }
        return (
          <a
            key={path}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Abrir evidência
          </a>
        );
      })}
    </div>
  );
}

function QueueList({
  rows,
  emptyLabel,
  onOpen,
  emphasized,
  showLink,
}: {
  rows: RunRow[];
  emptyLabel: string;
  onOpen: (id: string) => void;
  emphasized?: boolean;
  showLink?: boolean;
}) {
  const view = useSheetListView();
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    RunRow,
    QueueSortKey
  >(rows, "submittedAt", compareRuns);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  if (view === "cards") {
    return (
      <ul className="space-y-2">
        {sorted.map((r) => (
          <li
            key={r.id}
            className={cn(
              "rounded-xl border text-sm",
              emphasized && "border-primary/40 bg-primary/5",
            )}
          >
            <button
              type="button"
              className="w-full px-3 py-3 text-left transition-colors hover:bg-muted/40"
              onClick={() => onOpen(r.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-snug">
                  {r.checklists?.title ?? "Checklist"}
                </p>
                <Badge variant={checklistRunStatusBadgeVariant(String(r.status))}>
                  {checklistRunStatusLabel(String(r.status))}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.company_members?.name ?? "—"} · {formatSubmittedAt(r.submitted_at)}
              </p>
            </button>
            {showLink ? (
              <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {slugFromRun(r) ? `/k/${slugFromRun(r)}` : "Sem link"}
                </span>
                <CopyRunLinkButton slug={slugFromRun(r)} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <SortableTableHead
              label="Envio (SP)"
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
            <th className="px-3 py-2.5 font-medium">Ação</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              className={cn(
                "border-b border-border/60 last:border-0",
                emphasized && "bg-primary/5",
              )}
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
                <Badge variant={checklistRunStatusBadgeVariant(String(r.status))}>
                  {checklistRunStatusLabel(String(r.status))}
                </Badge>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {showLink ? <CopyRunLinkButton slug={slugFromRun(r)} /> : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpen(r.id)}
                  >
                    Conferir
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChecklistConferenceSection({
  companyId,
  onPendingCount,
}: {
  companyId: string;
  onPendingCount?: (n: number) => void;
}) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);

  const awaiting = useMemo(
    () =>
      rows.filter(
        (r) => r.status === "submitted" || r.status === "in_review",
      ),
    [rows],
  );
  const returned = useMemo(
    () => rows.filter((r) => r.status === "needs_rework"),
    [rows],
  );

  const activeRow = rows.find((r) => r.id === active) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("checklist_runs")
      .select(
        `
        id, status, submitted_at, review_notes,
        checklists ( title ),
        company_members ( name ),
        checklist_run_short_links ( slug )
      `,
      )
      .eq("company_id", companyId)
      .in("status", ["submitted", "in_review", "needs_rework"])
      .order("submitted_at", { ascending: false })
      .limit(80);
    setLoading(false);
    if (error) {
      toast.error(
        error.message
          ? `Não foi possível carregar a conferência: ${error.message}`
          : "Não foi possível carregar a conferência.",
      );
      setRows([]);
      onPendingCount?.(0);
      return;
    }
    const next = (data ?? []) as unknown as RunRow[];
    setRows(next);
    onPendingCount?.(
      next.filter((r) => r.status === "submitted" || r.status === "in_review")
        .length,
    );
  }, [companyId, onPendingCount]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const open = async (id: string) => {
    const row = rows.find((r) => r.id === id);
    setActive(id);
    setNotes(row?.review_notes ?? "");
    setItemsLoading(true);
    const { data, error } = await supabase
      .from("checklist_run_items")
      .select(
        `
        checklist_item_id, completed_at, value, evidence_paths, is_ok, review_flag,
        checklist_items ( title, item_type )
      `,
      )
      .eq("run_id", id);
    setItemsLoading(false);
    if (error) {
      toast.error("Não foi possível carregar os itens.");
      setItems([]);
      return;
    }
    setItems((data ?? []) as unknown as ItemRow[]);
  };

  const decide = async (status: "approved" | "needs_rework") => {
    if (!active) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("review_checklist_run", {
      p_run_id: active,
      p_status: status,
      p_notes: notes || null,
    });
    setBusy(false);
    let row = data as
      | { ok?: boolean; error?: string; slug?: string }
      | string
      | null;
    if (typeof row === "string") {
      try {
        row = JSON.parse(row) as { ok?: boolean; error?: string; slug?: string };
      } catch {
        row = null;
      }
    }
    const payload = row && typeof row === "object" ? row : null;
    if (error || !payload?.ok) {
      toast.error("Falha ao salvar conferência.");
      return;
    }
    if (status === "approved") {
      toast.success("Checklist aprovado.");
    } else {
      const slug = payload.slug;
      if (slug) {
        try {
          await navigator.clipboard.writeText(publicRunUrl(slug));
          toast.success("Devolvido para refazer. Link copiado.");
        } catch {
          toast.success("Devolvido para refazer.");
          toast.message(publicRunUrl(slug));
        }
      } else {
        toast.success("Devolvido para refazer.");
      }
      void supabase.functions
        .invoke("notify-checklist-rework", { body: { run_id: active } })
        .then(({ data: n, error: nErr }) => {
          const body = n as { ok?: boolean; skipped?: boolean; error?: string } | null;
          if (nErr || (body && body.ok === false && !body.skipped)) {
            toast.message("Não foi possível avisar no WhatsApp. Use o link copiado.");
          }
        });
    }
    setActive(null);
    await load();
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">
            Aguardando conferência
            {awaiting.length > 0 ? (
              <Badge variant="secondary" className="ml-2 tabular-nums">
                {awaiting.length}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Envios novos para validar. Aprovados saem daqui e vão para o
            histórico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <QueueList
              rows={awaiting}
              emptyLabel="Nenhuma execução aguardando conferência."
              onOpen={(id) => void open(id)}
              emphasized
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Devolvidos para refazer
            {returned.length > 0 ? (
              <Badge variant="destructive" className="ml-2 tabular-nums">
                {returned.length}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            O operador precisa refazer e enviar de novo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? null : (
            <QueueList
              rows={returned}
              emptyLabel="Nenhum checklist devolvido no momento."
              onOpen={(id) => void open(id)}
              showLink
            />
          )}
        </CardContent>
      </Card>

      <Sheet
        open={active != null}
        onOpenChange={(openSheet) => {
          if (!openSheet) setActive(null);
        }}
      >
        <SheetContent className="flex w-full flex-col overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {activeRow?.checklists?.title ?? "Conferência"}
            </SheetTitle>
            <SheetDescription>
              {activeRow?.company_members?.name ?? "Operador"}
              {activeRow?.submitted_at
                ? ` · ${formatSubmittedAt(activeRow.submitted_at)}`
                : ""}
            </SheetDescription>
            {activeRow ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={checklistRunStatusBadgeVariant(
                    String(activeRow.status),
                  )}
                >
                  {checklistRunStatusLabel(String(activeRow.status))}
                </Badge>
                {activeRow.status === "needs_rework" ? (
                  <CopyRunLinkButton slug={slugFromRun(activeRow)} />
                ) : null}
              </div>
            ) : null}
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 px-4 pb-2">
            {activeRow?.status === "needs_rework" ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                Devolvido para refazer. O operador usa o mesmo link.
              </p>
            ) : null}
            {itemsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens…
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => {
                  const valueText = formatItemValue(it.value);
                  const flagged =
                    it.is_ok === false || Boolean(it.review_flag);
                  return (
                    <li
                      key={it.checklist_item_id}
                      className={cn(
                        "rounded-lg border p-3 text-sm",
                        flagged && "border-amber-500/50 bg-amber-500/5",
                      )}
                    >
                      <p className="font-medium">
                        {it.checklist_items?.title ?? it.checklist_item_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {checklistItemTypeLabel(
                          it.checklist_items?.item_type ?? "check",
                        )}{" "}
                        · {it.completed_at ? "feito" : "pendente"}
                        {valueText ? ` · ${valueText}` : ""}
                      </p>
                      <ChecklistEvidenceThumbs
                        paths={it.evidence_paths ?? []}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <Textarea
              placeholder="Notas da conferência…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <SheetFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActive(null)}
            >
              Fechar
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void decide("needs_rework")}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Pedir refazer
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void decide("approved")}
              >
                <CheckCheck className="mr-2 h-4 w-4" />
                Aprovar
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

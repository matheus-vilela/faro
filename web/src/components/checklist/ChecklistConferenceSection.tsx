import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type RunRow = {
  id: string;
  status: string;
  submitted_at: string | null;
  review_notes: string | null;
  checklists: { title: string } | null;
  company_members: { name: string } | null;
};

type ItemRow = {
  checklist_item_id: string;
  completed_at: string | null;
  value: Record<string, unknown>;
  evidence_paths: string[];
  is_ok: boolean | null;
  review_flag: string | null;
  checklist_items: { title: string; item_type: string } | null;
};

export function ChecklistConferenceSection({
  companyId,
}: {
  companyId: string;
}) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("checklist_runs")
      .select(
        `
        id, status, submitted_at, review_notes,
        checklists ( title ),
        company_members ( name )
      `,
      )
      .eq("company_id", companyId)
      .in("status", ["submitted", "in_review", "needs_rework"])
      .order("submitted_at", { ascending: false })
      .limit(40);
    setLoading(false);
    if (error) {
      console.error(error);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as RunRow[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const open = async (id: string) => {
    setActive(id);
    setNotes("");
    const { data } = await supabase
      .from("checklist_run_items")
      .select(
        `
        checklist_item_id, completed_at, value, evidence_paths, is_ok, review_flag,
        checklist_items ( title, item_type )
      `,
      )
      .eq("run_id", id);
    setItems((data ?? []) as unknown as ItemRow[]);
    await supabase.rpc("review_checklist_run", {
      p_run_id: id,
      p_status: "in_review",
      p_notes: null,
    });
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
    if (error || !(data as { ok?: boolean })?.ok) {
      toast.error("Falha ao salvar conferência.");
      return;
    }
    toast.success(
      status === "approved" ? "Checklist aprovado." : "Devolvido para refazer.",
    );
    setActive(null);
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conferência</CardTitle>
        <CardDescription>
          Fila de execuções enviadas — valide evidências e feche a conformidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Fila vazia.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => void open(r.id)}
                >
                  <span>
                    {r.checklists?.title ?? "Checklist"} ·{" "}
                    {r.company_members?.name ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">{r.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {active && (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-semibold">Itens</p>
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {items.map((it) => (
                <li key={it.checklist_item_id} className="rounded-lg border p-2 text-sm">
                  <p className="font-medium">
                    {it.checklist_items?.title ?? it.checklist_item_id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {it.checklist_items?.item_type ?? "check"} ·{" "}
                    {it.completed_at ? "feito" : "pendente"}
                    {it.evidence_paths?.length
                      ? ` · ${it.evidence_paths.length} evidência(s)`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
            <Textarea
              placeholder="Notas da conferência…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

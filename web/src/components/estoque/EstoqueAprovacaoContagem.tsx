import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabase";
import { CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type PendingSession = {
  id: string;
  submitted_at: string | null;
  inventory_count_groups: { name: string } | null;
  assigned_member: { name: string } | null;
};

type LineRow = {
  id: string;
  product_id: string;
  expected_qty: number;
  counted_qty: number | null;
  in_band: boolean | null;
  tolerance_pct: number;
  products: { name: string; unit: string } | null;
};

export function EstoqueAprovacaoContagem({
  companyId,
  refreshTrigger = 0,
  onChanged,
}: {
  companyId: string;
  refreshTrigger?: number;
  onChanged?: () => void;
}) {
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_count_sessions")
      .select(
        `
        id,
        submitted_at,
        inventory_count_groups ( name ),
        assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey ( name )
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "pending_approval")
      .order("submitted_at", { ascending: false })
      .limit(40);
    setLoading(false);
    if (error) {
      console.error(error);
      setSessions([]);
      return;
    }
    setSessions((data ?? []) as unknown as PendingSession[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, refreshTrigger]);

  const openSession = async (id: string) => {
    setActiveId(id);
    setSelected(new Set());
    const { data, error } = await supabase
      .from("inventory_count_lines")
      .select(
        `
        id,
        product_id,
        expected_qty,
        counted_qty,
        in_band,
        tolerance_pct,
        products ( name, unit )
      `,
      )
      .eq("session_id", id)
      .order("sort_order", { ascending: true });
    if (error) {
      toast.error("Não foi possível carregar as linhas.");
      setLines([]);
      return;
    }
    setLines((data ?? []) as unknown as LineRow[]);
  };

  const toggle = (productId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const commit = async () => {
    if (!activeId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc(
      "commit_inventory_count_session",
      { p_session_id: activeId },
    );
    setBusy(false);
    if (error || !(data as { ok?: boolean })?.ok) {
      toast.error("Falha ao aprovar/ajustar estoque.");
      return;
    }
    toast.success("Contagem aprovada e estoque atualizado.");
    setActiveId(null);
    setLines([]);
    await load();
    onChanged?.();
  };

  const returnSelected = async () => {
    if (!activeId || selected.size === 0) {
      toast.message("Selecione itens para devolver.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("return_inventory_count_lines", {
      p_session_id: activeId,
      p_product_ids: [...selected],
    });
    setBusy(false);
    const row = data as { ok?: boolean; slug?: string; token?: string };
    if (error || !row?.ok) {
      toast.error("Falha ao devolver itens.");
      return;
    }
    const base = window.location.origin.replace(/\/$/, "");
    const link = row.slug
      ? `${base}/i/${row.slug}`
      : `${base}/contagem-estoque/${row.token}`;
    toast.success("Itens devolvidos para recontagem.");
    try {
      await navigator.clipboard.writeText(link);
      toast.message("Link de recontagem copiado.");
    } catch {
      /* ignore */
    }
    setActiveId(null);
    setLines([]);
    await load();
    onChanged?.();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aprovação de contagens</CardTitle>
        <CardDescription>
          Conferência com esperado × contado. O estoque só muda após aprovar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma contagem aguardando aprovação.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => void openSession(s.id)}
                >
                  <span>
                    {s.inventory_count_groups?.name ?? "Contagem"}
                    {s.assigned_member?.name
                      ? ` · ${s.assigned_member.name}`
                      : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.submitted_at
                      ? new Date(s.submitted_at).toLocaleString("pt-BR")
                      : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {activeId && lines.length > 0 ? (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-sm font-semibold">Divergências / linhas</p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {lines.map((l) => {
                const out = l.in_band === false;
                return (
                  <label
                    key={l.id}
                    className={`flex items-start gap-3 rounded-lg border p-2 text-sm ${
                      out ? "border-amber-500/40 bg-amber-500/5" : ""
                    }`}
                  >
                    <Checkbox
                      checked={selected.has(l.product_id)}
                      onCheckedChange={() => toggle(l.product_id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {l.products?.name ?? l.product_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Esperado: {Number(l.expected_qty).toLocaleString("pt-BR")}{" "}
                        · Contado:{" "}
                        {l.counted_qty != null
                          ? Number(l.counted_qty).toLocaleString("pt-BR")
                          : "—"}{" "}
                        {l.products?.unit ?? ""} · tol. ±{l.tolerance_pct}%
                        {out ? " · fora da faixa" : ""}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || selected.size === 0}
                onClick={() => void returnSelected()}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Devolver selecionados
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void commit()}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCheck className="mr-2 h-4 w-4" />
                )}
                Aprovar e ajustar estoque
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

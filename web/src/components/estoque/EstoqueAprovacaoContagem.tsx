import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  COUNT_FILTER_INPUT_CLASS,
  COUNT_ROW_ACTION_CLASS,
  COUNT_SELECT_TRIGGER_CLASS,
  countClickableRowClass,
} from "@/lib/inventoryCount/ui";
import { supabase } from "@/lib/supabase";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { cn } from "@/lib/utils";
import { CheckCheck, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type PendingSession = {
  id: string;
  submitted_at: string | null;
  kind?: string | null;
  inventory_count_group_id: string | null;
  inventory_count_listing_id: string | null;
  assigned_company_member_id: string | null;
  inventory_count_groups: { name: string } | null;
  inventory_count_listings: { name: string } | null;
  assigned_member: { name: string } | null;
};

type LineRow = {
  id: string;
  product_id: string;
  expected_qty: number;
  counted_qty: number | null;
  counted_unit_code: string | null;
  counted_qty_input: number | null;
  in_band: boolean | null;
  tolerance_pct: number;
  products: { name: string; unit: string } | null;
};

type LineSortKey = "name" | "expected" | "counted" | "variation";

function variationPct(expected: number, counted: number | null): number | null {
  if (counted == null) return null;
  if (expected === 0) return counted === 0 ? 0 : 100;
  return ((counted - expected) / Math.abs(expected)) * 100;
}

function formatQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

export function EstoqueAprovacaoContagem({
  companyId,
  refreshTrigger = 0,
  onChanged,
  highlightOnboarding = false,
}: {
  companyId: string;
  refreshTrigger?: number;
  onChanged?: () => void;
  highlightOnboarding?: boolean;
}) {
  const listView = useSheetListView();
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [filterGroup, setFilterGroup] = useState("");
  const [filterListing, setFilterListing] = useState("");
  const [filterOperator, setFilterOperator] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [onlyDivergent, setOnlyDivergent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_count_sessions")
      .select(
        `
        id,
        submitted_at,
        kind,
        inventory_count_group_id,
        inventory_count_listing_id,
        assigned_company_member_id,
        inventory_count_groups ( name ),
        inventory_count_listings ( name ),
        assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey ( name )
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "pending_approval")
      .order("submitted_at", { ascending: false })
      .limit(80);
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

  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.inventory_count_group_id) {
        map.set(
          s.inventory_count_group_id,
          s.inventory_count_groups?.name ?? "Grupo",
        );
      }
    }
    return [...map.entries()];
  }, [sessions]);

  const listingOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (filterGroup && s.inventory_count_group_id !== filterGroup) continue;
      if (s.inventory_count_listing_id) {
        map.set(
          s.inventory_count_listing_id,
          s.inventory_count_listings?.name ?? "Listagem",
        );
      }
    }
    return [...map.entries()];
  }, [filterGroup, sessions]);

  const operatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.assigned_company_member_id && s.assigned_member?.name) {
        map.set(s.assigned_company_member_id, s.assigned_member.name);
      }
    }
    return [...map.entries()];
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filterGroup && s.inventory_count_group_id !== filterGroup) return false;
      if (filterListing && s.inventory_count_listing_id !== filterListing) {
        return false;
      }
      if (filterOperator && s.assigned_company_member_id !== filterOperator) {
        return false;
      }
      if (periodFrom) {
        const t = s.submitted_at ? new Date(s.submitted_at).getTime() : 0;
        if (t < new Date(`${periodFrom}T00:00:00`).getTime()) return false;
      }
      if (periodTo) {
        const t = s.submitted_at ? new Date(s.submitted_at).getTime() : 0;
        if (t > new Date(`${periodTo}T23:59:59`).getTime()) return false;
      }
      return true;
    });
  }, [filterGroup, filterListing, filterOperator, periodFrom, periodTo, sessions]);

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
        counted_unit_code,
        counted_qty_input,
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

  const visibleLines = useMemo(() => {
    if (!onlyDivergent) return lines;
    return lines.filter((l) => l.in_band === false);
  }, [lines, onlyDivergent]);

  const compareLines = useCallback(
    (a: LineRow, b: LineRow, key: LineSortKey) => {
      if (key === "name") {
        return (a.products?.name ?? "").localeCompare(
          b.products?.name ?? "",
          "pt-BR",
        );
      }
      if (key === "expected") return a.expected_qty - b.expected_qty;
      if (key === "counted") {
        return (a.counted_qty ?? -1) - (b.counted_qty ?? -1);
      }
      if (key === "variation") {
        return (
          (variationPct(a.expected_qty, a.counted_qty) ?? 0) -
          (variationPct(b.expected_qty, b.counted_qty) ?? 0)
        );
      }
      return 0;
    },
    [],
  );

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    LineRow,
    LineSortKey
  >(visibleLines, "name", compareLines, true);

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

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label>Grupo</Label>
          <Select
            value={filterGroup || "__all__"}
            onValueChange={(v) => {
              setFilterGroup(v === "__all__" ? "" : v);
              setFilterListing("");
            }}
          >
            <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {groupOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Listagem</Label>
          <Select
            value={filterListing || "__all__"}
            onValueChange={(v) => setFilterListing(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas</SelectItem>
              {listingOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Operador</Label>
          <Select
            value={filterOperator || "__all__"}
            onValueChange={(v) => setFilterOperator(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {operatorOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>De</Label>
          <Input
            type="date"
            className={COUNT_FILTER_INPUT_CLASS}
            value={periodFrom}
            onChange={(e) => setPeriodFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Até</Label>
          <Input
            type="date"
            className={COUNT_FILTER_INPUT_CLASS}
            value={periodTo}
            onChange={(e) => setPeriodTo(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : filteredSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma contagem aguardando aprovação.
        </p>
      ) : (
        <ul className="space-y-2">
          {filteredSessions.map((s) => {
            const onboarding = s.kind === "onboarding";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={cn(
                    countClickableRowClass(activeId === s.id),
                    highlightOnboarding &&
                      onboarding &&
                      "border-amber-500 bg-amber-500/15 hover:bg-amber-500/20",
                  )}
                  onClick={() => void openSession(s.id)}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">
                      {onboarding
                        ? "Contagem geral (onboarding)"
                        : (s.inventory_count_groups?.name ?? "Contagem")}
                      {s.inventory_count_listings?.name
                        ? ` · ${s.inventory_count_listings.name}`
                        : ""}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {s.assigned_member?.name
                        ? `Operador: ${s.assigned_member.name}`
                        : "Sem operador"}
                      {" · "}
                      {s.submitted_at
                        ? new Date(s.submitted_at).toLocaleString("pt-BR")
                        : "—"}
                    </span>
                  </span>
                  <span className={COUNT_ROW_ACTION_CLASS}>
                    Conferir
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {activeId && lines.length > 0 ? (
        <div className="space-y-3 rounded-xl border-2 border-primary/25 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              Esperado × contado
              {activeSession?.kind === "onboarding"
                ? " · onboarding (obrigatória para o estoque atualizar)"
                : ""}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={onlyDivergent}
                onCheckedChange={() => setOnlyDivergent((v) => !v)}
              />
              Só divergentes
            </label>
          </div>

          {listView === "cards" ? (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {sorted.map((l) => {
                const out = l.in_band === false;
                const pct = variationPct(l.expected_qty, l.counted_qty);
                const hub = l.products?.unit ?? "";
                return (
                  <label
                    key={l.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-2 text-sm",
                      out && "border-amber-500/40 bg-amber-500/5",
                    )}
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
                        Esperado: {formatQty(l.expected_qty)} {hub} · Contado:{" "}
                        {formatQty(l.counted_qty)} {hub}
                        {pct != null
                          ? ` · ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
                          : ""}
                        {out ? " · fora da faixa" : ""}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="p-2 w-8" />
                    <SortableTableHead
                      label="Produto"
                      column="name"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                    />
                    <SortableTableHead
                      label="Esperado"
                      column="expected"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Contado"
                      column="counted"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                    <th className="p-2 font-medium">Unidade estoque</th>
                    <SortableTableHead
                      label="% variação"
                      column="variation"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={onSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((l) => {
                    const out = l.in_band === false;
                    const pct = variationPct(l.expected_qty, l.counted_qty);
                    const hub = l.products?.unit ?? "";
                    return (
                      <tr
                        key={l.id}
                        className={cn(
                          "border-b border-border/60",
                          out && "bg-amber-500/5",
                        )}
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={selected.has(l.product_id)}
                            onCheckedChange={() => toggle(l.product_id)}
                          />
                        </td>
                        <td className="p-2 font-medium">
                          {l.products?.name ?? l.product_id}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {formatQty(l.expected_qty)}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {formatQty(l.counted_qty)}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {hub ? systemUnitLabel(hub) : "—"}
                          {hub ? ` (${hub})` : ""}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {pct == null
                            ? "—"
                            : `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
            <Button type="button" disabled={busy} onClick={() => void commit()}>
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
    </div>
  );
}

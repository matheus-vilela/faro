import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import {
  COUNT_FILTER_INPUT_CLASS,
  COUNT_ROW_ACTION_CLASS,
  COUNT_SELECT_TRIGGER_CLASS,
  countClickableRowClass,
  inventoryCountLineCount,
  inventoryCountSessionGroupLabel,
} from "@/lib/inventoryCount/ui";
import { inventoryCountPublicUrl } from "@/lib/inventoryCount/createSession";
import {
  aggregateCountReview,
  formatCountImpact,
  type CountReviewProduct,
  type RequiredCountPoint,
} from "@/lib/inventoryCount/review";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { CheckCheck, ChevronRight, Copy, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  inventory_count_session_groups?:
    | { group_id: string; inventory_count_groups: { name: string } | null }[]
    | { group_id: string; inventory_count_groups: { name: string } | null }
    | null;
};

type LineSortKey = "name" | "expected" | "counted" | "variation" | "impact";

function formatQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function sessionExtraGroupNames(s: PendingSession): string[] {
  const raw = s.inventory_count_session_groups;
  const rows = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  const origin = s.inventory_count_groups?.name?.trim() || "";
  const names = rows
    .map((r) => r.inventory_count_groups?.name?.trim() || "")
    .filter(Boolean)
    .filter((n) => n !== origin);
  return [...new Set(names)];
}

function sessionCoversGroup(s: PendingSession, groupId: string): boolean {
  if (s.inventory_count_group_id === groupId) return true;
  const raw = s.inventory_count_session_groups;
  const rows = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  return rows.some((r) => r.group_id === groupId);
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
  const [reviewRows, setReviewRows] = useState<CountReviewProduct[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const openRequestIdRef = useRef<string | null>(null);

  const [filterGroup, setFilterGroup] = useState("");
  const [filterListing, setFilterListing] = useState("");
  const [filterOperator, setFilterOperator] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [onlyDivergent, setOnlyDivergent] = useState(false);
  const [recountHandoff, setRecountHandoff] = useState<{
    itemCount: number;
    link: string;
    operatorName: string | null;
    copied: boolean;
  } | null>(null);

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
        inventory_count_groups!inventory_count_sessions_inventory_count_group_id_fkey ( name ),
        inventory_count_listings ( name ),
        assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey ( name ),
        inventory_count_session_groups ( group_id, inventory_count_groups ( name ) ),
        inventory_count_lines ( count )
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
    const rows = (data ?? []) as unknown as Array<
      PendingSession & {
        inventory_count_lines?: { count: number }[] | { count: number };
      }
    >;
    setSessions(
      rows.filter((s) => inventoryCountLineCount(s.inventory_count_lines) > 0),
    );
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
          s.inventory_count_groups?.name?.trim() || "Única",
        );
      }
      const raw = s.inventory_count_session_groups;
      const rows = !raw ? [] : Array.isArray(raw) ? raw : [raw];
      for (const row of rows) {
        const name = row.inventory_count_groups?.name?.trim();
        if (row.group_id && name) map.set(row.group_id, name);
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
      if (filterGroup && !sessionCoversGroup(s, filterGroup))
        return false;
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
  }, [
    filterGroup,
    filterListing,
    filterOperator,
    periodFrom,
    periodTo,
    sessions,
  ]);

  const closeSession = () => {
    openRequestIdRef.current = null;
    setActiveId(null);
    setReviewRows([]);
    setLinesError(null);
    setLinesLoading(false);
    setSelected(new Set());
  };

  const openSession = async (id: string) => {
    openRequestIdRef.current = id;
    setActiveId(id);
    setSelected(new Set());
    setReviewRows([]);
    setLinesError(null);
    setLinesLoading(true);
    const { data, error } = await supabase
      .from("inventory_count_lines")
      .select(
        `
        id,
        product_id,
        expected_qty,
        counted_qty,
        listing_id,
        tolerance_pct,
        inventory_count_listings ( name, inventory_count_group_id, inventory_count_groups ( name ) ),
        products ( name, unit, average_cost, last_unit_value )
      `,
      )
      .eq("session_id", id)
      .order("sort_order", { ascending: true })
      .limit(5000);
    if (openRequestIdRef.current !== id) return;
    if (error) {
      setReviewRows([]);
      setLinesError(error.message);
      setLinesLoading(false);
      toast.error("Não foi possível carregar as linhas.");
      return;
    }
    const raw = data ?? [];
    if (raw.length === 0) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      closeSession();
      toast.message("Esta sessão não tem itens contados.");
      return;
    }

    const productIds = [...new Set(raw.map((row) => row.product_id as string))];
    const { data: pointRows } = await supabase
      .from("inventory_count_listing_products")
      .select(
        "product_id, listing_id, inventory_count_listings!inner ( id, name, archived_at, inventory_count_group_id, inventory_count_groups ( name ) )",
      )
      .in("product_id", productIds);
    if (openRequestIdRef.current !== id) return;

    const requiredPoints: RequiredCountPoint[] = [];
    for (const row of pointRows ?? []) {
      const listingRaw = row.inventory_count_listings as
        | {
            id: string;
            name: string;
            archived_at: string | null;
            inventory_count_group_id: string | null;
            inventory_count_groups: { name: string } | { name: string }[] | null;
          }
        | {
            id: string;
            name: string;
            archived_at: string | null;
            inventory_count_group_id: string | null;
            inventory_count_groups: { name: string } | { name: string }[] | null;
          }[]
        | null;
      const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;
      if (!listing || listing.archived_at || !listing.inventory_count_group_id) {
        continue;
      }
      const g = listing.inventory_count_groups;
      const groupName = Array.isArray(g) ? g[0]?.name ?? "" : g?.name ?? "";
      requiredPoints.push({
        productId: row.product_id as string,
        listingId: listing.id,
        listingName: listing.name,
        groupName,
      });
    }

    const mapped = raw.map((row) => {
      const productRaw = row.products as
        | {
            name: string;
            unit: string;
            average_cost?: number | null;
            last_unit_value?: number | null;
          }
        | {
            name: string;
            unit: string;
            average_cost?: number | null;
            last_unit_value?: number | null;
          }[]
        | null;
      const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;
      const listingRaw = row.inventory_count_listings as
        | {
            name: string;
            inventory_count_groups: { name: string } | { name: string }[] | null;
          }
        | {
            name: string;
            inventory_count_groups: { name: string } | { name: string }[] | null;
          }[]
        | null;
      const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;
      const g = listing?.inventory_count_groups;
      const groupName = Array.isArray(g) ? g[0]?.name ?? "" : g?.name ?? "";
      return {
        id: row.id as string,
        product_id: row.product_id as string,
        expected_qty: Number(row.expected_qty),
        counted_qty: row.counted_qty == null ? null : Number(row.counted_qty),
        tolerance_pct: Number(row.tolerance_pct),
        listing_id: (row.listing_id as string | null) ?? null,
        listing_name: listing?.name ?? null,
        group_name: groupName,
        product_name: product?.name ?? (row.product_id as string),
        product_unit: product?.unit ?? "",
        average_cost: product?.average_cost ?? null,
        last_unit_value: product?.last_unit_value ?? null,
      };
    });

    setReviewRows(
      aggregateCountReview({ lines: mapped, requiredPoints }),
    );
    setLinesLoading(false);
  };

  const visibleRows = useMemo(() => {
    if (!onlyDivergent) return reviewRows;
    return reviewRows.filter(
      (r) => r.countedQty != null && r.countedQty !== r.expectedQty,
    );
  }, [reviewRows, onlyDivergent]);

  const compareRows = useCallback(
    (a: CountReviewProduct, b: CountReviewProduct, key: LineSortKey) => {
      if (key === "name") {
        return a.name.localeCompare(b.name, "pt-BR");
      }
      if (key === "expected") return a.expectedQty - b.expectedQty;
      if (key === "counted") {
        return (a.countedQty ?? -1) - (b.countedQty ?? -1);
      }
      if (key === "variation") {
        return (a.variationPct ?? 0) - (b.variationPct ?? 0);
      }
      if (key === "impact") return a.impact - b.impact;
      return 0;
    },
    [],
  );

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    CountReviewProduct,
    LineSortKey
  >(visibleRows, "impact", compareRows, false);

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
    const result = data as { ok?: boolean; skipped?: number };
    if (error || !result?.ok) {
      toast.error("Falha ao aprovar/ajustar estoque.");
      return;
    }
    toast.success(
      result.skipped
        ? `Contagem aprovada. ${result.skipped} produto(s) não atualizaram estoque (faltam pontos).`
        : "Contagem aprovada e estoque atualizado.",
    );
    closeSession();
    await load();
    onChanged?.();
  };

  const returnSelected = async () => {
    if (!activeId || selected.size === 0) {
      toast.message("Selecione itens para devolver.");
      return;
    }
    const itemCount = selected.size;
    const operatorName =
      sessions.find((s) => s.id === activeId)?.assigned_member?.name ?? null;
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
    const link = inventoryCountPublicUrl({
      slug: row.slug,
      token: row.token,
    });
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      /* ignore */
    }
    closeSession();
    await load();
    onChanged?.();
    setRecountHandoff({ itemCount, link, operatorName, copied });
  };

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const extraGroups = activeSession
    ? sessionExtraGroupNames(activeSession)
    : [];
  const sessionTitle = activeSession
    ? activeSession.kind === "onboarding"
      ? "Contagem geral (onboarding)"
      : [
          inventoryCountSessionGroupLabel({
            groupName: activeSession.inventory_count_groups?.name,
          }),
          extraGroups.length > 0 ? extraGroups.join(", ") : null,
          activeSession.inventory_count_listings?.name,
        ]
          .filter(Boolean)
          .join(" · ")
    : "Conferir contagem";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label>Grupo</Label>
          <SearchSelect
            value={filterGroup || "__all__"}
            onValueChange={(v) => {
              setFilterGroup(v === "__all__" ? "" : v);
              setFilterListing("");
            }}
            placeholder="Todos"
            searchPlaceholder="Buscar grupo…"
            triggerClassName={COUNT_SELECT_TRIGGER_CLASS}
            leadingOptions={[{ value: "__all__", label: "Todos" }]}
            options={groupOptions.map(([id, name]) => ({
              value: id,
              label: name,
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Listagem</Label>
          <SearchSelect
            value={filterListing || "__all__"}
            onValueChange={(v) => setFilterListing(v === "__all__" ? "" : v)}
            placeholder="Todas"
            searchPlaceholder="Buscar listagem…"
            triggerClassName={COUNT_SELECT_TRIGGER_CLASS}
            leadingOptions={[{ value: "__all__", label: "Todas" }]}
            options={listingOptions.map(([id, name]) => ({
              value: id,
              label: name,
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Operador</Label>
          <SearchSelect
            value={filterOperator || "__all__"}
            onValueChange={(v) => setFilterOperator(v === "__all__" ? "" : v)}
            placeholder="Todos"
            searchPlaceholder="Buscar operador…"
            triggerClassName={COUNT_SELECT_TRIGGER_CLASS}
            leadingOptions={[{ value: "__all__", label: "Todos" }]}
            options={operatorOptions.map(([id, name]) => ({
              value: id,
              label: name,
            }))}
          />
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
                      "border-amber-500/40 bg-amber-500/[0.07] hover:bg-amber-500/15",
                  )}
                  onClick={() => void openSession(s.id)}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">
                      {onboarding
                        ? "Contagem geral (onboarding)"
                        : inventoryCountSessionGroupLabel({
                            groupName: s.inventory_count_groups?.name,
                          })}
                      {sessionExtraGroupNames(s).length > 0
                        ? ` · ${sessionExtraGroupNames(s).join(", ")}`
                        : ""}
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

      <Sheet
        open={!!activeId}
        onOpenChange={(open) => {
          if (!open) closeSession();
        }}
      >
        <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0">
          <SheetHeader className="shrink-0 space-y-1 border-b border-border px-6 pb-4 pt-6 pr-14 text-left">
            <SheetTitle>{sessionTitle}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Esperado × soma dos pontos · impacto em R$
              {activeSession?.kind === "onboarding"
                ? " · onboarding (obrigatória para o estoque atualizar)"
                : ""}
            </p>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={onlyDivergent}
                onCheckedChange={() => setOnlyDivergent((v) => !v)}
              />
              Só divergentes
            </label>

            {linesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando linhas…
              </div>
            ) : linesError ? (
              <p className="text-sm text-destructive">
                Não foi possível carregar as linhas. {linesError}
              </p>
            ) : sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {reviewRows.length === 0
                  ? "Nenhuma linha nesta contagem."
                  : "Nenhuma linha divergente."}
              </p>
            ) : listView === "cards" ? (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {sorted.map((l) => {
                  const out = l.inBand === false;
                  const highImpact = l.impact > 0 && l.unitCost > 0;
                  const hub = l.unit;
                  const pointsLabel = l.points
                    .map((p) =>
                      [p.groupName, formatQty(p.countedQty)]
                        .filter(Boolean)
                        .join(" "),
                    )
                    .join(" · ");
                  return (
                    <label
                      key={l.productId}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-2 text-sm",
                        (out || highImpact) && "border-amber-500/40 bg-amber-500/5",
                      )}
                    >
                      <Checkbox
                        checked={selected.has(l.productId)}
                        onCheckedChange={() => toggle(l.productId)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Esperado: {formatQty(l.expectedQty)} {hub} · Contado:{" "}
                          {formatQty(l.countedQty)} {hub}
                          {l.variationPct != null
                            ? ` · ${l.variationPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
                            : ""}
                          {` · ${formatCountImpact(l.impact)}`}
                          {out ? " · fora da faixa" : ""}
                        </p>
                        {pointsLabel ? (
                          <p className="text-xs text-muted-foreground">
                            {pointsLabel}
                          </p>
                        ) : null}
                        {!l.updatesStock ? (
                          <p className="text-xs text-amber-800 dark:text-amber-200">
                            Não atualiza estoque
                            {l.missingPoints.length > 0
                              ? ` · falta ${l.missingPoints
                                  .map((p) => p.groupName || p.listingName)
                                  .join(", ")}`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-md border">
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
                      <SortableTableHead
                        label="Impacto"
                        column="impact"
                        sortKey={sortKey}
                        sortAsc={sortAsc}
                        onSort={onSort}
                        align="right"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((l) => {
                      const out = l.inBand === false;
                      const highImpact = l.impact > 0 && l.unitCost > 0;
                      const hub = l.unit;
                      const pointsLabel = l.points
                        .map((p) =>
                          [p.groupName, formatQty(p.countedQty)]
                            .filter(Boolean)
                            .join(" "),
                        )
                        .join(" · ");
                      return (
                        <tr
                          key={l.productId}
                          className={cn(
                            "border-b border-border/60",
                            (out || highImpact) && "bg-amber-500/5",
                          )}
                        >
                          <td className="p-2">
                            <Checkbox
                              checked={selected.has(l.productId)}
                              onCheckedChange={() => toggle(l.productId)}
                            />
                          </td>
                          <td className="p-2 font-medium">
                            <span className="block">{l.name}</span>
                            {pointsLabel ? (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {pointsLabel}
                              </span>
                            ) : null}
                            {!l.updatesStock ? (
                              <span className="mt-0.5 block text-xs font-normal text-amber-800 dark:text-amber-200">
                                Não atualiza estoque
                                {l.missingPoints.length > 0
                                  ? ` · falta ${l.missingPoints
                                      .map((p) => p.groupName || p.listingName)
                                      .join(", ")}`
                                  : ""}
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatQty(l.expectedQty)}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatQty(l.countedQty)}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            {hub ? systemUnitLabel(hub) : "—"}
                            {hub ? ` (${hub})` : ""}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {l.variationPct == null
                              ? "—"
                              : `${l.variationPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {formatCountImpact(l.impact)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <SheetFooter className="shrink-0 flex-row flex-wrap gap-2 border-t border-border">
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
              disabled={busy || linesLoading || reviewRows.length === 0}
              onClick={() => void commit()}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="mr-2 h-4 w-4" />
              )}
              Aprovar e ajustar estoque
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        open={recountHandoff != null}
        onOpenChange={(open) => {
          if (!open) setRecountHandoff(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Envie o link ao operador</DialogTitle>
            <DialogDescription>
              {recountHandoff && recountHandoff.itemCount === 1
                ? "1 item voltou para recontagem."
                : `${recountHandoff?.itemCount ?? 0} itens voltaram para recontagem.`}
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            <li>
              Envie este link para{" "}
              {recountHandoff?.operatorName
                ? recountHandoff.operatorName
                : "o operador"}
              .
            </li>
            <li>
              Quando ele contar e enviar de novo, a sessão volta em Aprovar.
            </li>
          </ol>
          {recountHandoff ? (
            <div className="flex gap-2">
              <Input
                readOnly
                value={recountHandoff.link}
                className="font-mono text-xs"
                aria-label="Link de recontagem"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Copiar link"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(recountHandoff.link)
                    .then(() => {
                      setRecountHandoff((prev) =>
                        prev ? { ...prev, copied: true } : prev,
                      );
                      toast.success("Link copiado.");
                    });
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          {recountHandoff?.copied ? (
            <p className="text-xs text-muted-foreground">Link copiado.</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              className="w-full"
              onClick={() => setRecountHandoff(null)}
            >
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

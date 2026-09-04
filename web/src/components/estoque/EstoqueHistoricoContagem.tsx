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
import { COUNT_FILTER_INPUT_CLASS, COUNT_SELECT_TRIGGER_CLASS } from "@/lib/inventoryCount/ui";
import { supabase } from "@/lib/supabase";
import { History, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ShortLinkEmbed = { slug?: string | null } | { slug?: string | null }[] | null;

type SessionRow = {
  id: string;
  status: string;
  kind?: string | null;
  token: string;
  created_at: string;
  submitted_at: string | null;
  company_member_id: string | null;
  created_by_user_id: string | null;
  inventory_count_group_id: string | null;
  inventory_count_listing_id: string | null;
  assigned_company_member_id: string | null;
  inventory_count_groups: { name: string } | null;
  inventory_count_listings: { name: string } | null;
  initiator_member: { name: string } | null;
  assigned_member: { name: string } | null;
  profiles: { full_name: string | null } | null;
  inventory_count_short_links: ShortLinkEmbed;
};

type HistorySortKey =
  | "date"
  | "status"
  | "group"
  | "listing"
  | "operator"
  | "initiator"
  | "origin";

function slugFromEmbed(raw: ShortLinkEmbed): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const s = raw[0]?.slug;
    return typeof s === "string" && s ? s : null;
  }
  const s = raw.slug;
  return typeof s === "string" && s ? s : null;
}

function buildSessionLink(r: SessionRow): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin.replace(/\/$/, "")
      : "";
  const slug = slugFromEmbed(r.inventory_count_short_links);
  if (slug) return `${base}/i/${slug}`;
  return `${base}/contagem-estoque/${r.token}`;
}

function initiatorLabel(r: SessionRow): string {
  const cm = r.initiator_member;
  if (cm?.name?.trim()) return cm.name.trim();
  const pf = r.profiles;
  if (pf?.full_name?.trim()) return pf.full_name.trim();
  return "Proprietário (WhatsApp)";
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Aberta" },
  { value: "returned", label: "Recontagem" },
  { value: "pending_approval", label: "Aguardando aprovação" },
  { value: "committed", label: "Estoques ajustados" },
] as const;

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    open: "Pendente",
    returned: "Recontagem",
    pending_approval: "Aguardando aprovação",
    approved: "Aprovada",
    committed: "Estoques ajustados",
    submitted: "Concluída",
  };
  return labels[status] ?? status;
}

export function EstoqueHistoricoContagem({
  companyId,
  refreshTrigger = 0,
}: {
  companyId: string;
  refreshTrigger?: number;
}) {
  const listView = useSheetListView();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_count_sessions")
      .select(
        `
        id,
        status,
        kind,
        token,
        created_at,
        submitted_at,
        company_member_id,
        created_by_user_id,
        inventory_count_group_id,
        inventory_count_listing_id,
        assigned_company_member_id,
        inventory_count_groups ( name ),
        inventory_count_listings ( name ),
        initiator_member:company_members!inventory_count_sessions_company_member_id_fkey ( name ),
        assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey ( name ),
        profiles!inventory_count_sessions_created_by_user_id_fkey ( full_name ),
        inventory_count_short_links ( slug )
      `,
      )
      .eq("company_id", companyId)
      .in("status", [
        "open",
        "pending_approval",
        "returned",
        "approved",
        "committed",
        "submitted",
      ])
      .limit(120);

    setLoading(false);
    if (error) {
      console.error(error);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as SessionRow[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, refreshTrigger]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      const pivot = r.submitted_at ?? r.created_at;
      if (periodFrom && new Date(pivot).getTime() < new Date(`${periodFrom}T00:00:00`).getTime()) {
        return false;
      }
      if (periodTo && new Date(pivot).getTime() > new Date(`${periodTo}T23:59:59`).getTime()) {
        return false;
      }
      return true;
    });
  }, [periodFrom, periodTo, rows, statusFilter]);

  const compare = useCallback((a: SessionRow, b: SessionRow, key: HistorySortKey) => {
    if (key === "date") {
      const ta = new Date(a.submitted_at ?? a.created_at).getTime();
      const tb = new Date(b.submitted_at ?? b.created_at).getTime();
      return ta - tb;
    }
    if (key === "status") return a.status.localeCompare(b.status, "pt-BR");
    if (key === "group") {
      return (a.inventory_count_groups?.name ?? "").localeCompare(
        b.inventory_count_groups?.name ?? "",
        "pt-BR",
      );
    }
    if (key === "listing") {
      return (a.inventory_count_listings?.name ?? "").localeCompare(
        b.inventory_count_listings?.name ?? "",
        "pt-BR",
      );
    }
    if (key === "operator") {
      return (a.assigned_member?.name ?? "").localeCompare(
        b.assigned_member?.name ?? "",
        "pt-BR",
      );
    }
    if (key === "initiator") {
      return initiatorLabel(a).localeCompare(initiatorLabel(b), "pt-BR");
    }
    const originA = a.company_member_id ? "WhatsApp" : "Painel";
    const originB = b.company_member_id ? "WhatsApp" : "Painel";
    return originA.localeCompare(originB, "pt-BR");
  }, []);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    SessionRow,
    HistorySortKey
  >(filtered, "date", compare, false);

  const statusBadge = (status: string) => {
    if (status === "returned") {
      return (
        <span className="rounded-md bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-800 dark:text-orange-200">
          Recontagem
        </span>
      );
    }
    if (status === "open") {
      return (
        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
          Pendente
        </span>
      );
    }
    return (
      <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {statusLabel(status)}
      </span>
    );
  };

  const originOf = (r: SessionRow) =>
    r.company_member_id
      ? "WhatsApp (operador)"
      : r.created_by_user_id
        ? "Painel"
        : "WhatsApp (proprietário)";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
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
          <History className="h-4 w-4" />
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma contagem registrada ainda.
        </p>
      ) : listView === "cards" ? (
        <ul className="space-y-2">
          {sorted.map((r) => (
            <li key={r.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                {statusBadge(r.status)}
                <span className="text-xs text-muted-foreground">
                  {formatDt(r.submitted_at ?? r.created_at)}
                </span>
              </div>
              <p className="mt-2 font-medium">
                {r.kind === "onboarding"
                  ? "Contagem geral (onboarding)"
                  : (r.inventory_count_groups?.name ?? "—")}
                {r.inventory_count_listings?.name
                  ? ` · ${r.inventory_count_listings.name}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Operador: {r.assigned_member?.name ?? "—"} · {originOf(r)}
              </p>
              <a
                href={buildSessionLink(r)}
                className="mt-1 inline-block text-xs text-primary underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir link
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <SortableTableHead
                  label="Data"
                  column="date"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Situação"
                  column="status"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Grupo"
                  column="group"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Listagem"
                  column="listing"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Operador"
                  column="operator"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Iniciada por"
                  column="initiator"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Origem"
                  column="origin"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <th className="p-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="p-2 whitespace-nowrap text-muted-foreground">
                    {formatDt(r.submitted_at ?? r.created_at)}
                  </td>
                  <td className="p-2">{statusBadge(r.status)}</td>
                  <td className="p-2 text-muted-foreground">
                    {r.kind === "onboarding"
                      ? "Onboarding"
                      : (r.inventory_count_groups?.name?.trim() || "—")}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {r.inventory_count_listings?.name?.trim() || "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {r.assigned_member?.name?.trim() || "—"}
                  </td>
                  <td className="p-2 font-medium">{initiatorLabel(r)}</td>
                  <td className="p-2 text-muted-foreground">{originOf(r)}</td>
                  <td className="p-2 max-w-[min(200px,28vw)]">
                    <a
                      href={buildSessionLink(r)}
                      className="break-all text-xs text-primary underline-offset-2 hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  formatRecurrenceLabel,
  formatScheduleWhen,
} from "@/lib/inventoryCount/scheduleNextRun";
import { inventoryCountScheduleTargetLabel } from "@/lib/inventoryCount/ui";
import { supabase } from "@/lib/supabase";
import type { CompanyMember } from "@/types/companyMember";
import type {
  InventoryCountGroup,
  InventoryCountListing,
  InventoryCountSchedule,
} from "@/types/inventoryCount";
import { FilterX, Loader2, Pencil } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

type AgendaSortKey = "when" | "target" | "recurrence" | "operator";

function scheduleTargetLabel(
  s: InventoryCountSchedule,
  listings: InventoryCountListing[],
  groups: InventoryCountGroup[],
): string {
  const listing = s.inventory_count_listing_id
    ? listings.find((l) => l.id === s.inventory_count_listing_id)
    : undefined;
  const groupId =
    s.inventory_count_group_id ?? listing?.inventory_count_group_id ?? null;
  const group = groupId
    ? groups.find((g) => g.id === groupId)
    : undefined;
  return inventoryCountScheduleTargetLabel({
    listingId: s.inventory_count_listing_id,
    listingName: listing?.name,
    listingGroupId: listing?.inventory_count_group_id,
    groupName: group?.name,
  });
}

function operatorLabel(
  s: InventoryCountSchedule,
  listings: InventoryCountListing[],
  members: CompanyMember[],
): string {
  const id =
    s.assigned_company_member_id ??
    listings.find((l) => l.id === s.inventory_count_listing_id)
      ?.assigned_company_member_id ??
    null;
  return members.find((m) => m.id === id)?.name ?? "Da listagem";
}

export function EstoqueContagemAgendaTab({
  companyId,
  groups,
  listings,
  members,
  schedules,
  loading,
  onEdit,
  onChanged,
}: {
  companyId: string;
  groups: InventoryCountGroup[];
  listings: InventoryCountListing[];
  members: CompanyMember[];
  schedules: InventoryCountSchedule[];
  loading: boolean;
  onEdit: (schedule: InventoryCountSchedule) => void;
  onChanged: () => void;
}) {
  const listView = useSheetListView();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [offTarget, setOffTarget] = useState<InventoryCountSchedule | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schedules.filter((s) => {
      if (!s.active) return false;
      if (kindFilter !== "all" && s.recurrence_kind !== kindFilter) return false;
      if (!q) return true;
      const target = scheduleTargetLabel(s, listings, groups).toLowerCase();
      const rec = formatRecurrenceLabel(s).toLowerCase();
      const op = operatorLabel(s, listings, members).toLowerCase();
      return target.includes(q) || rec.includes(q) || op.includes(q);
    });
  }, [groups, kindFilter, listings, members, schedules, search]);

  const hasFilters = search.trim() !== "" || kindFilter !== "all";

  const compare = useCallback(
    (a: InventoryCountSchedule, b: InventoryCountSchedule, key: AgendaSortKey) => {
      if (key === "when") {
        return (
          new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime()
        );
      }
      if (key === "target") {
        return scheduleTargetLabel(a, listings, groups).localeCompare(
          scheduleTargetLabel(b, listings, groups),
          "pt-BR",
        );
      }
      if (key === "recurrence") {
        return formatRecurrenceLabel(a).localeCompare(
          formatRecurrenceLabel(b),
          "pt-BR",
        );
      }
      return operatorLabel(a, listings, members).localeCompare(
        operatorLabel(b, listings, members),
        "pt-BR",
      );
    },
    [groups, listings, members],
  );

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    InventoryCountSchedule,
    AgendaSortKey
  >(filtered, "when", compare, true);

  const deactivate = async () => {
    if (!offTarget) return;
    setSaving(true);
    const { error } = await supabase
      .from("inventory_count_schedules")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", offTarget.id)
      .eq("company_id", companyId);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível desativar a agenda.");
      return;
    }
    toast.success("Agenda desativada. Não cria mais sessão.");
    setOffTarget(null);
    onChanged();
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando agendas…</p>;
  }

  const actions = (s: InventoryCountSchedule) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => onEdit(s)}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" />
        Editar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOffTarget(s)}
      >
        Desativar
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Próximas datas, da mais próxima. Remarcar não cria contagem
        antecipada — só muda quando o link sai.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 min-w-[12rem] flex-1 md:max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar listagem, grupo ou operador…"
        />
        <SearchSelect
          value={kindFilter}
          onValueChange={setKindFilter}
          placeholder="Recorrência"
          size="sm"
          triggerClassName="w-[11rem]"
          options={[
            { value: "all", label: "Todas" },
            { value: "once", label: "Única" },
            { value: "every_n_days", label: "A cada N dias" },
            { value: "alt_weeks", label: "Semana sim / não" },
          ]}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={!hasFilters}
          onClick={() => {
            setSearch("");
            setKindFilter("all");
          }}
        >
          <FilterX className="mr-1 size-3.5" />
          Limpar
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma contagem agendada. Em Listas, use Programar.
        </p>
      ) : listView === "cards" ? (
        <ul className="space-y-2">
          {sorted.map((s) => (
            <li key={s.id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <p className="font-semibold text-foreground">
                {scheduleTargetLabel(s, listings, groups)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatScheduleWhen(s.next_run_at)} · {formatRecurrenceLabel(s)}
                {" · "}
                {operatorLabel(s, listings, members)}
              </p>
              <div className="mt-3">{actions(s)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <SortableTableHead
                  label="Quando"
                  column="when"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Lista"
                  column="target"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Recorrência"
                  column="recurrence"
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
                <th className="px-3 py-2.5 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatScheduleWhen(s.next_run_at)}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {scheduleTargetLabel(s, listings, groups)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatRecurrenceLabel(s)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {operatorLabel(s, listings, members)}
                  </td>
                  <td className="px-3 py-2">{actions(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={offTarget != null}
        onOpenChange={(open) => {
          if (!open && !saving) setOffTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desativar esta agenda?</DialogTitle>
            <DialogDescription>
              {offTarget
                ? scheduleTargetLabel(offTarget, listings, groups)
                : ""}
              . Não gera mais sessão. Dá para programar de novo na lista.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setOffTarget(null)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={() => void deactivate()}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Desativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

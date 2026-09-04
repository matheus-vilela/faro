import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatRecurrenceLabel, formatScheduleWhen } from "@/lib/inventoryCount/scheduleNextRun";
import { COUNT_ROW_ACTION_CLASS, countClickableRowClass } from "@/lib/inventoryCount/ui";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import type {
  InventoryCountGroup,
  InventoryCountListing,
  InventoryCountSchedule,
} from "@/types/inventoryCount";
import { CalendarClock, ChevronRight, FolderPlus, Play, Trash2 } from "lucide-react";

export function EstoqueContagemListasTab({
  groups,
  listings,
  members,
  schedules,
  productCountByListing,
  loading,
  countingId,
  onNewGroup,
  onDeleteGroup,
  onNewListing,
  onOpenListing,
  onCountGroup,
  onCountListing,
  onProgramGroup,
  onProgramListing,
}: {
  groups: InventoryCountGroup[];
  listings: InventoryCountListing[];
  members: CompanyMember[];
  schedules: InventoryCountSchedule[];
  productCountByListing: Map<string, number>;
  loading: boolean;
  countingId: string;
  onNewGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onNewListing: (groupId: string) => void;
  onOpenListing: (listingId: string) => void;
  onCountGroup: (groupId: string) => void;
  onCountListing: (listingId: string) => void;
  onProgramGroup: (groupId: string) => void;
  onProgramListing: (listingId: string) => void;
}) {
  const nextScheduleFor = (
    groupId: string,
    listingId?: string,
  ): InventoryCountSchedule | null => {
    const rows = schedules.filter((s) => {
      if (!s.active) return false;
      if (listingId) return s.inventory_count_listing_id === listingId;
      return (
        s.inventory_count_group_id === groupId &&
        !s.inventory_count_listing_id
      );
    });
    rows.sort(
      (a, b) =>
        new Date(a.next_run_at).getTime() - new Date(b.next_run_at).getTime(),
    );
    return rows[0] ?? null;
  };

  const listingNext = (listing: InventoryCountListing) => {
    const own = nextScheduleFor(listing.inventory_count_group_id, listing.id);
    if (own) return own;
    return nextScheduleFor(listing.inventory_count_group_id);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando listas…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Cada grupo é um setor. Gere ou programe a contagem no card — sem
          escolher o grupo de novo em outro lugar.
        </p>
        <Button type="button" onClick={onNewGroup}>
          <FolderPlus className="mr-2 h-4 w-4" />
          Novo grupo
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nenhum grupo ainda</CardTitle>
            <CardDescription>
              Crie um grupo (setor) e, em seguida, a primeira listagem com
              operador e produtos.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {groups.map((g) => {
        const groupListings = listings.filter(
          (l) => l.inventory_count_group_id === g.id,
        );
        const groupSched = nextScheduleFor(g.id);
        return (
          <Card key={g.id} className="border-2 border-primary/25">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{g.name}</CardTitle>
                  <CardDescription>
                    {groupListings.length} listagem(ns)
                    {groupSched
                      ? ` · próxima: ${formatScheduleWhen(groupSched.next_run_at)} (${formatRecurrenceLabel(groupSched)})`
                      : ""}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={countingId === g.id || groupListings.length === 0}
                    onClick={() => onCountGroup(g.id)}
                  >
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    Contar agora
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onProgramGroup(g.id)}
                  >
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                    Programar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onNewListing(g.id)}
                  >
                    Nova listagem
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="Remover grupo"
                    onClick={() => onDeleteGroup(g.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {groupListings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma listagem. Crie a primeira com nome, operador e
                  produtos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {groupListings.map((l) => {
                    const sched = listingNext(l);
                    return (
                      <li key={l.id} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <button
                          type="button"
                          className={cn(countClickableRowClass(), "min-w-0 flex-1")}
                          onClick={() => onOpenListing(l.id)}
                        >
                          <span className="min-w-0">
                            <span className="block font-semibold text-foreground">
                              {l.name}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Operador:{" "}
                              {members.find(
                                (m) => m.id === l.assigned_company_member_id,
                              )?.name ?? "Qualquer"}
                              {" · "}
                              {productCountByListing.get(l.id) ?? 0} produtos
                              {sched
                                ? ` · próxima: ${formatScheduleWhen(sched.next_run_at)}`
                                : ""}
                            </span>
                          </span>
                          <span className={COUNT_ROW_ACTION_CLASS}>
                            Abrir
                            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        </button>
                        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            disabled={countingId === l.id}
                            onClick={() => onCountListing(l.id)}
                          >
                            Contar esta lista
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onProgramListing(l.id)}
                          >
                            Programar
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

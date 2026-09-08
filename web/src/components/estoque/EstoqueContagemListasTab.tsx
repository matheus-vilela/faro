import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { activeCountStatusLabel } from "@/lib/inventoryCount/createSession";
import { COUNT_ROW_ACTION_CLASS, countClickableRowClass } from "@/lib/inventoryCount/ui";
import { cn } from "@/lib/utils";
import type { CompanyMember } from "@/types/companyMember";
import type {
  InventoryCountGroup,
  InventoryCountListing,
} from "@/types/inventoryCount";
import { CalendarClock, ChevronRight, ClipboardList, FolderPlus, Play, Trash2 } from "lucide-react";

function ListingCountRow({
  listing,
  members,
  productCount,
  activeStatus,
  countingId,
  onOpen,
  onCount,
  onProgram,
}: {
  listing: InventoryCountListing;
  members: CompanyMember[];
  productCount: number;
  activeStatus: "open" | "returned" | undefined;
  countingId: string;
  onOpen: () => void;
  onCount: () => void;
  onProgram: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <button
        type="button"
        className={cn(countClickableRowClass(), "min-w-0 flex-1")}
        onClick={onOpen}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{listing.name}</span>
            {activeStatus ? (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium",
                  activeStatus === "returned"
                    ? "bg-orange-500/15 text-orange-800 dark:text-orange-200"
                    : "bg-amber-500/15 text-amber-800 dark:text-amber-200",
                )}
              >
                {activeCountStatusLabel(activeStatus)}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Operador:{" "}
            {members.find((m) => m.id === listing.assigned_company_member_id)
              ?.name ?? "Qualquer"}
            {" · "}
            {productCount} produtos
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
          disabled={countingId === listing.id}
          onClick={onCount}
        >
          Contar esta lista
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onProgram}>
          Programar
        </Button>
      </div>
    </li>
  );
}

export function EstoqueContagemListasTab({
  groups,
  listings,
  members,
  productCountByListing,
  listingActiveStatus,
  loading,
  countingId,
  onNewGroup,
  onNewOneOff,
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
  productCountByListing: Map<string, number>;
  listingActiveStatus: Map<string, "open" | "returned">;
  loading: boolean;
  countingId: string;
  onNewGroup: () => void;
  onNewOneOff: () => void;
  onDeleteGroup: (groupId: string) => void;
  onNewListing: (groupId: string) => void;
  onOpenListing: (listingId: string) => void;
  onCountGroup: (groupId: string) => void;
  onCountListing: (listingId: string) => void;
  onProgramGroup: (groupId: string) => void;
  onProgramListing: (listingId: string) => void;
}) {
  const oneOffListings = listings.filter((l) => !l.inventory_count_group_id);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando listas…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Monte as listas aqui. Datas ficam na aba Agenda. Lista única some
          depois de Aprovar.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onNewOneOff}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Nova lista única
          </Button>
          <Button type="button" onClick={onNewGroup}>
            <FolderPlus className="mr-2 h-4 w-4" />
            Novo grupo
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listas únicas</CardTitle>
          <CardDescription>
            Fora do setor, sem recorrência. Some daqui quando a contagem for
            aprovada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {oneOffListings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma lista única. Monte produtos e operador, depois conte ou
              programe.
            </p>
          ) : (
            <ul className="space-y-2">
              {oneOffListings.map((l) => (
                <ListingCountRow
                  key={l.id}
                  listing={l}
                  members={members}
                  productCount={productCountByListing.get(l.id) ?? 0}
                  activeStatus={listingActiveStatus.get(l.id)}
                  countingId={countingId}
                  onOpen={() => onOpenListing(l.id)}
                  onCount={() => onCountListing(l.id)}
                  onProgram={() => onProgramListing(l.id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
        return (
          <Card key={g.id}>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{g.name}</CardTitle>
                  <CardDescription>
                    {groupListings.length} listagem(ns)
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
                  {groupListings.map((l) => (
                    <ListingCountRow
                      key={l.id}
                      listing={l}
                      members={members}
                      productCount={productCountByListing.get(l.id) ?? 0}
                      activeStatus={listingActiveStatus.get(l.id)}
                      countingId={countingId}
                      onOpen={() => onOpenListing(l.id)}
                      onCount={() => onCountListing(l.id)}
                      onProgram={() => onProgramListing(l.id)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

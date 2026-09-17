import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  activeCountStatusLabel,
  activeSessionsForListing,
  formatCountSessionWhen,
  listingHasPendingApproval,
  type InventoryCountSessionSummary,
} from "@/lib/inventoryCount/createSession";
import type { InventoryCountListing } from "@/types/inventoryCount";

export type CountReusePrompt =
  | {
      kind: "listings";
      listings: InventoryCountListing[];
      busyKey: string;
    }
  | {
      kind: "round";
      groupName: string;
      session: InventoryCountSessionSummary;
      pendingApproval: boolean;
      busyKey: string;
    };

export function EstoqueContagemReuseDialog({
  prompt,
  sessions,
  busy,
  onOpenChange,
  onReuse,
  onCreateNew,
}: {
  prompt: CountReusePrompt | null;
  sessions: InventoryCountSessionSummary[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onReuse: () => void;
  onCreateNew: () => void;
}) {
  const isRound = prompt?.kind === "round";
  const listings = prompt?.kind === "listings" ? prompt.listings : [];
  const first = listings[0] ?? null;
  const firstActive = first
    ? activeSessionsForListing(sessions, first.id)
    : [];
  const latest = firstActive[0] ?? null;
  const pendingAny = listings.some((l) =>
    listingHasPendingApproval(sessions, l.id),
  );

  return (
    <Dialog open={prompt != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {isRound && prompt.kind === "round" ? (
          <>
            <DialogHeader>
              <DialogTitle>Já existe uma rodada neste setor</DialogTitle>
              <DialogDescription>
                Continuar reusa o mesmo link (pode incluir outros setores).
                Começar outra deixa a anterior no Histórico.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              <span className="font-medium text-foreground">
                {prompt.groupName}
              </span>
              {" · "}
              {activeCountStatusLabel(prompt.session.status)}
              {" · "}
              {formatCountSessionWhen(prompt.session.created_at)}
            </p>
            {prompt.pendingApproval ? (
              <p className="text-xs text-muted-foreground">
                Há também uma rodada deste setor aguardando conferência.
              </p>
            ) : null}
            <DialogFooter className="sm:flex-wrap">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onCreateNew}
              >
                Começar uma nova
              </Button>
              <Button type="button" disabled={busy} onClick={onReuse}>
                Continuar esta
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Já existe uma contagem desta lista</DialogTitle>
              <DialogDescription>
                {first ? (
                  <>
                    <span className="font-medium text-foreground">
                      {first.name}
                    </span>
                    {latest ? (
                      <>
                        {" · "}
                        {activeCountStatusLabel(latest.status)}
                        {" · "}
                        {formatCountSessionWhen(latest.created_at)}
                      </>
                    ) : null}
                  </>
                ) : (
                  "Há uma contagem em andamento."
                )}
              </DialogDescription>
            </DialogHeader>
            {firstActive.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                Há {firstActive.length} contagens abertas desta lista.
                Continuamos a mais recente.
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Começar uma nova deixa a anterior no Histórico até ser concluída.
            </p>
            {pendingAny ? (
              <p className="text-xs text-muted-foreground">
                Já há também uma desta lista aguardando conferência.
              </p>
            ) : null}
            <DialogFooter className="sm:flex-wrap">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onCreateNew}
              >
                Começar uma nova
              </Button>
              <Button type="button" disabled={busy} onClick={onReuse}>
                Continuar esta
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

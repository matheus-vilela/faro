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

export type CountReusePrompt = {
  listings: InventoryCountListing[];
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
  const listings = prompt?.listings ?? [];
  const isGroup = listings.length > 1;
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
        {isGroup ? (
          <>
            <DialogHeader>
              <DialogTitle>Já existem contagens neste grupo</DialogTitle>
              <DialogDescription>
                Continuar reusa o link de cada lista aberta e só cria as que
                ainda não têm. Abrir tudo de novo deixa as anteriores no
                Histórico.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-56 space-y-2 overflow-y-auto py-1 text-sm">
              {listings.map((l) => {
                const active = activeSessionsForListing(sessions, l.id);
                const row = active[0];
                return (
                  <li
                    key={l.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="font-medium text-foreground">{l.name}</span>
                    {row ? (
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {activeCountStatusLabel(row.status)}
                        <span className="mt-0.5 block">
                          {formatCountSessionWhen(row.created_at)}
                        </span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Sem contagem aberta
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {pendingAny ? (
              <p className="text-xs text-muted-foreground">
                Há listagem neste grupo aguardando conferência.
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
                Abrir tudo de novo
              </Button>
              <Button type="button" disabled={busy} onClick={onReuse}>
                Continuar as existentes e abrir só as que faltam
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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { undoProductMerge } from "@/lib/undoProductMerge";
import { cn } from "@/lib/utils";
import {
  activeProductMergeEvents,
  parseProductMergeAudit,
  type ProductMergeEvent,
} from "@/types/productMergeAudit";
import type { Product } from "@/types/product";
import { GitMerge, Loader2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function formatMergeDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ProductMergeAuditSection({
  companyId,
  product,
  className,
  onUndone,
}: {
  companyId: string;
  product: Product;
  className?: string;
  onUndone?: (restoredLoserId: string) => void;
}) {
  const events = useMemo(
    () => activeProductMergeEvents(parseProductMergeAudit(product.merge_audit)),
    [product.merge_audit],
  );
  const [pendingUndo, setPendingUndo] = useState<ProductMergeEvent | null>(
    null,
  );
  const [undoing, setUndoing] = useState(false);

  if (events.length === 0) return null;

  const handleUndo = async () => {
    if (!pendingUndo) return;
    setUndoing(true);
    const result = await undoProductMerge(companyId, pendingUndo.id);
    setUndoing(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Unificação desfeita. «${pendingUndo.loser_name}» foi restaurado no catálogo.`,
    );
    setPendingUndo(null);
    onUndone?.(result.restoredLoserId);
  };

  return (
    <>
      <section className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Unificações recentes</p>
        </div>
        <ul className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-2 rounded-xl border border-border/80 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-snug">
                  Unificado com «{event.loser_name}»
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatMergeDate(event.merged_at)}
                  {event.stock_delta_winner_unit > 0 ? (
                    <>
                      {" "}
                      · +{event.stock_delta_winner_unit.toLocaleString("pt-BR")}{" "}
                      {product.unit} somados ao estoque
                    </>
                  ) : null}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setPendingUndo(event)}
              >
                <Undo2 className="mr-1.5 h-4 w-4" />
                Desfazer
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <AlertDialog
        open={pendingUndo != null}
        onOpenChange={(open) => {
          if (!open && !undoing) setPendingUndo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer unificação?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUndo ? (
                <>
                  O produto «{pendingUndo.loser_name}» será restaurado no
                  catálogo e os vínculos de movimentações e despesas voltarão
                  para ele. O estoque de «{product.name}» será ajustado ao
                  estado anterior a esta unificação.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoing}
              onClick={(e) => {
                e.preventDefault();
                void handleUndo();
              }}
            >
              {undoing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Desfazendo…
                </>
              ) : (
                "Confirmar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ProductMergeMovementUndoButton({
  companyId,
  eventId,
  loserName,
  undoneAt,
  onUndone,
}: {
  companyId: string;
  eventId: string | null;
  loserName?: string | null;
  undoneAt?: string | null;
  onUndone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  if (!eventId || undoneAt) return null;

  const handleUndo = async () => {
    setUndoing(true);
    const result = await undoProductMerge(companyId, eventId);
    setUndoing(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      loserName
        ? `Unificação desfeita. «${loserName}» restaurado.`
        : "Unificação desfeita.",
    );
    setOpen(false);
    onUndone?.();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Undo2 className="mr-1 h-3 w-3" />
        Desfazer
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desfazer unificação?</AlertDialogTitle>
            <AlertDialogDescription>
              {loserName
                ? `Restaurar «${loserName}» e reverter vínculos desta unificação.`
                : "Restaurar o produto removido e reverter vínculos desta unificação."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoing}
              onClick={(e) => {
                e.preventDefault();
                void handleUndo();
              }}
            >
              {undoing ? "Desfazendo…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

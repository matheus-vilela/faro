import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBrl } from "@/lib/dre/formatBrl";
import type {
  ChecklistItemState,
  MonthClosingItemId,
} from "@/lib/monthClosingChecklist";
import { hasMoneyValue } from "@/lib/monthClosingChecklist";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  Lock,
} from "lucide-react";
import { useMemo, useState } from "react";

type Tone = "red" | "yellow" | "green";

function cardTone(item: ChecklistItemState): Tone {
  const done =
    item.status === "confirmed" || item.status === "no_value_confirmed";
  if (done) return "green";
  if (item.hasValue) return "yellow";
  return "red";
}

function statusLabel(item: ChecklistItemState): string {
  if (item.status === "no_value_confirmed") return "Sem movimentação no mês";
  if (item.status === "confirmed") return "Confirmado";
  if (item.hasValue) return "Pendente de conferência";
  return "Sem valor encontrado";
}

const toneClass: Record<Tone, string> = {
  red: "border-rose-300/80 bg-rose-50/90 text-foreground dark:border-rose-500/45 dark:bg-rose-950/35",
  yellow:
    "border-amber-300/90 bg-amber-50/95 text-foreground dark:border-amber-500/45 dark:bg-amber-950/35",
  green:
    "border-emerald-300/80 bg-emerald-50/90 text-foreground dark:border-emerald-500/40 dark:bg-emerald-950/35",
};

export type MonthClosingChecklistProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodLabel: string;
  loading: boolean;
  hydrated: boolean;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  reopenReason: string | null;
  doneCount: number;
  canClose: boolean;
  items: ChecklistItemState[];
  onConfirmValue: (id: MonthClosingItemId) => void;
  onConfirmNoValue: (id: MonthClosingItemId) => void;
  onUndo: (id: MonthClosingItemId) => void;
  onCloseMonth: () => void;
  onReopenMonth: (reason: string) => void;
};

type ConfirmKind =
  | { type: "no_value"; id: MonthClosingItemId }
  | { type: "close_month" }
  | null;

export function MonthClosingChecklist({
  open,
  onOpenChange,
  periodLabel,
  loading,
  hydrated,
  isClosed,
  closedAt,
  closedBy,
  reopenReason: lastReopenReason,
  doneCount,
  canClose,
  items,
  onConfirmValue,
  onConfirmNoValue,
  onUndo,
  onCloseMonth,
  onReopenMonth,
}: MonthClosingChecklistProps) {
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [reopenReasonDraft, setReopenReasonDraft] = useState("");
  const [reopenError, setReopenError] = useState(false);

  const progressPct = useMemo(() => (doneCount / 5) * 100, [doneCount]);

  const closedAtFmt = closedAt
    ? new Date(closedAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const handleReopenSubmit = () => {
    const t = reopenReasonDraft.trim();
    if (!t) {
      setReopenError(true);
      return;
    }
    setReopenError(false);
    onReopenMonth(t);
    setReopenReasonDraft("");
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          showCloseButton
          className={cn(
            "flex h-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="shrink-0 space-y-3 border-b bg-background px-4 pb-4 pt-12">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
                  aria-hidden
                >
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-1 pr-8">
                  <SheetTitle className="text-left text-lg leading-snug">
                    Checklist de Fechamento
                  </SheetTitle>
                  <SheetDescription className="text-left text-xs sm:text-sm">
                    Competência: <span className="font-medium">{periodLabel}</span>
                  </SheetDescription>
                </div>
              </div>

              {isClosed ? (
                <div
                  role="status"
                  className="flex gap-3 rounded-lg border border-emerald-300/70 bg-emerald-50/80 px-3 py-2.5 text-sm dark:border-emerald-500/40 dark:bg-emerald-950/40"
                >
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                      Mês fechado
                    </p>
                    <p className="text-xs leading-relaxed text-emerald-900/85 dark:text-emerald-100/90">
                      {closedAtFmt
                        ? `Este período foi encerrado em ${closedAtFmt}${
                            closedBy ? ` · ${closedBy}` : ""
                          }.`
                        : "Este período já foi encerrado."}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium leading-snug text-foreground">
                    Confira os principais valores do mês antes de fechar o período.
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Marque cada item como conferido ou informe quando não houve movimentação no
                    mês.
                  </p>
                  {lastReopenReason ? (
                    <div
                      role="note"
                      className="rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground"
                    >
                      <span className="font-semibold">Motivo registrado na última reabertura: </span>
                      {lastReopenReason}
                    </div>
                  ) : null}
                </>
              )}

              {!isClosed ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {doneCount} de 5 itens conferidos
                    </span>
                    <span className="tabular-nums">{doneCount}/5</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={doneCount}
                    aria-valuemin={0}
                    aria-valuemax={5}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              {!hydrated ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : loading ? (
                <p className="text-sm text-muted-foreground">Carregando valores do período…</p>
              ) : isClosed ? (
                <ClosedMonthSummary items={items} />
              ) : (
                <ul className="space-y-3">
                  {items.map((item) => (
                    <li key={item.id}>
                      <ChecklistCard
                        item={item}
                        disabled={loading}
                        onConfirmValue={() => onConfirmValue(item.id)}
                        onConfirmNoValue={() =>
                          setConfirm({ type: "no_value", id: item.id })
                        }
                        onUndo={() => onUndo(item.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {hydrated && isClosed ? (
                <section
                  className="mt-6 space-y-3 rounded-xl border border-orange-300/80 bg-orange-50/90 p-4 dark:border-orange-500/40 dark:bg-orange-950/35"
                  aria-labelledby="reopen-heading"
                >
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-700 dark:text-orange-300" />
                    <div className="min-w-0 space-y-1">
                      <h3 id="reopen-heading" className="text-sm font-semibold text-foreground">
                        Reabrir mês
                      </h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Ao reabrir, todas as confirmações serão resetadas e você precisará revisar
                        os itens novamente.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reopen-reason" className="text-xs">
                      Motivo da reabertura (obrigatório)
                    </Label>
                    <textarea
                      id="reopen-reason"
                      rows={3}
                      value={reopenReasonDraft}
                      onChange={(e) => {
                        setReopenReasonDraft(e.target.value);
                        if (reopenError && e.target.value.trim()) setReopenError(false);
                      }}
                      aria-invalid={reopenError}
                      placeholder="Descreva o motivo para reabrir este período."
                      className={cn(
                        "flex w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow]",
                        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
                        reopenError && "border-destructive",
                      )}
                    />
                    {reopenError ? (
                      <p className="text-xs text-destructive">Informe o motivo da reabertura.</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-orange-400/80 bg-background hover:bg-orange-50 dark:border-orange-500/50 dark:hover:bg-orange-950/50"
                    onClick={handleReopenSubmit}
                  >
                    Reabrir mês
                  </Button>
                </section>
              ) : null}
            </div>

            {!isClosed ? (
              <div className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                {canClose ? (
                  <Button type="button" className="w-full" onClick={() => setConfirm({ type: "close_month" })}>
                    Confirmar e fechar mês
                  </Button>
                ) : (
                  <p className="text-center text-xs text-muted-foreground">
                    Conclua os 5 itens para habilitar o fechamento do período.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent
          overlayClassName="z-[60] bg-black/50"
          className="z-[60] max-w-[calc(100%-2rem)] sm:max-w-md"
        >
          {confirm?.type === "no_value" ? (
            <>
              <DialogHeader>
                <DialogTitle>Sem movimentação?</DialogTitle>
                <DialogDescription>
                  Confirmar que não houve valor neste mês para este item? O card será marcado como
                  conferido sem movimentação.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onConfirmNoValue(confirm.id);
                    setConfirm(null);
                  }}
                >
                  Confirmar
                </Button>
              </DialogFooter>
            </>
          ) : confirm?.type === "close_month" ? (
            <>
              <DialogHeader>
                <DialogTitle>Fechamento do mês</DialogTitle>
                <DialogDescription>
                  Tem certeza de que deseja fechar este período? Os dados conferidos permanecem
                  registrados; você pode reabrir depois informando o motivo.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onCloseMonth();
                    setConfirm(null);
                  }}
                >
                  Fechar período
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChecklistCard({
  item,
  disabled,
  onConfirmValue,
  onConfirmNoValue,
  onUndo,
}: {
  item: ChecklistItemState;
  disabled: boolean;
  onConfirmValue: () => void;
  onConfirmNoValue: () => void;
  onUndo: () => void;
}) {
  const tone = cardTone(item);
  const done =
    item.status === "confirmed" || item.status === "no_value_confirmed";

  return (
    <div
      className={cn(
        "rounded-xl border p-3 shadow-sm transition-colors sm:p-4",
        toneClass[tone],
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold leading-snug">{item.title}</p>
          <p className="font-mono text-base font-semibold tabular-nums text-foreground">
            {formatBrl(item.amount)}
          </p>
          <p className="text-xs leading-relaxed opacity-95">{item.description}</p>
          <p className="text-xs font-medium text-foreground/90">{statusLabel(item)}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:w-44">
          {!done ? (
            <>
              {!item.hasValue ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full border-2 border-foreground/25 bg-background/95 px-2 py-2 text-xs font-semibold leading-tight shadow-sm ring-1 ring-foreground/10 transition-[box-shadow,background-color] hover:border-foreground/35 hover:bg-background hover:shadow-md dark:border-foreground/30 dark:bg-card/95 dark:hover:bg-card"
                  disabled={disabled}
                  onClick={onConfirmNoValue}
                  title="Confirme que não houve movimentação neste mês para este item"
                >
                  <Ban className="size-3.5 shrink-0 opacity-80" aria-hidden />
                  Sem movimentação
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={disabled}
                  onClick={onConfirmValue}
                >
                  Está tudo certo
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full border-foreground/20 bg-background/70"
              disabled={disabled}
              onClick={onUndo}
            >
              Desfazer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ClosedMonthSummary({ items }: { items: ChecklistItemState[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Itens conferidos neste fechamento</p>
      <ul className="space-y-2">
        {items.map((item) => {
          const label =
            item.status === "no_value_confirmed"
              ? "Sem movimentação no mês"
              : "Confirmado";
          return (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-3 py-2 text-sm dark:border-emerald-500/30 dark:bg-emerald-950/25"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{item.title}</p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {hasMoneyValue(item.amount) ? formatBrl(item.amount) : "R$ 0,00"}
                </p>
                <p className="text-xs text-emerald-900/90 dark:text-emerald-100/90">{label}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MonthClosingChecklistButton({
  isClosed,
  loading,
  onClick,
  className,
}: {
  isClosed: boolean;
  loading: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={isClosed ? "outline" : "default"}
      className={cn("w-full gap-2 sm:w-auto", className)}
      disabled={loading}
      onClick={onClick}
    >
      <ListChecks className="size-4 shrink-0" aria-hidden />
      {isClosed ? "Mês fechado" : "Checklist de Fechamento"}
    </Button>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  PackageCheck,
  Pencil,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ItemStatus = "received" | "partial" | "not_received";

type ReviewItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_value: number;
  invoice_unit: string | null;
};

type ReviewHeader = {
  recebimentoId: string;
  expenseId: string;
  token: string;
  status: "pending" | "received";
  supplierName: string;
  invoiceNumber: string | null;
};

type ItemStatusRow = {
  expense_item_id: string;
  status: ItemStatus;
  quantity_received?: number | null;
  notes?: string | null;
};

export type RecebimentoReviewPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recebimentoId: string | null;
  companyId: string | null;
  onChanged?: () => void;
};

function statusLabel(s: ItemStatus | undefined): string {
  if (s === "partial") return "Parcial";
  if (s === "not_received") return "Não recebido";
  if (s === "received") return "Recebido";
  return "Aguardando";
}

function formatQty(n: number): string {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function itemUnit(it: ReviewItem): string {
  const u = it.invoice_unit?.trim();
  return u || "un";
}

export function RecebimentoReviewPanel({
  open,
  onOpenChange,
  recebimentoId,
  companyId,
  onChanged,
}: RecebimentoReviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [header, setHeader] = useState<ReviewHeader | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [copyingLink, setCopyingLink] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draftStatus, setDraftStatus] = useState<Record<string, ItemStatus>>(
    {},
  );
  const [partialQty, setPartialQty] = useState<Record<string, string>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!open || !recebimentoId || !companyId) return;
    setLoading(true);
    try {
      const selectBase = `
          id,
          expense_id,
          status,
          token,
          expenses (
            id,
            company_id,
            supplier_name,
            display_name,
            invoice_number,
            expense_items (
              id,
              product_name,
              quantity,
              unit_value,
              invoice_unit
            )
          )
      `;
      let rec: Record<string, unknown> | null = null;
      let recErr: { message?: string } | null = null;
      const withNotes = await supabase
        .from("recebimentos")
        .select(
          `${selectBase},
          recebimento_item_status (
            expense_item_id,
            status,
            quantity_received,
            notes
          )`,
        )
        .eq("id", recebimentoId)
        .maybeSingle();
      rec = withNotes.data as Record<string, unknown> | null;
      recErr = withNotes.error;
      if (recErr?.message?.includes("notes")) {
        const withoutNotes = await supabase
          .from("recebimentos")
          .select(
            `${selectBase},
          recebimento_item_status (
            expense_item_id,
            status,
            quantity_received
          )`,
          )
          .eq("id", recebimentoId)
          .maybeSingle();
        rec = withoutNotes.data as Record<string, unknown> | null;
        recErr = withoutNotes.error;
      }

      if (recErr || !rec) {
        toast.error(recErr?.message ?? "Recebimento não encontrado.");
        setHeader(null);
        setItems([]);
        return;
      }

      const exp = rec.expenses as unknown as {
        id: string;
        company_id: string;
        supplier_name: string | null;
        display_name: string | null;
        invoice_number: string | null;
        expense_items?: ReviewItem[];
      } | null;

      if (!exp || exp.company_id !== companyId) {
        toast.error("Recebimento não pertence a esta empresa.");
        setHeader(null);
        setItems([]);
        return;
      }

      setHeader({
        recebimentoId: rec.id as string,
        expenseId: exp.id,
        token: String(rec.token ?? ""),
        status: rec.status as "pending" | "received",
        supplierName:
          exp.display_name?.trim() ||
          exp.supplier_name?.trim() ||
          "Sem fornecedor",
        invoiceNumber: exp.invoice_number,
      });

      const lines = (exp.expense_items ?? []).map((it) => ({
        ...it,
        invoice_unit: it.invoice_unit ?? null,
      }));
      setItems(lines);
      const statusRows =
        (rec.recebimento_item_status as ItemStatusRow[] | null) ?? [];
      const nextDraft: Record<string, ItemStatus> = {};
      const nextPartial: Record<string, string> = {};
      const nextNotes: Record<string, string> = {};
      for (const line of lines) {
        const existing = statusRows.find((s) => s.expense_item_id === line.id);
        nextDraft[line.id] = existing?.status ?? "received";
        if (
          existing?.status === "partial" &&
          existing.quantity_received != null
        ) {
          nextPartial[line.id] = String(existing.quantity_received);
        }
        if (existing?.notes?.trim()) {
          nextNotes[line.id] = existing.notes;
        }
      }
      setDraftStatus(nextDraft);
      setPartialQty(nextPartial);
      setItemNotes(nextNotes);
    } finally {
      setLoading(false);
    }
  }, [open, recebimentoId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      return;
    }
    setEditing(false);
  }, [open, recebimentoId]);

  const copyOperadorLink = async () => {
    if (!header) return;
    setCopyingLink(true);
    const { data: shortSlug, error } = await supabase.rpc(
      "ensure_recebimento_short_slug",
      { p_recebimento_id: header.recebimentoId },
    );
    setCopyingLink(false);
    if (error || !shortSlug) {
      toast.error(error?.message ?? "Não foi possível gerar o link.");
      return;
    }
    const url = `${window.location.origin}/s/${shortSlug}`;
    await navigator.clipboard.writeText(url);
    toast.success(
      "Link copiado. O recebimento também pode ser feito nesta tela.",
    );
  };

  const isReceived = header?.status === "received";
  const canEdit = !isReceived || editing;

  const persistConference = async (): Promise<boolean> => {
    if (!header?.token) {
      toast.error("Não foi possível salvar: token ausente.");
      return false;
    }
    const payload: Array<Record<string, unknown>> = [];
    for (const it of items) {
      const st = draftStatus[it.id] ?? "received";
      const row: Record<string, unknown> = {
        expense_item_id: it.id,
        status: st,
      };
      if (st === "partial") {
        const n = parseFloat((partialQty[it.id] ?? "").replace(",", "."));
        const maxPedido = Number(it.quantity);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error(`Informe a quantidade recebida de “${it.product_name}”.`);
          return false;
        }
        if (n >= maxPedido) {
          toast.error(
            `“${it.product_name}”: para a quantidade total, marque Recebido.`,
          );
          return false;
        }
        row.quantity_received = n;
      }
      if (st === "partial" || st === "not_received") {
        const notes = (itemNotes[it.id] ?? "").trim();
        if (notes) row.notes = notes;
      }
      payload.push(row);
    }
    setConfirming(true);
    const { data: res, error } = await supabase.rpc("confirmar_recebimento", {
      p_token: header.token,
      p_items: payload,
    });
    setConfirming(false);
    if (error) {
      toast.error(error.message || "Erro ao salvar conferência.");
      return false;
    }
    const result = res as { success?: boolean; error?: string };
    if (!result?.success) {
      toast.error(result?.error ?? "Não foi possível salvar a conferência.");
      return false;
    }
    toast.success(
      isReceived
        ? "Conferência atualizada. Estoque ajustado."
        : "Recebimento confirmado.",
    );
    onChanged?.();
    await load();
    setEditing(false);
    return true;
  };

  const canSaveConference = !!header?.token && items.length > 0;
  const issueLines = useMemo(() => {
    const lines: string[] = [];
    for (const it of items) {
      const st = draftStatus[it.id];
      if (st === "partial")
        lines.push(`${it.product_name}: quantidade parcial`);
      if (st === "not_received") lines.push(`${it.product_name}: não recebido`);
    }
    return lines;
  }, [draftStatus, items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="z-[80]"
        className={cn(
          "z-[80] flex h-[min(96vh,860px)] w-[min(96vw,720px)] max-w-none translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-none",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-3 pr-12 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
            <PackageCheck className="h-5 w-5 shrink-0" />
            {isReceived ? "Conferência do recebimento" : "Receber nota"}
            {header?.status === "received" ? (
              <Badge variant="default">Recebida</Badge>
            ) : (
              <Badge variant="secondary">Aguardando</Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {header
              ? `${header.supplierName}${
                  header.invoiceNumber ? ` · NF ${header.invoiceNumber}` : ""
                }`
              : "Carregando…"}
            {isReceived && canEdit
              ? " · Alterações ajustam o estoque na hora."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando itens…
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">Nenhum item nesta nota.</p>
          ) : (
            <div className="space-y-3">
              {issueLines.length > 0 && (
                <div className="rounded-lg border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-amber-950 dark:text-amber-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {issueLines.length} ite
                    {issueLines.length > 1 ? "ns" : "m"} com divergência
                  </p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-amber-950/90 dark:text-amber-100/90">
                    {issueLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {items.map((it) => {
                const st = draftStatus[it.id];
                const unit = itemUnit(it);
                const receiptIssue = st === "partial" || st === "not_received";
                const orderedQty = Number(it.quantity);
                const partialReceived = parseFloat(
                  (partialQty[it.id] ?? "").replace(",", "."),
                );
                const receivedQty =
                  st === "not_received"
                    ? 0
                    : st === "partial"
                      ? Number.isFinite(partialReceived)
                        ? partialReceived
                        : 0
                      : orderedQty;

                return (
                  <div
                    key={it.id}
                    className={cn(
                      "space-y-3 rounded-lg border p-3",
                      st === "not_received"
                        ? "border-red-300/70 bg-red-50/80 dark:border-red-800/50 dark:bg-red-950/25"
                        : st === "partial"
                          ? "border-amber-600/35 bg-amber-500/5"
                          : "bg-card",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex min-w-0 items-start gap-1.5 text-base font-semibold leading-snug">
                        {!receiptIssue && (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        )}
                        <span className="min-w-0">{it.product_name}</span>
                      </p>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-baseline gap-1 rounded-md border px-2.5 py-1",
                          st === "not_received"
                            ? "border-red-300 bg-red-100/80 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
                            : st === "partial"
                              ? "border-amber-500/50 bg-amber-100/80 text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
                              : "border-emerald-600/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
                        )}
                      >
                        {st === "partial" || st === "not_received" ? (
                          <>
                            <span className="text-lg font-bold tabular-nums leading-none">
                              {formatQty(receivedQty)}
                            </span>
                            <span className="text-md font-semibold leading-none opacity-80">
                              de {formatQty(orderedQty)} {unit}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-lg font-bold tabular-nums leading-none">
                              {formatQty(orderedQty)}
                            </span>
                            <span className="text-xs font-semibold uppercase opacity-85">
                              {unit}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    {canEdit ? (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant={st === "received" ? "default" : "outline"}
                            disabled={confirming}
                            onClick={() =>
                              setDraftStatus((prev) => ({
                                ...prev,
                                [it.id]: "received",
                              }))
                            }
                          >
                            Recebido
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={st === "partial" ? "default" : "outline"}
                            className={
                              st === "partial"
                                ? "bg-amber-600 text-white hover:bg-amber-700"
                                : ""
                            }
                            disabled={confirming}
                            onClick={() =>
                              setDraftStatus((prev) => ({
                                ...prev,
                                [it.id]: "partial",
                              }))
                            }
                          >
                            Parcial
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              st === "not_received" ? "destructive" : "outline"
                            }
                            disabled={confirming}
                            onClick={() =>
                              setDraftStatus((prev) => ({
                                ...prev,
                                [it.id]: "not_received",
                              }))
                            }
                          >
                            Não recebido
                          </Button>
                        </div>

                        {st === "partial" && (
                          <div className="rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2.5">
                            <Label
                              htmlFor={`qty-${it.id}`}
                              className="text-xs font-semibold text-amber-950 dark:text-amber-100"
                            >
                              Quantidade recebida
                            </Label>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Input
                                id={`qty-${it.id}`}
                                className="h-10 w-32 bg-background text-base font-semibold tabular-nums"
                                inputMode="decimal"
                                placeholder="0"
                                disabled={confirming}
                                value={partialQty[it.id] ?? ""}
                                onChange={(e) =>
                                  setPartialQty((prev) => ({
                                    ...prev,
                                    [it.id]: e.target.value,
                                  }))
                                }
                              />
                              <span className="text-sm text-muted-foreground">
                                de{" "}
                                <span className="font-medium tabular-nums text-foreground">
                                  {formatQty(Number(it.quantity))} {unit}
                                </span>{" "}
                                na nota
                              </span>
                            </div>
                          </div>
                        )}

                        {(st === "partial" || st === "not_received") && (
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`notes-${it.id}`}
                              className="text-xs font-medium text-muted-foreground"
                            >
                              Observações{" "}
                              <span className="font-normal">(opcional)</span>
                            </Label>
                            <Textarea
                              id={`notes-${it.id}`}
                              className="min-h-18 bg-background"
                              placeholder={
                                st === "partial"
                                  ? "Ex.: faltou volume, avaria na caixa…"
                                  : "Ex.: não veio no pedido, recusado na entrega…"
                              }
                              disabled={confirming}
                              value={itemNotes[it.id] ?? ""}
                              onChange={(e) =>
                                setItemNotes((prev) => ({
                                  ...prev,
                                  [it.id]: e.target.value,
                                }))
                              }
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-normal",
                            st === "received" &&
                              "border-emerald-600/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
                            st === "partial" &&
                              "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100",
                            st === "not_received" &&
                              "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
                          )}
                        >
                          {statusLabel(st)}
                        </Badge>
                        {(st === "partial" || st === "not_received") &&
                        (itemNotes[it.id] ?? "").trim() ? (
                          <p className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">
                              Observações:{" "}
                            </span>
                            {itemNotes[it.id]}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!header || copyingLink}
            onClick={() => void copyOperadorLink()}
          >
            {copyingLink ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            Compartilhar link
          </Button>
          {canSaveConference ? (
            isReceived && !editing ? (
              <Button
                type="button"
                disabled={loading}
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Editar conferência
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {isReceived && editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={confirming}
                    onClick={() => {
                      setEditing(false);
                      void load();
                    }}
                  >
                    Cancelar
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={confirming || loading}
                  onClick={() => void persistConference()}
                >
                  {confirming ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PackageCheck className="mr-2 h-4 w-4" />
                  )}
                  {isReceived ? "Salvar conferência" : "Confirmar recebimento"}
                </Button>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              Carregue a nota para confirmar.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

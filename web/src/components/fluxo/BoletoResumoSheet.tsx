import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCompetenceLabel } from "@/lib/boletoPayment";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import { cn } from "@/lib/utils";
import type { BoletoFlowType, PaymentType } from "@/types/expense";
import { isBoletoPayable, isBoletoTransfer } from "@/types/expense";
import type { FluxoBoletoRow } from "@/types/expenseSeries";
import {
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  PackageSearch,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const STATUS_LABELS: Record<FluxoBoletoRow["status"], string> = {
  pending: "Pendente",
  paid: "Pago",
};

function ResumoFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
        {value}
      </div>
    </div>
  );
}

function CopyableField({
  label,
  value,
  copiedMessage,
}: {
  label: string;
  value: string;
  copiedMessage: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 break-all font-mono text-sm text-muted-foreground">
            {value}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(copiedMessage);
          }}
        >
          <Copy className="mr-2 h-4 w-4" />
          Copiar
        </Button>
      </div>
    </div>
  );
}

export function BoletoResumoSheet({
  boleto,
  open,
  onOpenChange,
  flowType,
  formatCurrency,
  formatDate,
  categoryLabel,
  bankAccountName,
  pendingMerchandise,
  canDelete,
  deleting,
  onEdit,
  onEditSeries,
  onMarkPaid,
  onPayPartial,
  onUndoPay,
  onViewExpense,
  onDelete,
}: {
  boleto: FluxoBoletoRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowType: BoletoFlowType;
  formatCurrency: (value: number) => string;
  formatDate: (value: string) => string;
  categoryLabel: (boleto: FluxoBoletoRow) => string;
  bankAccountName: string | null;
  pendingMerchandise: boolean;
  canDelete: boolean;
  deleting: boolean;
  onEdit: () => void;
  onEditSeries: () => void;
  onMarkPaid: () => void;
  onPayPartial: () => void;
  onUndoPay: () => void;
  onViewExpense: () => void;
  onDelete: () => void;
}) {
  const payable = boleto ? isBoletoPayable(boleto) : false;
  const projected = boleto ? isProjectedBoleto(boleto) : false;
  const transfer = boleto ? isBoletoTransfer(boleto) : false;
  const paymentType = boleto?.payment_type ?? "boleto";
  const displayAmount =
    boleto?.status === "paid" && boleto.paid_amount != null
      ? boleto.paid_amount
      : (boleto?.amount ?? 0);
  const hasOriginalDiff =
    !!boleto &&
    boleto.status === "paid" &&
    boleto.paid_amount != null &&
    boleto.paid_amount !== boleto.amount;
  const supplier = boleto
    ? boleto.supplier?.name?.trim() || null
    : null;
  const canMarkSettled =
    !!boleto && boleto.status === "pending" && !projected;
  const canEdit = flowType === "payable" && canMarkSettled;
  const canEditSeries =
    flowType === "payable" &&
    !!boleto &&
    (projected || !!boleto.series_master_expense_id);
  const canPayPartial =
    flowType === "payable" &&
    canMarkSettled &&
    payable &&
    !transfer;
  const canUndoPay =
    flowType === "payable" &&
    !!boleto &&
    boleto.status === "paid" &&
    !projected &&
    payable;
  const canViewExpense = !!boleto?.expense_id && !projected;
  const showBarcode =
    canMarkSettled && paymentType === "boleto" && !!boleto?.barcode;
  const showPix = canMarkSettled && paymentType === "pix" && !!boleto?.pix_key;
  const showTed =
    canMarkSettled &&
    paymentType === "ted" &&
    !!(boleto?.bank_name || boleto?.agency || boleto?.account);
  const hasPaymentDetails = showBarcode || showPix || showTed;
  const hasSecondaryActions =
    canEdit || canEditSeries || canPayPartial || canUndoPay || canViewExpense;
  const hasFooter = canMarkSettled || hasSecondaryActions || canDelete;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="z-[60] flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0"
        overlayClassName="z-[60]"
      >
        {boleto ? (
          <>
            <SheetHeader className="shrink-0 space-y-2 border-b px-6 py-4 pr-12 text-left">
              <SheetTitle>Resumo da conta</SheetTitle>
              <SheetDescription>
                {payable ? "Dados para pagamento" : "Dados do recebimento"}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge
                  variant="outline"
                  className={
                    payable
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                  }
                >
                  {payable ? "Conta a pagar" : "Conta a receber"}
                </Badge>
                {projected ? (
                  <Badge
                    variant="outline"
                    className="border-sky-600/30 bg-sky-500/10 text-sky-900 dark:text-sky-100"
                  >
                    Ocorrência projetada
                  </Badge>
                ) : (
                  <Badge
                    variant={boleto.status === "paid" ? "default" : "outline"}
                  >
                    {boleto.status === "paid"
                      ? payable
                        ? "Pago"
                        : "Recebido"
                      : STATUS_LABELS.pending}
                  </Badge>
                )}
                {transfer ? (
                  <Badge variant="outline">Transferência</Badge>
                ) : null}
                {boleto.split_from_boleto_id ? (
                  <Badge
                    variant="outline"
                    className="border-violet-600/30 bg-violet-500/10 text-violet-900 dark:text-violet-100"
                  >
                    Saldo restante
                  </Badge>
                ) : null}
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {payable ? "A pagar" : "A receber"}
                    </p>
                    <p className="mt-1 text-lg font-semibold leading-tight">
                      {formatBoletoFluxoDescription(boleto)}
                    </p>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <p
                      className={cn(
                        "text-3xl font-bold tabular-nums tracking-tight",
                        payable
                          ? "text-destructive"
                          : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {formatCurrency(displayAmount)}
                    </p>
                    {hasOriginalDiff ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Original: {formatCurrency(boleto.amount)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ResumoFact
                  label="Vencimento"
                  value={
                    <span className="tabular-nums">
                      {formatDate(boleto.due_date)}
                    </span>
                  }
                />
                <ResumoFact
                  label="Categoria"
                  value={transfer ? "Transferência" : categoryLabel(boleto)}
                />
                {payable && !transfer ? (
                  <ResumoFact
                    label="Forma"
                    value={PAYMENT_TYPE_LABELS[paymentType]}
                  />
                ) : null}
                {supplier ? (
                  <ResumoFact label="Fornecedor" value={supplier} />
                ) : null}
                {boleto.provider && boleto.provider !== supplier ? (
                  <ResumoFact label="Emissor" value={boleto.provider} />
                ) : null}
                {boleto.status === "paid" && payable && boleto.paid_at ? (
                  <ResumoFact
                    label="Pago em"
                    value={
                      <span className="tabular-nums">
                        {formatDate(boleto.paid_at)}
                      </span>
                    }
                  />
                ) : null}
                {boleto.status === "paid" && boleto.competence_date ? (
                  <ResumoFact
                    label="Competência"
                    value={formatCompetenceLabel(boleto.competence_date)}
                  />
                ) : null}
                {boleto.status === "paid" && bankAccountName ? (
                  <ResumoFact label="Conta" value={bankAccountName} />
                ) : null}
              </div>

              {pendingMerchandise ? (
                <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
                  <PackageSearch className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Mercadoria ainda não recebida</p>
                    <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-100/90">
                      Esta conta está vinculada a uma NF ou romaneio sem
                      recebimento confirmado. Confirme a mercadoria antes de
                      pagar.
                    </p>
                  </div>
                </div>
              ) : null}

              {hasPaymentDetails ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Dados para pagamento</p>
                  {showBarcode ? (
                    <CopyableField
                      label="Código de barras"
                      value={boleto.barcode ?? ""}
                      copiedMessage="Código copiado"
                    />
                  ) : null}
                  {showPix ? (
                    <CopyableField
                      label="Chave PIX"
                      value={boleto.pix_key ?? ""}
                      copiedMessage="Chave copiada"
                    />
                  ) : null}
                  {showTed ? (
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {boleto.bank_name ? (
                        <ResumoFact label="Banco" value={boleto.bank_name} />
                      ) : null}
                      {boleto.bank_code ? (
                        <ResumoFact label="Código" value={boleto.bank_code} />
                      ) : null}
                      {boleto.agency ? (
                        <ResumoFact label="Agência" value={boleto.agency} />
                      ) : null}
                      {boleto.account ? (
                        <ResumoFact label="Conta" value={boleto.account} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {hasFooter ? (
              <SheetFooter className="shrink-0 gap-2 border-t px-6 py-4">
                {canMarkSettled ? (
                  <Button type="button" className="w-full" onClick={onMarkPaid}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {payable ? "Marcar como pago" : "Marcar como recebido"}
                  </Button>
                ) : null}
                {hasSecondaryActions ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto sm:flex-1"
                        onClick={onEdit}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar conta
                      </Button>
                    ) : null}
                    {canEditSeries ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto sm:flex-1"
                        onClick={onEditSeries}
                      >
                        Editar ocorrência / série
                      </Button>
                    ) : null}
                    {canPayPartial ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto sm:flex-1"
                        onClick={onPayPartial}
                      >
                        Pagar parcialmente
                      </Button>
                    ) : null}
                    {canUndoPay ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto sm:flex-1"
                        onClick={onUndoPay}
                      >
                        <Undo2 className="mr-2 h-4 w-4" />
                        Desfazer pagamento
                      </Button>
                    ) : null}
                    {canViewExpense ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto sm:flex-1"
                        onClick={onViewExpense}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Ver nota fiscal
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {canDelete ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={deleting}
                    onClick={onDelete}
                  >
                    {deleting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Excluir conta
                  </Button>
                ) : null}
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

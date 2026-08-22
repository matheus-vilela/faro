import { CreateBankAccountSheet } from "@/components/CreateBankAccountSheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computePaidAmount,
  competenceDateFromMonthInput,
  isValidPartialPayAmount,
  localDateYmd,
  monthInputFromYmd,
  parseNonNegativeAmount,
  remainderAmount,
} from "@/lib/boletoPayment";
import { splitPayBoleto } from "@/lib/boletoPaymentApi";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import { supabase } from "@/lib/supabase";
import { bankAccountTypeLabel, type CompanyBankAccount } from "@/types/bankAccount";
import type { Boleto } from "@/types/expense";
import { isBoletoTransfer } from "@/types/expense";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface PayBoletoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boleto: Boleto | null;
  companyId: string;
  supplierName?: string | null;
  /** Abre já no modo de pagamento parcial. */
  initialPartial?: boolean;
  onSuccess: (updated: Boleto) => void;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function formatDate(ymd: string) {
  const s = ymd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ymd;
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export function PayBoletoDialog({
  open,
  onOpenChange,
  boleto,
  companyId,
  supplierName,
  initialPartial = false,
  onSuccess,
}: PayBoletoDialogProps) {
  const [paymentDate, setPaymentDate] = useState("");
  const [competenceMonth, setCompetenceMonth] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [interest, setInterest] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccount[]>([]);
  const [createBankOpen, setCreateBankOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [partial, setPartial] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [remainderDueDate, setRemainderDueDate] = useState("");

  const allowPartial = !!boleto && !isBoletoTransfer(boleto);
  const originalAmount = boleto?.amount ?? 0;
  const payAmountNum = parseNonNegativeAmount(payAmount);
  const interestNum = parseNonNegativeAmount(interest);
  const discountNum = parseNonNegativeAmount(discount);
  const faceAmount = partial ? payAmountNum : originalAmount;
  const remaining = remainderAmount(originalAmount, payAmountNum);
  const partialValid = isValidPartialPayAmount(originalAmount, payAmountNum);
  const finalAmount = useMemo(
    () => computePaidAmount(faceAmount, interestNum, discountNum),
    [faceAmount, interestNum, discountNum],
  );

  const loadBankAccounts = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("company_bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      setBankAccounts([]);
      return;
    }
    setBankAccounts((data ?? []) as CompanyBankAccount[]);
  }, [companyId]);

  useEffect(() => {
    if (!open || !boleto) return;
    setPaymentDate(localDateYmd());
    setCompetenceMonth(monthInputFromYmd(boleto.due_date));
    setBankAccountId(boleto.company_bank_account_id ?? "");
    setInterest("0");
    setDiscount("0");
    setPartial(allowPartial && initialPartial);
    setPayAmount("");
    setRemainderDueDate("");
    void loadBankAccounts();
  }, [open, boleto, loadBankAccounts, allowPartial, initialPartial]);

  const canSubmit =
    !!boleto &&
    !isProjectedBoleto(boleto) &&
    paymentDate.trim() !== "" &&
    competenceMonth.trim() !== "" &&
    bankAccountId !== "" &&
    bankAccountId !== "__create__" &&
    finalAmount > 0 &&
    !submitting &&
    (!partial ||
      (partialValid && remainderDueDate.trim() !== ""));

  const handleBankAccountChange = (value: string) => {
    if (value === "__create__") {
      setCreateBankOpen(true);
      return;
    }
    setBankAccountId(value);
  };

  const handleSubmit = async () => {
    if (!boleto || !companyId || !canSubmit) return;
    if (isProjectedBoleto(boleto)) {
      toast.error(
        "Esta ocorrência ainda é projetada. Edite e materialize antes de marcar como paga.",
      );
      return;
    }

    const competenceDate = competenceDateFromMonthInput(competenceMonth);
    if (!competenceDate) {
      toast.error("Informe uma competência válida.");
      return;
    }

    setSubmitting(true);
    const paidAt = paymentDate.trim().slice(0, 10);

    if (partial && allowPartial) {
      try {
        const result = await splitPayBoleto({
          boletoId: boleto.id,
          companyId,
          payAmount: payAmountNum,
          paidAt,
          competenceDate,
          bankAccountId,
          interestAmount: interestNum,
          discountAmount: discountNum,
          remainderDueDate: remainderDueDate.trim().slice(0, 10),
        });
        setSubmitting(false);
        onOpenChange(false);
        onSuccess(result.paid);
        toast.success(
          `Pagamento parcial registrado. Saldo de ${formatCurrency(result.remainder.amount)} com vencimento em ${formatDate(result.remainder.due_date)}.`,
        );
      } catch (err) {
        setSubmitting(false);
        toast.error(
          err instanceof Error
            ? err.message
            : "Não foi possível registrar o pagamento parcial.",
        );
      }
      return;
    }

    const updatedAt = new Date().toISOString();
    const primaryUpdate = {
      status: "paid" as const,
      paid_at: paidAt,
      competence_date: competenceDate,
      company_bank_account_id: bankAccountId,
      interest_amount: interestNum,
      discount_amount: discountNum,
      paid_amount: finalAmount,
      updated_at: updatedAt,
    };

    const { data, error } = await supabase
      .from("boletos")
      .update(primaryUpdate)
      .eq("id", boleto.id)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) {
      setSubmitting(false);
      toast.error(error.message ?? "Não foi possível registrar o pagamento.");
      return;
    }

    if (
      isBoletoTransfer(boleto) &&
      boleto.transfer_group_id &&
      data
    ) {
      const counterpartUpdate = {
        status: "paid" as const,
        paid_at: paidAt,
        competence_date: competenceDate,
        interest_amount: 0,
        discount_amount: 0,
        paid_amount: Number(boleto.amount) || finalAmount,
        updated_at: updatedAt,
      };
      const { error: pairErr } = await supabase
        .from("boletos")
        .update(counterpartUpdate)
        .eq("company_id", companyId)
        .eq("transfer_group_id", boleto.transfer_group_id)
        .eq("entry_kind", "transfer")
        .neq("id", boleto.id)
        .eq("status", "pending");
      if (pairErr) {
        console.error(pairErr);
        toast.error(
          "Pagamento registrado, mas a contraparte da transferência não foi quitada.",
        );
        setSubmitting(false);
        onOpenChange(false);
        onSuccess(data as Boleto);
        return;
      }
    }

    setSubmitting(false);
    onOpenChange(false);
    onSuccess(data as Boleto);
    toast.success(
      isBoletoTransfer(boleto)
        ? "Transferência quitada com sucesso."
        : "Pagamento registrado com sucesso.",
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && submitting) return;
          onOpenChange(next);
        }}
      >
        <DialogContent
          overlayClassName="z-[80]"
          className="z-[80] sm:max-w-lg max-h-[90vh] overflow-y-auto"
          onPointerDownOutside={(e) => submitting && e.preventDefault()}
          onEscapeKeyDown={(e) => submitting && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {boleto && isBoletoTransfer(boleto)
                ? "Quitar transferência"
                : partial
                  ? "Pagamento parcial"
                  : "Registrar pagamento"}
            </DialogTitle>
            <DialogDescription>
              {boleto && isBoletoTransfer(boleto)
                ? "Ao confirmar, a saída e a entrada da transferência serão quitadas."
                : partial
                  ? "A parte paga é quitada e o saldo vira uma nova conta com o vencimento informado."
                  : "Informe os dados do pagamento desta conta a pagar."}
            </DialogDescription>
          </DialogHeader>

          {boleto && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium">
                  {formatBoletoFluxoDescription(boleto)}
                </p>
                <p className="text-muted-foreground tabular-nums mt-1">
                  {formatCurrency(boleto.amount)} · venc.{" "}
                  {formatDate(boleto.due_date)}
                </p>
                {supplierName ? (
                  <p className="text-muted-foreground mt-1">{supplierName}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="payment-date">Data do pagamento</Label>
                  <Input
                    id="payment-date"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="competence-month">Competência</Label>
                  <Input
                    id="competence-month"
                    type="month"
                    value={competenceMonth}
                    onChange={(e) => setCompetenceMonth(e.target.value)}
                    required
                  />
                </div>
              </div>

              {allowPartial && (
                <div className="space-y-3 rounded-lg border p-3">
                  <label
                    htmlFor="partial-pay"
                    className="flex items-start gap-2 cursor-pointer"
                  >
                    <Checkbox
                      id="partial-pay"
                      checked={partial}
                      onCheckedChange={setPartial}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <span className="font-medium">Pagar apenas uma parte</span>
                      <span className="block text-muted-foreground text-xs mt-0.5">
                        O valor restante vira uma nova conta com outro vencimento.
                      </span>
                    </span>
                  </label>
                  {partial && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="pay-amount">Valor a pagar (R$)</Label>
                        <Input
                          id="pay-amount"
                          type="number"
                          step="0.01"
                          min="0"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder="0,00"
                        />
                      </div>
                      <div>
                        <Label htmlFor="remainder-due">
                          Vencimento do saldo
                        </Label>
                        <Input
                          id="remainder-due"
                          type="date"
                          value={remainderDueDate}
                          onChange={(e) => setRemainderDueDate(e.target.value)}
                        />
                      </div>
                      {partialValid ? (
                        <p className="sm:col-span-2 text-xs text-muted-foreground">
                          Saldo restante: {formatCurrency(remaining)}
                        </p>
                      ) : (
                        <p className="sm:col-span-2 text-xs text-destructive">
                          Informe um valor maior que zero e menor que{" "}
                          {formatCurrency(originalAmount)}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label>Conta usada para pagar</Label>
                <Select
                  value={bankAccountId === "__create__" ? "" : bankAccountId}
                  onValueChange={handleBankAccountChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione a conta bancária" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    sideOffset={4}
                    className="z-[90]"
                  >
                    {bankAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} — {bankAccountTypeLabel(a.tipo)}
                      </SelectItem>
                    ))}
                    <SelectItem
                      value="__create__"
                      className="text-primary font-medium"
                    >
                      <Plus className="h-4 w-4 inline mr-2" />
                      Nova conta bancária
                    </SelectItem>
                  </SelectContent>
                </Select>
                {bankAccounts.length === 0 && !bankAccountId && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Nenhuma conta cadastrada.{" "}
                    <button
                      type="button"
                      onClick={() => setCreateBankOpen(true)}
                      className="text-primary underline"
                    >
                      Cadastrar conta
                    </button>
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="interest">Juros (R$)</Label>
                  <Input
                    id="interest"
                    type="number"
                    step="0.01"
                    min="0"
                    value={interest}
                    onChange={(e) => setInterest(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
                <div>
                  <Label htmlFor="discount">Desconto (R$)</Label>
                  <Input
                    id="discount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div className="rounded-lg border px-3 py-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">
                    {partial ? "Valor desta parte" : "Valor original"}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(faceAmount)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 border-t pt-2">
                  <span className="font-medium">Valor final</span>
                  <span
                    className={`font-bold tabular-nums ${
                      finalAmount <= 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatCurrency(finalAmount)}
                  </span>
                </div>
                {finalAmount <= 0 && (
                  <p className="text-xs text-destructive">
                    O valor final deve ser maior que zero.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
            >
              {submitting
                ? "Registrando..."
                : partial
                  ? "Confirmar pagamento parcial"
                  : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateBankAccountSheet
        open={createBankOpen}
        onOpenChange={setCreateBankOpen}
        companyId={companyId}
        contentClassName="z-[90]"
        overlayClassName="z-[90]"
        onSuccess={(account) => {
          setBankAccounts((prev) =>
            [...prev, account].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
          );
          setBankAccountId(account.id);
        }}
      />
    </>
  );
}

import { Button } from "@/components/ui/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  materializeSeriesMonth,
  scheduledAdjustmentFromForm,
  upsertScheduledAdjustment,
} from "@/lib/expenseSeriesApi";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import type { FluxoBoletoRow, SeriesEditScope } from "@/types/expenseSeries";
import type { ExpenseSeriesMaster } from "@/types/expenseSeries";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boleto: FluxoBoletoRow | null;
  master: ExpenseSeriesMaster | null;
  onSuccess: () => void;
};

export function SeriesBoletoActionsSheet({
  open,
  onOpenChange,
  boleto,
  master,
  onSuccess,
}: Props) {
  const [scope, setScope] = useState<SeriesEditScope>("single_month");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !boleto) return;
    setAmount(String(boleto.amount));
    setDueDate(boleto.due_date.slice(0, 10));
    setScope("single_month");
  }, [open, boleto]);

  if (!boleto || !master) return null;

  const monthKey = boleto.due_date.slice(0, 7);
  const projected = isProjectedBoleto(boleto);

  const handleSave = async () => {
    if (!master || !boleto) return;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0 || !dueDate.trim()) {
      toast.error("Informe valor e vencimento válidos.");
      return;
    }
    setLoading(true);
    const dueYmd = dueDate.trim();
    const adjustment = scheduledAdjustmentFromForm(monthKey, amt, dueYmd);
    const anchorOpts = {
      anchorBoleto: master.anchor_boleto,
      syncAnchorDueDateYmd: dueYmd,
    };
    try {
      if (scope === "single_month") {
        await materializeSeriesMonth({
          companyId: master.company_id,
          masterExpenseId: master.id,
          occurrenceMonth: `${monthKey}-01`,
          amount: amt,
          dueDate: dueDate.trim(),
          description: boleto.description,
          paymentType: boleto.payment_type ?? "boleto",
          anchorBoleto: master.anchor_boleto,
          masterDisplayName: master.display_name,
          supplierName: master.supplier_name,
        });
        toast.success("Ocorrência materializada como despesa real.");
      } else if (scope === "from_month") {
        await upsertScheduledAdjustment(master.id, adjustment, anchorOpts);
        toast.success(
          "Ajuste salvo na série. Meses futuros passam a usar o novo valor e dia de vencimento.",
        );
      } else {
        await upsertScheduledAdjustment(master.id, adjustment, {
          replaceUntilNext: true,
          ...anchorOpts,
        });
        toast.success("Ajuste aplicado até a próxima regra cadastrada.");
      }
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível salvar a alteração.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="z-[70] sm:max-w-md"
        overlayClassName="z-[70]"
      >
        <SheetHeader>
          <SheetTitle>
            {projected ? "Editar ocorrência projetada" : "Editar exceção da série"}
          </SheetTitle>
          <SheetDescription>
            {projected
              ? "Escolha se a alteração vale só para este mês (cria registro real) ou para meses futuros (ajuste na série)."
              : "Esta conta já é um lançamento real vinculado à série."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Como aplicar esta alteração</Label>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as SeriesEditScope)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Escolha o escopo" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                sideOffset={4}
                className="z-[200] max-h-[min(280px,50vh)]"
              >
                <SelectItem value="single_month">
                  Somente este mês
                </SelectItem>
                <SelectItem value="from_month">
                  A partir deste mês em diante
                </SelectItem>
                <SelectItem value="until_next_adjustment">
                  Até a próxima alteração já cadastrada
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Vencimento</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>
        <SheetFooter>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Salvando..." : "Salvar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

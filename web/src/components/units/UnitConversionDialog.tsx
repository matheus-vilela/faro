import { Button } from "@/components/ui/button";
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
import { formatUnitLabelFromCodes } from "@/lib/companyUnits/convert";
import { useEffect, useMemo, useState } from "react";

export type UnitOption = { code: string; label: string };

interface UnitConversionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unidade de estoque do produto (principal para conversão). */
  primaryUnit: UnitOption | null;
  secondaryUnits: UnitOption[];
  onSave: (payload: {
    primary_qty: number;
    secondary_unit_code: string;
    secondary_qty: number;
  }) => Promise<void>;
  saving?: boolean;
}

export function UnitConversionDialog({
  open,
  onOpenChange,
  primaryUnit,
  secondaryUnits,
  onSave,
  saving,
}: UnitConversionDialogProps) {
  const [primaryQty, setPrimaryQty] = useState("1");
  const [secondaryCode, setSecondaryCode] = useState("");
  const [secondaryQty, setSecondaryQty] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrimaryQty("1");
    setSecondaryCode(secondaryUnits[0]?.code ?? "");
    setSecondaryQty("");
  }, [open, secondaryUnits]);

  const canSubmit = useMemo(() => {
    const p = parseFloat(primaryQty.replace(",", "."));
    const s = parseFloat(secondaryQty.replace(",", "."));
    return (
      secondaryCode &&
      Number.isFinite(p) &&
      p > 0 &&
      Number.isFinite(s) &&
      s > 0
    );
  }, [primaryQty, secondaryQty, secondaryCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!primaryUnit || !canSubmit) return;
    const p = parseFloat(primaryQty.replace(",", "."));
    const s = parseFloat(secondaryQty.replace(",", "."));
    await onSave({
      primary_qty: p,
      secondary_unit_code: secondaryCode,
      secondary_qty: s,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Nova conversão</DialogTitle>
            <DialogDescription>
              Equivalência entre a unidade de estoque deste produto e outra
              unidade do catálogo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
              <p className="font-medium text-foreground">Unidade de estoque</p>
              <p className="text-muted-foreground">
                {primaryUnit
                  ? formatUnitLabelFromCodes(primaryUnit.code)
                  : "—"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <Label htmlFor="conv-pqty">Quantidade</Label>
                <Input
                  id="conv-pqty"
                  inputMode="decimal"
                  value={primaryQty}
                  onChange={(e) => setPrimaryQty(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div className="pb-2 text-sm font-medium text-muted-foreground">
                {primaryUnit?.label ?? "—"}
              </div>
            </div>
            <p className="text-center text-sm font-medium text-muted-foreground">
              é equivalente a
            </p>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <Label htmlFor="conv-sqty">Quantidade</Label>
                <Input
                  id="conv-sqty"
                  inputMode="decimal"
                  value={secondaryQty}
                  onChange={(e) => setSecondaryQty(e.target.value)}
                  placeholder="Ex.: 750"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Unidade secundária</Label>
                <Select value={secondaryCode} onValueChange={setSecondaryCode}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {secondaryUnits.map((u) => (
                      <SelectItem key={u.code} value={u.code}>
                        {formatUnitLabelFromCodes(u.code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || saving}>
              {saving ? "Salvando…" : "Salvar conversão"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

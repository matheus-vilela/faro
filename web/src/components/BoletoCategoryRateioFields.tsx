import { BoletoCategoryPicker } from "@/components/BoletoCategoryPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  amountFromPercent,
  emptyRateioLine,
  percentOfTotal,
  remainingToRateio,
  type RateioDraftLine,
} from "@/lib/boletoCategoryRateio";
import { roundMoney } from "@/lib/boletoPayment";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import { Plus, Trash2 } from "lucide-react";

function formatRemaining(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function BoletoCategoryRateioFields({
  companyId,
  categories,
  loading,
  onReload,
  categoryNatureza,
  totalAmount,
  enabled,
  onEnabledChange,
  lines,
  onLinesChange,
  disabled,
}: {
  companyId: string;
  categories: CompanyCategory[];
  loading: boolean;
  onReload: () => void | Promise<void>;
  categoryNatureza: "DESPESA" | "RECEITA";
  totalAmount: number;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  lines: RateioDraftLine[];
  onLinesChange: (lines: RateioDraftLine[]) => void;
  disabled?: boolean;
}) {
  const remaining = remainingToRateio(lines, totalAmount);
  const remainingTone =
    remaining === 0
      ? "text-emerald-700 dark:text-emerald-400"
      : remaining < 0
        ? "text-destructive"
        : "text-amber-700 dark:text-amber-400";

  const updateLine = (key: string, patch: Partial<RateioDraftLine>) => {
    onLinesChange(
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
          enabled
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-muted/50",
        )}
      >
        <div>
          <Label htmlFor="boleto-rateio-switch" className="pb-0 text-sm">
            Ratear entre categorias
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Divida o valor desta conta em mais de uma classificação.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {enabled ? "Sim" : "Não"}
          </span>
          <Switch
            id="boleto-rateio-switch"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={onEnabledChange}
            className={cn(
              "border-2",
              "data-[state=unchecked]:border-muted-foreground data-[state=unchecked]:bg-muted",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
              "[&_span]:bg-white dark:[&_span]:bg-zinc-100",
              "data-[state=checked]:[&_span]:bg-primary-foreground",
            )}
          />
        </div>
      </div>

      {enabled ? (
        <div className="space-y-3 rounded-lg border p-3">
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-2 sm:grid-cols-[1fr_7rem_5.5rem_auto] sm:items-end"
            >
              <div className="min-w-0">
                {index === 0 ? <Label>Categoria</Label> : null}
                <BoletoCategoryPicker
                  companyId={companyId}
                  value={line.categoryId}
                  onValueChange={(id) => updateLine(line.key, { categoryId: id })}
                  categories={categories}
                  loading={loading}
                  categoryNatureza={categoryNatureza}
                  onReload={onReload}
                  disabled={disabled}
                  compact
                />
              </div>
              <div>
                {index === 0 ? <Label>Valor (R$)</Label> : null}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number.isFinite(line.amount) ? String(line.amount) : ""}
                  disabled={disabled}
                  onChange={(e) =>
                    updateLine(line.key, {
                      amount: roundMoney(parseFloat(e.target.value) || 0),
                    })
                  }
                />
              </div>
              <div>
                {index === 0 ? <Label>%</Label> : null}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={percentOfTotal(line.amount, totalAmount)}
                  disabled={disabled || totalAmount <= 0}
                  onChange={(e) =>
                    updateLine(line.key, {
                      amount: amountFromPercent(
                        parseFloat(e.target.value) || 0,
                        totalAmount,
                      ),
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(index === 0 && "sm:mb-0.5")}
                disabled={disabled || lines.length <= 2}
                onClick={() =>
                  onLinesChange(lines.filter((row) => row.key !== line.key))
                }
                aria-label="Remover categoria"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onLinesChange([...lines, emptyRateioLine()])}
            >
              <Plus className="h-4 w-4" />
              Adicionar categoria
            </Button>
            <p className={cn("text-sm font-medium tabular-nums", remainingTone)}>
              Restante a ratear: {formatRemaining(remaining)}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

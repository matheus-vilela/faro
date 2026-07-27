import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseOpeningBalance } from "@/lib/cashFlowSimulation/computeCashFlowProjection";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";

function formatInputValue(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseCurrencyInput(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  return parseOpeningBalance(normalized);
}

export function CashFlowOpeningBalanceInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(formatInputValue(value));

  useEffect(() => {
    setDraft(formatInputValue(value));
  }, [value]);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-primary/25 bg-linear-to-br from-primary/12 via-primary/5 to-transparent p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between dark:from-primary/15 dark:via-primary/8",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-inner ring-1 ring-primary/20"
          aria-hidden
        >
          <Wallet className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Saldo inicial</p>
          <p className="text-xs text-muted-foreground">
            Informe o caixa disponível hoje. Salvo localmente neste navegador.
          </p>
        </div>
      </div>

      <div className="w-full sm:w-52">
        <Label htmlFor="cashflow-opening-balance" className="sr-only">
          Saldo inicial
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            R$
          </span>
          <Input
            id="cashflow-opening-balance"
            inputMode="decimal"
            placeholder="0,00"
            disabled={disabled}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const parsed = parseCurrencyInput(draft);
              onChange(parsed);
              setDraft(formatInputValue(parsed));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="pl-10 text-right tabular-nums"
          />
        </div>
        {value !== 0 ? (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {formatBrl(value)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

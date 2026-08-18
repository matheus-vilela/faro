import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseOpeningBalance } from "@/lib/cashFlowSimulation/computeCashFlowProjection";
import type { OpeningBalanceHint } from "@/lib/cashFlowSimulation/types";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";
import { Lightbulb, Wallet } from "lucide-react";
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

function formatYmdBr(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

export function CashFlowOpeningBalanceInput({
  value,
  onChange,
  hint,
  loadingHint,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  hint: OpeningBalanceHint | null;
  loadingHint?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(formatInputValue(value));

  useEffect(() => {
    setDraft(formatInputValue(value));
  }, [value]);

  const hasPaidActivity30 =
    hint != null && (hint.paidInflows30 > 0 || hint.paidOutflows30 > 0);

  const hasOverduePending =
    hint != null &&
    (hint.overduePendingPayablesAmount > 0 ||
      hint.overduePendingReceivablesAmount > 0);

  const hasAccountsBalance =
    hint != null && hint.accountsWithBalanceCount > 0;

  const hasOfxBalance = hint != null && hint.ofxBalanceTotal != null;

  const showHintCard =
    hasAccountsBalance || hasOfxBalance || hasPaidActivity30;

  const ofxLabel = (() => {
    if (!hint || hint.ofxBalanceTotal == null) return null;
    const parts = [`${formatBrl(hint.ofxBalanceTotal)}`];
    if (hint.ofxBalanceAsOfYmd) {
      parts.push(formatYmdBr(hint.ofxBalanceAsOfYmd));
    }
    if (hint.ofxAccountCount > 1) {
      parts.push(`${hint.ofxAccountCount} contas`);
    } else if (hint.ofxFileName) {
      parts.push(hint.ofxFileName);
    }
    return parts.join(" · ");
  })();

  return (
    <div className="space-y-3">
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
              Caixa disponível hoje. Prefira o saldo das contas ou do último
              OFX. Salvo neste navegador.
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

      {!loadingHint && showHintCard && hint ? (
        <div className="rounded-xl border border-border/80 bg-muted/30 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p className="font-medium text-foreground">Referência de caixa</p>
              <ul className="space-y-1 text-muted-foreground">
                {hasAccountsBalance ? (
                  <li>
                    Contas bancárias: {formatBrl(hint.accountsBalanceTotal)}
                    {hint.accountsWithBalanceCount > 1
                      ? ` (${hint.accountsWithBalanceCount} contas)`
                      : ""}
                  </li>
                ) : null}
                {hasOfxBalance ? (
                  <li>
                    Último OFX: {ofxLabel}
                  </li>
                ) : null}
                {hasPaidActivity30 ? (
                  <li>
                    Últimos 30 dias: entrou {formatBrl(hint.paidInflows30)}, saiu{" "}
                    {formatBrl(hint.paidOutflows30)} (
                    <span
                      className={
                        hint.netPaid30 >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      líquido {formatBrl(hint.netPaid30)}
                    </span>
                    )
                  </li>
                ) : null}
                {hasOverduePending ? (
                  <li>
                    Vencidas pendentes: a pagar{" "}
                    {formatBrl(hint.overduePendingPayablesAmount)}, a receber{" "}
                    {formatBrl(hint.overduePendingReceivablesAmount)}
                  </li>
                ) : null}
              </ul>
              <p className="text-xs text-muted-foreground">
                O saldo das contas e do OFX é o caixa real. O líquido de 30 dias
                é só movimento, não o dinheiro na conta.
              </p>
              <div className="flex flex-wrap gap-2">
                {hasAccountsBalance ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange(hint.accountsBalanceTotal)}
                  >
                    Usar saldo das contas ({formatBrl(hint.accountsBalanceTotal)})
                  </Button>
                ) : null}
                {hasOfxBalance && hint.ofxBalanceTotal != null ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange(hint.ofxBalanceTotal ?? 0)}
                  >
                    Usar saldo do último OFX ({formatBrl(hint.ofxBalanceTotal)})
                  </Button>
                ) : null}
                {hasPaidActivity30 && !hasAccountsBalance && !hasOfxBalance ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange(hint.netPaid30)}
                  >
                    Usar líquido dos últimos 30 dias ({formatBrl(hint.netPaid30)})
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

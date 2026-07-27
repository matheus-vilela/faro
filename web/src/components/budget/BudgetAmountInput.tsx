import { Input } from "@/components/ui/input";
import { parseOpeningBalance } from "@/lib/cashFlowSimulation/computeCashFlowProjection";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

export function BudgetAmountInput({
  value,
  onSave,
  disabled,
  saving,
  className,
}: {
  value: number;
  onSave: (amount: number) => Promise<void>;
  disabled?: boolean;
  saving?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(formatInputValue(value));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(value);

  useEffect(() => {
    if (saving) return;
    setDraft(formatInputValue(value));
    lastSavedRef.current = value;
  }, [value, saving]);

  const commit = (raw: string) => {
    const parsed = parseCurrencyInput(raw);
    setDraft(formatInputValue(parsed));
    if (parsed === lastSavedRef.current) return;
    lastSavedRef.current = parsed;
    void onSave(parsed);
  };

  const scheduleCommit = (raw: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(raw), 500);
  };

  return (
    <div className={cn("relative min-w-[7rem]", className)}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        R$
      </span>
      <Input
        inputMode="decimal"
        placeholder="0,00"
        disabled={disabled || saving}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          scheduleCommit(e.target.value);
        }}
        onBlur={() => {
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 pl-8 pr-7 text-right text-sm tabular-nums"
      />
      {saving ? (
        <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}
    </div>
  );
}

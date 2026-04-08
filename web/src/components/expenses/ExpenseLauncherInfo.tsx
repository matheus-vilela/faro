import { supabase } from "@/lib/supabase";
import {
  formatExpenseLauncherLine,
  type ExpenseLauncherRpcRow,
} from "@/lib/expenseLauncherLabel";
import { User } from "lucide-react";
import { useEffect, useState } from "react";

type ExpenseLauncherInfoProps = {
  expenseId: string;
  className?: string;
  compact?: boolean;
};

export function ExpenseLauncherInfo({
  expenseId,
  className,
  compact,
}: ExpenseLauncherInfoProps) {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("get_expense_launcher_label", {
        p_expense_id: expenseId,
      });
      if (cancelled) return;
      if (error) {
        setLine("—");
        return;
      }
      setLine(
        formatExpenseLauncherLine(data as ExpenseLauncherRpcRow | null),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  const text = line ?? (compact ? "…" : "Carregando…");

  if (compact) {
    return (
      <span
        className={className}
        title={text}
      >
        {text}
      </span>
    );
  }

  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        Quem lançou
      </p>
      <p className="text-sm flex items-start gap-2">
        <User className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
        <span>{text}</span>
      </p>
    </div>
  );
}

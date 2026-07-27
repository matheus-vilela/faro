import { Button } from "@/components/ui/button";
import type { BudgetBasis } from "@/lib/budget/types";
import { cn } from "@/lib/utils";

const BASIS_OPTIONS: {
  value: BudgetBasis;
  label: string;
  description: string;
}[] = [
  {
    value: "competencia",
    label: "Competência",
      description:
      "Realizado pelos vencimentos no mês nas contas a pagar (despesas). Não inclui receitas nem o lucro do DRE.",
  },
  {
    value: "caixa",
    label: "Caixa",
    description:
      "Realizado pelos pagamentos confirmados no mês (data de pagamento das contas a pagar).",
  },
];

export function BudgetBasisToggle({
  value,
  onChange,
  disabled,
}: {
  value: BudgetBasis;
  onChange: (value: BudgetBasis) => void;
  disabled?: boolean;
}) {
  const active = BASIS_OPTIONS.find((o) => o.value === value);

  return (
    <div className="space-y-2">
      <div
        className="inline-flex w-fit max-w-full flex-wrap rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Base do realizado"
      >
        {BASIS_OPTIONS.map((opt) => {
          const isActive = value === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-full px-4",
                isActive && "bg-background shadow-sm",
              )}
              title={opt.description}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
      {active ? (
        <p className="text-xs text-muted-foreground">{active.description}</p>
      ) : null}
    </div>
  );
}

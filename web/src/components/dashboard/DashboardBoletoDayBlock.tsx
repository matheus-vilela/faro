import type { Boleto } from "@/types/expense";

export function DashboardBoletoDayBlock({
  label,
  sublabel,
  items,
  formatCurrency,
}: {
  label: string;
  sublabel: string;
  items: Boleto[];
  formatCurrency: (v: number) => string;
}) {
  const total = items.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="rounded-xl border border-border/80 bg-muted/25 px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border/60 pb-2">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs capitalize text-muted-foreground">{sublabel}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {items.length} conta{items.length !== 1 ? "s" : ""}
          </p>
          {items.length > 0 && (
            <p className="text-sm font-semibold tabular-nums text-primary">
              {formatCurrency(total)}
            </p>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Nenhuma pendente.</p>
      ) : (
        <ul className="max-h-40 space-y-2 overflow-y-auto">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex items-start justify-between gap-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{b.description}</span>
              <span className="shrink-0 font-semibold tabular-nums text-primary">
                {formatCurrency(b.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

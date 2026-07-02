import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { DreSemCategoriaBoleto } from "@/hooks/useDreReport";
import { isBoletoPayable } from "@/types/expense";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

const FLOW_LABELS = {
  payable: "A pagar",
  receivable: "A receber",
} as const;

const STATUS_LABELS = {
  pending: "Pendente",
  paid: "Pago",
} as const;

function formatDate(ymd: string): string {
  const raw = ymd.slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
    "pt-BR",
    { day: "2-digit", month: "2-digit", year: "numeric" },
  );
}

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function origemLabel(b: DreSemCategoriaBoleto): string {
  if (b.revenue_entry_id) return "Venda / receita";
  if (b.expense_id) return "Despesa";
  return "Lançamento avulso";
}

function actionLink(b: DreSemCategoriaBoleto): { to: string; label: string } | null {
  if (b.expense_id) {
    return {
      to: `/app/despesas?expense=${b.expense_id}`,
      label: "Abrir nota fiscal",
    };
  }
  if (b.revenue_entry_id) {
    return { to: "/app/receitas", label: "Ver receitas" };
  }
  return isBoletoPayable(b)
    ? { to: "/app/contas-a-pagar", label: "Contas a pagar" }
    : { to: "/app/vendas-realizadas", label: "Vendas realizadas" };
}

export function DreSemCategoriaTable({
  rows,
  totalAmount,
  periodLabel,
  loading,
  categoriesById,
}: {
  rows: DreSemCategoriaBoleto[];
  totalAmount: number;
  periodLabel: string;
  loading: boolean;
  categoriesById: Map<string, CompanyCategory>;
}) {
  if (loading) {
    return (
      <div className="space-y-3 py-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhum lançamento sem categoria em {periodLabel}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {rows.length} lançamento(s) com vencimento em {periodLabel} não entram no DRE
        porque não têm categoria do plano (
        <span className="font-medium text-foreground">{formatCurrency(totalAmount)}</span>{" "}
        no total). Classifique em Contas a pagar, Vendas realizadas ou vincule à despesa.
      </p>

      <div className="w-full overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Fluxo</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Legado</th>
              <th className="px-4 py-3 w-[8.5rem]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const link = actionLink(b);
              const legacyLabel =
                b.category && !b.company_category_id
                  ? formatBoletoCategoryLabel(b, categoriesById)
                  : "—";
              return (
                <tr
                  key={b.id}
                  className="border-b border-border/70 last:border-b-0 hover:bg-muted/25"
                >
                  <td className="px-4 py-3 align-middle tabular-nums whitespace-nowrap">
                    {formatDate(b.due_date)}
                  </td>
                  <td className="px-4 py-3 align-middle max-w-[280px]">
                    <span className="line-clamp-2 font-medium text-foreground">
                      {formatBoletoFluxoDescription(b)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Badge variant="outline" className="font-normal">
                      {isBoletoPayable(b) ? FLOW_LABELS.payable : FLOW_LABELS.receivable}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 align-middle text-muted-foreground">
                    {origemLabel(b)}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Badge
                      variant={b.status === "paid" ? "secondary" : "outline"}
                      className="font-normal"
                    >
                      {STATUS_LABELS[b.status as keyof typeof STATUS_LABELS] ??
                        b.status}
                    </Badge>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 align-middle text-right tabular-nums font-medium",
                      isBoletoPayable(b)
                        ? "text-rose-700 dark:text-rose-400"
                        : "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {formatCurrency(Number(b.amount))}
                  </td>
                  <td className="px-4 py-3 align-middle text-xs text-muted-foreground">
                    {legacyLabel}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    {link ? (
                      <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" asChild>
                        <Link to={link.to}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="sr-only sm:not-sr-only">{link.label}</span>
                        </Link>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/20 font-medium">
              <td colSpan={5} className="px-4 py-3 text-foreground">
                Total ({rows.length})
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatCurrency(totalAmount)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

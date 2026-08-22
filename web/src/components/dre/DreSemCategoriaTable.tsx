import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DreClassifySheet } from "@/components/dre/DreClassifySheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { DreSemCategoriaBoleto } from "@/hooks/useDreReport";
import { isBoletoPayable } from "@/types/expense";
import { ExternalLink, Tags } from "lucide-react";
import { useMemo, useState } from "react";
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
      to: `/app/notas-recebimento?expense=${b.expense_id}`,
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
  categories,
  companyId,
  onClassified,
}: {
  rows: DreSemCategoriaBoleto[];
  totalAmount: number;
  periodLabel: string;
  loading: boolean;
  categoriesById: Map<string, CompanyCategory>;
  categories: CompanyCategory[];
  companyId: string | undefined;
  onClassified: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  type DreSortKey =
    | "due"
    | "description"
    | "flow"
    | "origin"
    | "status"
    | "amount"
    | "legacy";

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    DreSemCategoriaBoleto,
    DreSortKey
  >(rows, "due", (a, b, key) => {
    switch (key) {
      case "due":
        return a.due_date.localeCompare(b.due_date);
      case "description":
        return formatBoletoFluxoDescription(a).localeCompare(
          formatBoletoFluxoDescription(b),
          "pt-BR",
        );
      case "flow":
        return Number(isBoletoPayable(a)) - Number(isBoletoPayable(b));
      case "origin":
        return origemLabel(a).localeCompare(origemLabel(b), "pt-BR");
      case "status":
        return a.status.localeCompare(b.status);
      case "amount":
        return Number(a.amount) - Number(b.amount);
      case "legacy":
        return formatBoletoCategoryLabel(a, categoriesById).localeCompare(
          formatBoletoCategoryLabel(b, categoriesById),
          "pt-BR",
        );
      default:
        return 0;
    }
  });

  const allIds = useMemo(() => sorted.map((r) => r.id), [sorted]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(allIds) : new Set());
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

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

  const selectedIds = [...selected];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {rows.length} lançamento(s) com vencimento em {periodLabel} não entram no DRE
          porque não têm categoria do plano (
          <span className="font-medium text-foreground">{formatCurrency(totalAmount)}</span>{" "}
          no total).
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!companyId || selectedIds.length === 0}
          onClick={() => setSheetOpen(true)}
        >
          <Tags className="mr-2 h-4 w-4" />
          Classificar selecionados
          {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </Button>
      </div>

      <div className="w-full overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="w-10 px-3 py-3">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="Selecionar todos"
                />
              </th>
              <SortableTableHead
                label="Vencimento"
                column="due"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="px-4 py-3"
              />
              <SortableTableHead
                label="Descrição"
                column="description"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="px-4 py-3"
              />
              <SortableTableHead
                label="Fluxo"
                column="flow"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="px-4 py-3"
              />
              <SortableTableHead
                label="Origem"
                column="origin"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="px-4 py-3"
              />
              <SortableTableHead
                label="Status"
                column="status"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="px-4 py-3"
              />
              <SortableTableHead
                label="Valor"
                column="amount"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                align="right"
                className="px-4 py-3"
              />
              <SortableTableHead
                label="Legado"
                column="legacy"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={onSort}
                className="px-4 py-3"
              />
              <th className="px-4 py-3 w-[9.5rem] whitespace-nowrap" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
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
                  <td className="px-3 py-3 align-middle">
                    <Checkbox
                      checked={selected.has(b.id)}
                      onCheckedChange={(v) => toggleOne(b.id, v === true)}
                      aria-label={`Selecionar ${formatBoletoFluxoDescription(b)}`}
                    />
                  </td>
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
                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    {link ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 whitespace-nowrap px-2"
                        asChild
                      >
                        <Link to={link.to}>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span>{link.label}</span>
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
              <td colSpan={6} className="px-4 py-3 text-foreground">
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

      {companyId ? (
        <DreClassifySheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          companyId={companyId}
          boletoIds={selectedIds}
          categories={categories}
          onDone={async () => {
            setSelected(new Set());
            await onClassified();
          }}
        />
      ) : null}
    </div>
  );
}

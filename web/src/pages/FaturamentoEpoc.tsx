import { type MonthYear } from "@/components/MonthSelector";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useCompany } from "@/contexts/CompanyContext";
import {
  formatIsoDateBr,
  formatMoneyPtBr,
  formatNumberPtBr,
} from "@/lib/formatMoneyPtBr";
import { monthYmdBounds, orderedYmdRange } from "@/lib/monthYmdRange";
import { supabase } from "@/lib/supabase";
import { nestedRelation } from "@/types/acquirer";
import { FilterX, Receipt } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type ProdutosServicosJson = {
  produtos?: {
    total?: {
      valor: string;
    };
  };
  servicos?: {
    total?: {
      valor: string;
    };
  };
};

type FaturamentoRow = {
  id: string;
  faturamento_date: string;
  quantity: number | null;
  produtos: number | null;
  servicos: number | null;
  taxas: number | null;
  total: number | null;
  ticket_medio: number | null;
  produtos_servicos_json: ProdutosServicosJson;
  fiscal_json: unknown;
};

type PaymentLine = {
  id: string;
  operation_count: number | null;
  amount: number;
  payment_methods: {
    sku: string;
    name: string;
    acquirers?: { name: string } | { name: string }[] | null;
  } | null;
};

type Tabela5GrupoView = {
  rotuloInicio?: string;
  valores?: string;
  acrescimo?: { valor?: string } | null;
  estornos?: { valor?: string } | null;
  total?: { valor?: string } | null;
};

type FiscalLinha = {
  rotulo?: string;
  chave?: string;
  quantidade?: string;
  valor?: string;
};

type SortKey =
  | "faturamento_date"
  | "produtos"
  | "servicos"
  | "quantity"
  | "ticket_medio"
  | "total";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function asTabela5Grupo(v: unknown): Tabela5GrupoView | null {
  const r = asRecord(v);
  return r ? (r as Tabela5GrupoView) : null;
}

function asFiscalLines(v: unknown): FiscalLinha[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object") as FiscalLinha[];
}

function moneyFromMaybePtBr(raw: string | number | null | undefined): string {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "number") return formatMoneyPtBr(raw);
  return raw;
}

export function FaturamentoEpoc({ embedded = false }: { embedded?: boolean }) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [dateFrom, setDateFrom] = useState(
    () => monthYmdBounds(now.getMonth() + 1, now.getFullYear()).min,
  );
  const [dateTo, setDateTo] = useState(
    () => monthYmdBounds(now.getMonth() + 1, now.getFullYear()).max,
  );
  const [rows, setRows] = useState<FaturamentoRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [minTotal, setMinTotal] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("faturamento_date");
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState<FaturamentoRow | null>(null);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const monthBounds = useMemo(
    () => monthYmdBounds(period.month, period.year),
    [period.month, period.year],
  );
  const dateRangeIsCustom =
    dateFrom !== monthBounds.min || dateTo !== monthBounds.max;
  const hasFilters =
    dateRangeIsCustom || minTotal.trim() !== "" || maxTotal.trim() !== "";

  const applyPeriod = (next: MonthYear) => {
    const bounds = monthYmdBounds(next.month, next.year);
    setPeriod(next);
    setDateFrom(bounds.min);
    setDateTo(bounds.max);
    setPage(1);
  };

  const clearFilters = () => {
    setDateFrom(monthBounds.min);
    setDateTo(monthBounds.max);
    setMinTotal("");
    setMaxTotal("");
    setPage(1);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
    setPage(1);
  };

  const load = useCallback(async () => {
    if (!companyId) {
      setRows([]);
      setCount(0);
      return;
    }
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const fromDate = dateFrom.trim() || monthBounds.min;
    const toDate = dateTo.trim() || monthBounds.max;
    const { gte, lte } = orderedYmdRange(fromDate, toDate);
    let q = supabase
      .from("epoc_faturamento_daily")
      .select(
        "id, faturamento_date, quantity, produtos, servicos, taxas, total, ticket_medio, produtos_servicos_json, fiscal_json",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .gte("faturamento_date", gte)
      .lte("faturamento_date", lte)
      .order(sortKey, { ascending: sortAsc })
      .range(from, to);
    const minN = parseFloat(minTotal.replace(",", "."));
    const maxN = parseFloat(maxTotal.replace(",", "."));
    if (Number.isFinite(minN)) q = q.gte("total", minN);
    if (Number.isFinite(maxN)) q = q.lte("total", maxN);
    const { data, error, count: c } = await q;
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as FaturamentoRow[]);
    setCount(c ?? 0);
  }, [
    companyId,
    page,
    dateFrom,
    dateTo,
    monthBounds,
    minTotal,
    maxTotal,
    sortKey,
    sortAsc,
  ]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const openDetail = async (row: FaturamentoRow) => {
    setDetail(row);
    setPayments([]);
    if (!companyId) return;
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("epoc_faturamento_daily_payment_methods")
      .select(
        "id, operation_count, amount, payment_methods ( sku, name, acquirers ( name ) )",
      )
      .eq("company_id", companyId)
      .eq("faturamento_daily_id", row.id)
      .order("amount", { ascending: false });
    setDetailLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPayments((data ?? []) as unknown as PaymentLine[]);
  };

  const ps = asRecord(detail?.produtos_servicos_json);
  const produtos = asTabela5Grupo(ps?.produtos);
  const servicos = asTabela5Grupo(ps?.servicos);
  const fiscal = asFiscalLines(detail?.fiscal_json);

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ReferencePeriodCard
          value={period}
          onChange={applyPeriod}
          description="Mês da lista"
          className="rounded-lg p-1.5"
          compact
          monthSelectorClassName="shrink-0 [&_button]:h-8 [&_button]:w-8 [&_span]:min-w-36 [&_span]:text-sm [&_span]:font-semibold"
        />
        <Input
          id="fat-from"
          type="date"
          aria-label="Data de início"
          title="Data de início"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => {
            setDateFrom(e.target.value || monthBounds.min);
            setPage(1);
          }}
          className="h-8 w-[9.5rem]"
        />
        <Input
          id="fat-to"
          type="date"
          aria-label="Data de fim"
          title="Data de fim"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => {
            setDateTo(e.target.value || monthBounds.max);
            setPage(1);
          }}
          className="h-8 w-[9.5rem]"
        />
        <Input
          id="fat-min-total"
          inputMode="decimal"
          aria-label="Total mínimo"
          title="Total mínimo"
          placeholder="Total mín."
          value={minTotal}
          onChange={(e) => {
            setMinTotal(e.target.value);
            setPage(1);
          }}
          className="h-8 w-28"
        />
        <Input
          id="fat-max-total"
          inputMode="decimal"
          aria-label="Total máximo"
          title="Total máximo"
          placeholder="Total máx."
          value={maxTotal}
          onChange={(e) => {
            setMaxTotal(e.target.value);
            setPage(1);
          }}
          className="h-8 w-28"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={!hasFilters}
          onClick={clearFilters}
        >
          <FilterX className="mr-1 size-3.5" />
          Limpar
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" asChild>
          <Link to="/app/configuracoes/formas-de-pagamento">
            Formas de pagamento
          </Link>
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" asChild>
          <Link to="/app/configuracoes/adquirentes">Adquirentes</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-muted-foreground p-4 text-sm">A carregar…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              Nenhum faturamento sincronizado neste período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs">
                    <SortableTableHead
                      label="Dia"
                      column="faturamento_date"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                    />
                    <SortableTableHead
                      label="Total produtos"
                      column="produtos"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Total serviços"
                      column="servicos"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Qtd. transações"
                      column="quantity"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Ticket médio"
                      column="ticket_medio"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                    <SortableTableHead
                      label="Total"
                      column="total"
                      sortKey={sortKey}
                      sortAsc={sortAsc}
                      onSort={handleSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                      onClick={() => void openDetail(row)}
                    >
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                        {formatIsoDateBr(row.faturamento_date)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoneyPtBr(
                          Number(
                            row.produtos_servicos_json?.produtos?.total?.valor
                              .replace(".", "")
                              .replace(",", ".") ??
                              row.produtos ??
                              "0",
                          ),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoneyPtBr(
                          Number(
                            row.produtos_servicos_json?.servicos?.total?.valor
                              .replace(".", "")
                              .replace(",", ".") ??
                              row.servicos ??
                              "0",
                          ),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatNumberPtBr(Number(row.quantity), 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoneyPtBr(Number(row.ticket_medio))}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatMoneyPtBr(Number(row.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={count}
        onPageChange={setPage}
      />

      <Sheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  Faturamento · {formatIsoDateBr(detail.faturamento_date)}
                </SheetTitle>
                <SheetDescription>
                  Dados persistidos a partir do relatório EPOC.
                </SheetDescription>
              </SheetHeader>

              <section className="space-y-2">
                <p className="text-sm font-medium">Total Geral</p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Qtde</dt>
                    <dd className="font-mono tabular-nums">
                      {formatNumberPtBr(Number(detail.quantity), 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Total</dt>
                    <dd className="font-mono tabular-nums">
                      {formatMoneyPtBr(Number(detail.total))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Produtos</dt>
                    <dd className="font-mono tabular-nums">
                      {formatMoneyPtBr(Number(detail.produtos))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Serviços</dt>
                    <dd className="font-mono tabular-nums">
                      {formatMoneyPtBr(Number(detail.servicos))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Taxas</dt>
                    <dd className="font-mono tabular-nums">
                      {formatMoneyPtBr(Number(detail.taxas))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">
                      Ticket médio
                    </dt>
                    <dd className="font-mono tabular-nums">
                      {formatMoneyPtBr(Number(detail.ticket_medio))}
                    </dd>
                  </div>
                </dl>
              </section>

              {(produtos || servicos) && (
                <section className="space-y-2">
                  <p className="text-sm font-medium">Produtos e serviços</p>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    {produtos ? (
                      <div className="rounded-md border p-2">
                        <p className="mb-1 font-medium">
                          {produtos.rotuloInicio ?? "Produtos"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Valores{" "}
                          <span className="text-foreground font-mono">
                            {moneyFromMaybePtBr(produtos.valores)}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Total{" "}
                          <span className="text-foreground font-mono">
                            {moneyFromMaybePtBr(produtos.total?.valor)}
                          </span>
                        </p>
                      </div>
                    ) : null}
                    {servicos ? (
                      <div className="rounded-md border p-2">
                        <p className="mb-1 font-medium">
                          {servicos.rotuloInicio ?? "Serviços"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Valores{" "}
                          <span className="text-foreground font-mono">
                            {moneyFromMaybePtBr(servicos.valores)}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Total{" "}
                          <span className="text-foreground font-mono">
                            {moneyFromMaybePtBr(servicos.total?.valor)}
                          </span>
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              )}

              {fiscal.length > 0 ? (
                <section className="space-y-2">
                  <p className="text-sm font-medium">Fiscal</p>
                  <ul className="space-y-1 text-sm">
                    {fiscal.map((line, i) => (
                      <li
                        key={`${line.chave ?? line.rotulo ?? i}`}
                        className="flex justify-between gap-2 border-b py-1 last:border-0"
                      >
                        <span className="text-muted-foreground">
                          {line.rotulo ?? line.chave ?? "—"}
                        </span>
                        <span className="font-mono tabular-nums">
                          {moneyFromMaybePtBr(line.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-2">
                <p className="text-sm font-medium">Formas de pagamento</p>
                {detailLoading ? (
                  <p className="text-muted-foreground text-sm">A carregar…</p>
                ) : payments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Sem linhas de pagamento neste dia.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-muted/40 border-b">
                          <th className="px-2 py-1.5 font-medium">Forma</th>
                          <th className="px-2 py-1.5 font-medium">
                            Adquirente
                          </th>
                          <th className="px-2 py-1.5 font-medium">Op.</th>
                          <th className="px-2 py-1.5 font-medium">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id} className="border-b last:border-0">
                            <td className="px-2 py-1.5">
                              <span className="block font-medium">
                                {p.payment_methods?.name ?? "—"}
                              </span>
                              <span className="text-muted-foreground font-mono text-xs">
                                {p.payment_methods?.sku ?? ""}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {nestedRelation(p.payment_methods?.acquirers)
                                ?.name ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 font-mono tabular-nums">
                              {formatNumberPtBr(Number(p.operation_count), 0)}
                            </td>
                            <td className="px-2 py-1.5 font-mono tabular-nums">
                              {formatMoneyPtBr(Number(p.amount))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <SheetFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDetail(null)}
                >
                  Fechar
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{body}</div>;
  }

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Faturamento"
        description="Resumo diário do relatório de faturamento EPOC (Total Geral, produtos/serviços, fiscal e formas de pagamento)."
        icon={Receipt}
      />
      {body}
    </PageShell>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBoletoFluxoDescription } from "@/lib/boletoFluxoDescription";
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { cn } from "@/lib/utils";
import type { CompanyCategory } from "@/types/category";
import type { FluxoBoletoRow } from "@/types/expenseSeries";
import {
  serviceDailySaleDisplayAmount,
  serviceDailySaleTitle,
  type ServiceDailySaleCalendarRow,
} from "@/types/serviceDailySale";
import { ArrowDownAZ, ArrowUpDown, FilterX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

export type VendasListKindFilter = "all" | "product" | "service";
export type VendasListStatusFilter = "all" | "pending" | "paid";
export type VendasListSort =
  | "date_desc"
  | "date_asc"
  | "amount_desc"
  | "amount_asc"
  | "description_asc";

type UnifiedRow = {
  key: string;
  kind: "product" | "service";
  dateYmd: string;
  description: string;
  categoryLabel: string;
  categoryId: string | null;
  status: "pending" | "paid" | "sync";
  amount: number;
  quantity: number | null;
  boleto?: FluxoBoletoRow;
  service?: ServiceDailySaleCalendarRow;
};

function formatDateBr(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function statusLabel(status: UnifiedRow["status"]): string {
  if (status === "paid") return "Recebido";
  if (status === "pending") return "Pendente";
  return "EPOC";
}

type Props = {
  boletos: FluxoBoletoRow[];
  serviceSales: ServiceDailySaleCalendarRow[];
  categories: CompanyCategory[];
  categoriesById: Map<string, CompanyCategory>;
  loading: boolean;
  emptyMessage: string;
  formatCurrency: (v: number) => string;
  pageSize: number;
  onSelectBoleto: (b: FluxoBoletoRow) => void;
};

export function VendasRealizadasListTable({
  boletos,
  serviceSales,
  categories,
  categoriesById,
  loading,
  emptyMessage,
  formatCurrency,
  pageSize,
  onSelectBoleto,
}: Props) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [kind, setKind] = useState<VendasListKindFilter>("all");
  const [status, setStatus] = useState<VendasListStatusFilter>("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [sort, setSort] = useState<VendasListSort>("date_desc");
  const [page, setPage] = useState(1);

  const revenueCategories = useMemo(
    () =>
      categories
        .filter((c) => c.natureza === "RECEITA")
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [categories],
  );

  const allRows = useMemo((): UnifiedRow[] => {
    const productRows: UnifiedRow[] = boletos.map((b) => {
      const amount =
        b.status === "paid" && b.paid_amount != null
          ? Number(b.paid_amount)
          : Number(b.amount);
      return {
        key: `b-${b.id}`,
        kind: "product" as const,
        dateYmd: b.due_date.slice(0, 10),
        description: formatBoletoFluxoDescription(b),
        categoryLabel: formatBoletoCategoryLabel(b, categoriesById),
        categoryId: b.company_category_id ?? null,
        status: b.status === "paid" ? ("paid" as const) : ("pending" as const),
        amount,
        quantity: null,
        boleto: b,
      };
    });

    const serviceRows: UnifiedRow[] = serviceSales.map((s) => ({
      key: `s-${s.id}`,
      kind: "service" as const,
      dateYmd: s.sale_date.slice(0, 10),
      description: serviceDailySaleTitle(s),
      categoryLabel: "Serviços",
      categoryId: null,
      status: "sync" as const,
      amount: serviceDailySaleDisplayAmount(s),
      quantity: Number(s.quantity) || 0,
      service: s,
    }));

    return [...productRows, ...serviceRows];
  }, [boletos, serviceSales, categoriesById]);

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = allRows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (status !== "all") {
        if (r.kind === "service") return false;
        if (r.status !== status) return false;
      }
      if (categoryId === "services") {
        if (r.kind !== "service") return false;
      } else if (categoryId !== "all") {
        if (r.categoryId !== categoryId) return false;
      }
      if (dateFrom && r.dateYmd < dateFrom) return false;
      if (dateTo && r.dateYmd > dateTo) return false;
      if (term) {
        const hay = `${r.description} ${r.categoryLabel}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    rows = rows.slice().sort((a, b) => {
      switch (sort) {
        case "date_asc":
          return (
            a.dateYmd.localeCompare(b.dateYmd) ||
            a.description.localeCompare(b.description, "pt-BR")
          );
        case "date_desc":
          return (
            b.dateYmd.localeCompare(a.dateYmd) ||
            a.description.localeCompare(b.description, "pt-BR")
          );
        case "amount_asc":
          return a.amount - b.amount;
        case "amount_desc":
          return b.amount - a.amount;
        case "description_asc":
          return a.description.localeCompare(b.description, "pt-BR");
        default:
          return 0;
      }
    });

    return rows;
  }, [allRows, search, kind, status, categoryId, dateFrom, dateTo, sort]);

  const totalAmount = useMemo(
    () => filteredSorted.reduce((s, r) => s + r.amount, 0),
    [filteredSorted],
  );

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredSorted.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  const hasActiveFilters =
    search.trim() !== "" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    kind !== "all" ||
    status !== "all" ||
    categoryId !== "all" ||
    sort !== "date_desc";

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setKind("all");
    setStatus("all");
    setCategoryId("all");
    setSort("date_desc");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
          <Label htmlFor="vendas-list-search">Busca</Label>
          <Input
            id="vendas-list-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Descrição, categoria…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendas-list-from">De</Label>
          <Input
            id="vendas-list-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vendas-list-to">Até</Label>
          <Input
            id="vendas-list-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as VendasListKindFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="product">Produtos</SelectItem>
              <SelectItem value="service">Serviços</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as VendasListStatusFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Recebido</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
          <Label>Categoria</Label>
          <SearchSelect
            value={categoryId}
            onValueChange={(v) => {
              setCategoryId(v);
              setPage(1);
            }}
            options={revenueCategories.map((c) => ({
              value: c.id,
              label: c.name,
            }))}
            leadingOptions={[
              { value: "all", label: "Todas" },
              { value: "services", label: "Serviços (EPOC)" },
            ]}
            placeholder="Categoria"
            searchPlaceholder="Buscar categoria…"
            emptyMessage="Nenhuma categoria encontrada."
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
          <Label>Ordenação</Label>
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as VendasListSort);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Ordenar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">
                <span className="inline-flex items-center gap-1.5">
                  <ArrowUpDown className="size-3.5" /> Data (mais recente)
                </span>
              </SelectItem>
              <SelectItem value="date_asc">Data (mais antiga)</SelectItem>
              <SelectItem value="amount_desc">Valor (maior)</SelectItem>
              <SelectItem value="amount_asc">Valor (menor)</SelectItem>
              <SelectItem value="description_asc">
                <span className="inline-flex items-center gap-1.5">
                  <ArrowDownAZ className="size-3.5" /> Descrição A–Z
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end sm:col-span-2 xl:col-span-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!hasActiveFilters}
            onClick={clearFilters}
          >
            <FilterX className="mr-2 size-4" />
            Limpar filtros
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {loading
            ? "A carregar…"
            : `${filteredSorted.length} registo(s)${
                hasActiveFilters ? " (filtrados)" : ""
              }`}
        </p>
        {!loading && filteredSorted.length > 0 && (
          <p className="font-medium tabular-nums text-foreground">
            Total: {formatCurrency(totalAmount)}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Carregando…
        </p>
      ) : filteredSorted.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {allRows.length === 0 ? emptyMessage : "Nenhum registo com estes filtros."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Data</th>
                  <th className="px-3 py-2.5 font-medium">Descrição</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">Categoria</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium text-right">Qtde</th>
                  <th className="px-3 py-2.5 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const clickable = r.kind === "product" && r.boleto;
                  const rowClass = cn(
                    "border-b last:border-0 transition-colors",
                    clickable && "cursor-pointer hover:bg-muted/40",
                  );
                  const onActivate = () => {
                    if (r.boleto) onSelectBoleto(r.boleto);
                  };
                  return (
                    <tr
                      key={r.key}
                      className={rowClass}
                      onClick={clickable ? onActivate : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onActivate();
                              }
                            }
                          : undefined
                      }
                      tabIndex={clickable ? 0 : undefined}
                      role={clickable ? "button" : undefined}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDateBr(r.dateYmd)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        <span className="line-clamp-2">{r.description}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={
                            r.kind === "product"
                              ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                              : "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
                          }
                        >
                          {r.kind === "product" ? "Produto" : "Serviço"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.categoryLabel}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="secondary"
                          className={cn(
                            r.status === "paid" &&
                              "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
                            r.status === "pending" &&
                              "bg-amber-500/15 text-amber-800 dark:text-amber-200",
                            r.status === "sync" &&
                              "bg-sky-500/15 text-sky-800 dark:text-sky-200",
                          )}
                        >
                          {statusLabel(r.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {r.quantity != null
                          ? r.quantity.toLocaleString("pt-BR")
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-semibold tabular-nums",
                          r.kind === "product"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-sky-700 dark:text-sky-400",
                        )}
                      >
                        {formatCurrency(r.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Página {safePage} de {pageCount}
              {serviceSales.length > 0 ? (
                <>
                  {" · "}
                  Catálogo em{" "}
                  <Link
                    to="/app/servicos"
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Serviços
                  </Link>
                </>
              ) : null}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Seguinte
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

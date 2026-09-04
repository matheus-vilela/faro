import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useCompany } from "@/contexts/CompanyContext";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import {
  isEpocEmptyReportError,
  listEstoqueSemVenda,
  parseVendaProdutosCsvItems,
  type VendaProdutoDiaItem,
} from "@/lib/epocEstoqueVsVendas";
import {
  exportEpocEstoqueDia,
  type EpocEstoqueSaidaItem,
} from "@/services/epocEstoqueExportService";
import { exportEpocVendaProdutosCsv } from "@/services/epocVendaProdutosExportService";
import { yesterdayIsoSaoPaulo } from "@/services/epocFaturamentoExportService";
import { applyEpocStockVariantOuts } from "@/lib/productSaleFamily";
import { GitCompare, Link2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EpocSaleFamilyLinkSheet } from "./EpocSaleFamilyLinkSheet";

type Phase = "idle" | "vendas" | "estoque";
type VendaSortKey = "sku" | "nome" | "qtde" | "total";
type EstoqueSortKey =
  | "sku"
  | "nome"
  | "categorias"
  | "qtde"
  | "qtde_volume_saida"
  | "custo_total";

function formatBrl(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatQty(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function VendasTable({ items }: { items: VendaProdutoDiaItem[] }) {
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    VendaProdutoDiaItem,
    VendaSortKey
  >(
    items,
    "nome",
    (a, b, key) => {
      switch (key) {
        case "sku":
          return (a.sku ?? "").localeCompare(b.sku ?? "", "pt-BR", {
            numeric: true,
          });
        case "nome":
          return a.nome.localeCompare(b.nome, "pt-BR");
        case "qtde":
          return (a.qtde ?? 0) - (b.qtde ?? 0);
        case "total":
          return (a.total ?? 0) - (b.total ?? 0);
        default:
          return 0;
      }
    },
    true,
  );

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nenhuma venda de produto neste dia.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <SortableTableHead
              label="SKU"
              column="sku"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Produto"
              column="nome"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Qtde"
              column="qtde"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              label="Total bruto"
              column="total"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((it, idx) => (
            <tr
              key={`${it.sku ?? ""}-${it.nome}-${idx}`}
              className="border-b border-border/60 last:border-0"
            >
              <td className="px-3 py-2 font-mono text-xs">{it.sku || "—"}</td>
              <td className="px-3 py-2 font-medium">{it.nome}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatQty(it.qtde)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatBrl(it.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EstoqueTable({
  items,
  emptyLabel,
  onLink,
}: {
  items: EpocEstoqueSaidaItem[];
  emptyLabel: string;
  onLink?: (item: EpocEstoqueSaidaItem) => void;
}) {
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    EpocEstoqueSaidaItem,
    EstoqueSortKey
  >(
    items,
    "nome",
    (a, b, key) => {
      switch (key) {
        case "sku":
          return a.sku.localeCompare(b.sku, "pt-BR", { numeric: true });
        case "nome":
          return a.nome.localeCompare(b.nome, "pt-BR");
        case "categorias":
          return a.categoria_path.localeCompare(b.categoria_path, "pt-BR");
        case "qtde":
          return (a.qtde ?? 0) - (b.qtde ?? 0);
        case "qtde_volume_saida":
          return (a.qtde_volume_saida ?? 0) - (b.qtde_volume_saida ?? 0);
        case "custo_total":
          return (a.custo_total ?? 0) - (b.custo_total ?? 0);
        default:
          return 0;
      }
    },
    true,
  );

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-3xl text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <SortableTableHead
              label="SKU"
              column="sku"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Item"
              column="nome"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Categorias"
              column="categorias"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Qtde"
              column="qtde"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              label="Qtde volume saída"
              column="qtde_volume_saida"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            <SortableTableHead
              label="Custo total"
              column="custo_total"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
              align="right"
            />
            {onLink ? <th className="px-3 py-2 text-right">Ação</th> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((it, idx) => (
            <tr
              key={`${it.sku}-${it.nome}-${idx}`}
              className="border-b border-border/60 last:border-0"
            >
              <td className="px-3 py-2 font-mono text-xs">{it.sku}</td>
              <td className="px-3 py-2 font-medium">{it.nome}</td>
              <td className="text-muted-foreground px-3 py-2">
                {it.categoria_path || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatQty(it.qtde)}
                {it.qtde_unidade ? ` ${it.qtde_unidade}` : ""}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatQty(it.qtde_volume_saida)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatBrl(it.custo_total)}
              </td>
              {onLink ? (
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onLink(it)}
                  >
                    <Link2 className="size-3.5" />
                    Vincular ao agrupamento
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EpocEstoqueVsVendasPanel({
  lockedDate,
  showAsCard = false,
}: {
  lockedDate?: string;
  showAsCard?: boolean;
}) {
  const { currentCompany } = useCompany();
  const [data, setData] = useState(lockedDate ?? yesterdayIsoSaoPaulo());

  useEffect(() => {
    if (lockedDate) setData(lockedDate);
  }, [lockedDate]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [vendasNote, setVendasNote] = useState<string | null>(null);
  const [vendas, setVendas] = useState<VendaProdutoDiaItem[] | null>(null);
  const [estoque, setEstoque] = useState<EpocEstoqueSaidaItem[] | null>(null);
  const [linkItem, setLinkItem] = useState<EpocEstoqueSaidaItem | null>(null);
  const [applying, setApplying] = useState(false);

  const busy = phase !== "idle";
  const soNoEstoque = useMemo(
    () =>
      vendas && estoque ? listEstoqueSemVenda(estoque, vendas) : null,
    [vendas, estoque],
  );

  const runCompare = async () => {
    if (!currentCompany) {
      toast.error("Selecione uma unidade no menu.");
      return;
    }
    if (!data) {
      toast.error("Informe a data.");
      return;
    }

    setError(null);
    setVendasNote(null);
    setVendas(null);
    setEstoque(null);

    setPhase("vendas");
    let vendaItems: VendaProdutoDiaItem[] = [];
    try {
      const vendaRes = await exportEpocVendaProdutosCsv({
        companyId: currentCompany.id,
        dataDeIso: data,
        dataAteIso: data,
      });
      if (!vendaRes.ok) {
        if (!isEpocEmptyReportError(vendaRes.error)) {
          setError(vendaRes.error);
          toast.error(vendaRes.error);
          setPhase("idle");
          return;
        }
        setVendasNote("Sem #tblExport de venda neste dia.");
      } else {
        vendaItems = parseVendaProdutosCsvItems(vendaRes.csv);
      }
      setVendas(vendaItems);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Erro ao consultar venda de produtos.";
      setError(msg);
      toast.error(msg);
      setPhase("idle");
      return;
    }

    setPhase("estoque");
    try {
      const estoqueRes = await exportEpocEstoqueDia({
        companyId: currentCompany.id,
        dataIso: data,
      });
      if (!estoqueRes.ok) {
        if (!isEpocEmptyReportError(estoqueRes.error)) {
          setError(estoqueRes.error);
          toast.error(estoqueRes.error);
          setEstoque([]);
          setPhase("idle");
          return;
        }
        setEstoque([]);
      } else {
        setEstoque(estoqueRes.items);
        const missing = listEstoqueSemVenda(estoqueRes.items, vendaItems);
        toast.success(
          missing.length === 0
            ? "Todas as saídas de estoque estão na venda."
            : `${missing.length} item(ns) só no estoque.`,
        );
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Erro ao consultar estoque EPOC.";
      setError(msg);
      toast.error(msg);
    } finally {
      setPhase("idle");
    }
  };

  const applyVariantOuts = async () => {
    if (!currentCompany || !estoque?.length) return;
    setApplying(true);
    try {
      const result = await applyEpocStockVariantOuts({
        companyId: currentCompany.id,
        saleDateIso: data,
        items: estoque.map((it) => ({
          sku: it.sku,
          name: it.nome,
          qty: it.qtde,
        })),
      });
      toast.success(
        result.applied === 0 && result.already === 0
          ? `Nenhuma variante vinculada neste dia (${result.skipped} ignorada(s)).`
          : `Baixas: ${result.applied} aplicada(s), ${result.already} já existente(s), ${result.skipped} ignorada(s).`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível aplicar as baixas.",
      );
    } finally {
      setApplying(false);
    }
  };

  const saleNames = useMemo(
    () => (vendas ?? []).map((v) => v.nome),
    [vendas],
  );

  const body = (
    <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor="epoc-estoque-vs-vendas-data">Data</Label>
            <Input
              id="epoc-estoque-vs-vendas-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={busy || Boolean(lockedDate)}
            />
          </div>
          <Button
            type="button"
            onClick={() => void runCompare()}
            disabled={busy || !currentCompany}
          >
            {phase === "vendas" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Buscando vendas…
              </>
            ) : phase === "estoque" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Buscando estoque…
              </>
            ) : (
              <>
                <GitCompare className="size-4" />
                Comparar dia
              </>
            )}
          </Button>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        {vendas ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Venda de produtos
              <span className="text-muted-foreground font-normal">
                {" "}
                · {vendas.length} item(ns)
              </span>
            </h3>
            {vendasNote ? (
              <p className="text-muted-foreground text-sm">{vendasNote}</p>
            ) : null}
            <VendasTable items={vendas} />
          </section>
        ) : null}

        {estoque ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Saídas de estoque
              <span className="text-muted-foreground font-normal">
                {" "}
                · {estoque.length} item(ns)
              </span>
            </h3>
            <EstoqueTable
              items={estoque}
              emptyLabel="Nenhuma saída de estoque neste dia."
            />
          </section>
        ) : null}

        {soNoEstoque ? (
          <section className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-medium">
                Só no estoque
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {soNoEstoque.length} item(ns) com saída e sem venda
                </span>
              </h3>
              {estoque && estoque.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || applying || !currentCompany}
                  onClick={() => void applyVariantOuts()}
                >
                  {applying ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Aplicar baixas das variantes
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              Vínculo é manual: o que só saiu no estoque não vira variante
              sozinho. Aplicar baixas só mexe em variantes já ligadas a um
              agrupamento — água e insumos da venda não saem de novo.
            </p>
            <EstoqueTable
              items={soNoEstoque}
              emptyLabel="Nenhum item de estoque ficou de fora da venda."
              onLink={
                currentCompany
                  ? (item) => setLinkItem(item)
                  : undefined
              }
            />
          </section>
        ) : null}

      {currentCompany ? (
        <EpocSaleFamilyLinkSheet
          open={linkItem != null}
          onOpenChange={(open) => {
            if (!open) setLinkItem(null);
          }}
          companyId={currentCompany.id}
          item={linkItem}
          saleNames={saleNames}
          onLinked={() => {
            toast.message(
              "Variante ligada. Use «Aplicar baixas das variantes» para baixar o estoque deste dia.",
            );
          }}
        />
      ) : null}
    </div>
  );

  if (!showAsCard) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="size-4" />
          Estoque vs vendas
        </CardTitle>
        <CardDescription>
          Busca a venda de produtos do dia e, em seguida, as saídas de estoque.
          Destaca o que saiu no estoque e não aparece na venda. Vínculo manual
          — a baixa automática do sync só toca variantes já ligadas.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

export function EpocEstoqueVsVendasCard() {
  return <EpocEstoqueVsVendasPanel showAsCard />;
}

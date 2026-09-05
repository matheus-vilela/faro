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
  downloadTextAsFile,
  exportEpocEstoqueDia,
  yesterdayIsoSaoPaulo,
  type EpocEstoqueSaidaItem,
} from "@/services/epocEstoqueExportService";
import { FileSpreadsheet, Loader2, PackageSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type SortKey =
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

export function EpocEstoqueExportCard() {
  const { currentCompany } = useCompany();
  const [data, setData] = useState(yesterdayIsoSaoPaulo());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<EpocEstoqueSaidaItem[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [totalCusto, setTotalCusto] = useState<number | null>(null);
  const [otherActions, setOtherActions] = useState<number | null>(null);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    EpocEstoqueSaidaItem,
    SortKey
  >(items ?? [], "nome", (a, b, key) => {
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
  }, true);

  const summary = useMemo(() => {
    if (!items) return null;
    return `${items.length} saída(s)${
      otherActions ? ` · ${otherActions} outra(s) ação(ões) ignorada(s)` : ""
    }`;
  }, [items, otherActions]);

  const runExport = async () => {
    if (!currentCompany) {
      toast.error("Selecione uma unidade no menu.");
      return;
    }
    if (!data) {
      toast.error("Informe a data.");
      return;
    }

    setBusy(true);
    setError(null);
    setItems(null);
    setCsv(null);
    setFileName(null);
    setTotalCusto(null);
    setOtherActions(null);
    try {
      const result = await exportEpocEstoqueDia({
        companyId: currentCompany.id,
        dataIso: data,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setItems(result.items);
      setCsv(result.csv);
      setFileName(result.file_name);
      setTotalCusto(result.total_custo);
      setOtherActions(result.other_action_count);
      toast.success(
        `${result.total_itens} saída(s) em ${result.data}.`,
      );
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Erro ao consultar estoque EPOC.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    if (!csv || !fileName) return;
    downloadTextAsFile(csv, fileName);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageSearch className="size-4" />
          Estoque do dia
        </CardTitle>
        <CardDescription>
          Consulta <code>mod_rel_estoque</code> no portal e lista só as saídas
          de <code>#tblExport</code>, com SKU, categorias, quantidades e custo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-xs space-y-1.5">
            <Label htmlFor="epoc-estoque-data">Data</Label>
            <Input
              id="epoc-estoque-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void runExport()}
              disabled={busy || !currentCompany}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Consultando portal…
                </>
              ) : (
                <>
                  <PackageSearch className="size-4" />
                  Buscar estoque
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !csv}
              onClick={downloadCsv}
            >
              <FileSpreadsheet className="size-4" />
              Baixar CSV
            </Button>
          </div>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {summary ? (
          <p className="text-muted-foreground text-sm">
            {summary}
            {totalCusto != null ? ` · ${formatBrl(totalCusto)}` : ""}
          </p>
        ) : null}

        {items && items.length > 0 ? (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

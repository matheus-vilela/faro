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
import { useCompany } from "@/contexts/CompanyContext";
import {
  downloadTextAsFile,
  exportEpocVendaProdutosCsv,
  yesterdayIsoSaoPaulo,
} from "@/services/epocVendaProdutosExportService";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function EpocVendaProdutosExportCard() {
  const { currentCompany } = useCompany();
  const yesterday = yesterdayIsoSaoPaulo();
  const [dataDe, setDataDe] = useState(yesterday);
  const [dataAte, setDataAte] = useState(yesterday);
  const [loading, setLoading] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const runExport = async () => {
    if (!currentCompany) {
      toast.error("Selecione uma unidade no menu.");
      return;
    }
    if (!dataDe || !dataAte) {
      toast.error("Informe data de e data até.");
      return;
    }
    if (dataDe > dataAte) {
      toast.error("A data inicial não pode ser posterior à final.");
      return;
    }

    setLoading(true);
    setLastSummary(null);
    try {
      const result = await exportEpocVendaProdutosCsv({
        companyId: currentCompany.id,
        dataDeIso: dataDe,
        dataAteIso: dataAte,
      });
      if (!result.ok) {
        toast.error(result.error);
        setLastSummary(result.error);
        return;
      }
      downloadTextAsFile(result.csv, result.file_name);
      const summary = `${result.total_itens} linha(s) · ${result.dias_com_dados} dia(s) · ${result.file_name}`;
      setLastSummary(summary);
      toast.success("CSV de venda de produtos gerado e baixado.");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Erro ao exportar venda de produtos EPOC.";
      toast.error(msg);
      setLastSummary(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="size-4" />
          EPOC — export venda de produtos
        </CardTitle>
        <CardDescription>
          Chama o portal (<code>mod_rel_produto_sintetico</code>), extrai{" "}
          <code>#tblExport</code> e gera CSV no mesmo formato do sync de
          produtos (coluna <code>data_consumo</code> + linhas com Total Bruto
          preenchido). Usa as credenciais EPOC da unidade selecionada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="epoc-vp-data-de">Data de</Label>
            <Input
              id="epoc-vp-data-de"
              type="date"
              value={dataDe}
              onChange={(e) => setDataDe(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="epoc-vp-data-ate">Data até</Label>
            <Input
              id="epoc-vp-data-ate"
              type="date"
              value={dataAte}
              onChange={(e) => setDataAte(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>
        <Button
          type="button"
          onClick={() => void runExport()}
          disabled={loading || !currentCompany}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Consultando portal…
            </>
          ) : (
            <>
              <FileSpreadsheet className="size-4" />
              Gerar e baixar CSV
            </>
          )}
        </Button>
        {lastSummary ? (
          <p className="text-muted-foreground text-sm">{lastSummary}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

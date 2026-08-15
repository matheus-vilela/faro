import {
  EpocVendaServicosInterpretResult,
  runEpocVendaServicosInterpret,
} from "@/components/desenvolvimento/EpocVendaServicosInterpretCard";
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
import type { ServicoVendasInterpretPreview } from "@/lib/epocVendaServicosInterpret";
import {
  downloadTextAsFile,
  exportEpocVendaServicosCsv,
  yesterdayIsoSaoPaulo,
} from "@/services/epocVendaServicosExportService";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Phase = "idle" | "exporting" | "interpreting";

export function EpocVendaServicosExportCard() {
  const { currentCompany } = useCompany();
  const yesterday = yesterdayIsoSaoPaulo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dataDe, setDataDe] = useState(yesterday);
  const [dataAte, setDataAte] = useState(yesterday);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [preview, setPreview] = useState<ServicoVendasInterpretPreview | null>(
    null,
  );

  const busy = phase !== "idle";

  const interpretCsv = async (text: string, fileName: string) => {
    if (!currentCompany) return;
    setPhase("interpreting");
    try {
      const result = await runEpocVendaServicosInterpret(
        currentCompany.id,
        text,
        fileName,
      );
      setPreview(result);
      if (!result.ok) {
        toast.error(result.error ?? "Falha ao interpretar CSV.");
        return;
      }
      toast.success(
        `${result.totals.validLines} linha(s) · ${result.totals.wouldCreateServices} a criar · ${result.totals.wouldMatchServices} existentes`,
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Não foi possível interpretar o CSV.";
      toast.error(msg);
    } finally {
      setPhase("idle");
    }
  };

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

    setPhase("exporting");
    setLastSummary(null);
    setPreview(null);
    try {
      const result = await exportEpocVendaServicosCsv({
        companyId: currentCompany.id,
        dataDeIso: dataDe,
        dataAteIso: dataAte,
      });
      if (!result.ok) {
        toast.error(result.error);
        setLastSummary(result.error);
        setPhase("idle");
        return;
      }
      downloadTextAsFile(result.csv, result.file_name);
      setLastSummary(
        `${result.total_itens} item(ns) · ${result.dias_com_dados} dia(s) · ${result.file_name}`,
      );
      toast.success("CSV gerado e baixado. A interpretar…");
      await interpretCsv(result.csv, result.file_name);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Erro ao exportar venda de serviços EPOC.";
      toast.error(msg);
      setLastSummary(msg);
      setPhase("idle");
    }
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    if (!currentCompany) {
      toast.error("Selecione uma unidade no menu.");
      return;
    }
    setLastSummary(`Arquivo local · ${file.name}`);
    setPreview(null);
    try {
      await interpretCsv(await file.text(), file.name);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="size-4" />
          Venda de serviços
        </CardTitle>
        <CardDescription>
          Gera o CSV no portal e interpreta em seguida. Se já tiver o arquivo,
          use <strong>Escolher CSV</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-md lg:flex-1">
            <div className="space-y-1.5">
              <Label htmlFor="epoc-vs-data-de">Data de</Label>
              <Input
                id="epoc-vs-data-de"
                type="date"
                value={dataDe}
                onChange={(e) => setDataDe(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="epoc-vs-data-ate">Data até</Label>
              <Input
                id="epoc-vs-data-ate"
                type="date"
                value={dataAte}
                onChange={(e) => setDataAte(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            disabled={busy || !currentCompany}
            onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void runExport()}
              disabled={busy || !currentCompany}
            >
              {phase === "exporting" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Consultando portal…
                </>
              ) : phase === "interpreting" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Interpretando…
                </>
              ) : (
                <>
                  <FileSpreadsheet className="size-4" />
                  Gerar e baixar CSV
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !currentCompany}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" />
              Escolher CSV
            </Button>
          </div>
        </div>

        {lastSummary ? (
          <p className="text-muted-foreground text-sm">{lastSummary}</p>
        ) : null}

        {preview ? (
          <div className="border-t pt-4">
            <EpocVendaServicosInterpretResult preview={preview} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

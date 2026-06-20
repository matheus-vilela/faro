import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  generateImportSku,
  parseProductImportFile,
  type ParsedProductRow,
} from "@/lib/parseProductImport";
import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";
import { supabase } from "@/lib/supabase";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ProductImportSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSuccess: () => void;
};

export function ProductImportSheet({
  open,
  onOpenChange,
  companyId,
  onSuccess,
}: ProductImportSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rows, setRows] = useState<ParsedProductRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [skippedEmpty, setSkippedEmpty] = useState(0);

  const resetState = useCallback(() => {
    setFile(null);
    setRows([]);
    setWarnings([]);
    setSkippedEmpty(0);
    setParsing(false);
    setImporting(false);
  }, []);

  useEffect(() => {
    if (open) resetState();
  }, [open, resetState]);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const handleFile = async (f: File | null) => {
    setFile(f);
    setRows([]);
    setWarnings([]);
    setSkippedEmpty(0);
    if (!f) return;
    setParsing(true);
    try {
      const result = await parseProductImportFile(f);
      setRows(result.rows);
      setWarnings(result.warnings);
      setSkippedEmpty(result.skippedEmpty);
      if (result.rows.length === 0 && result.warnings.length === 0) {
        toast.error("Nenhuma linha válida encontrada.");
      } else if (result.rows.length === 0) {
        toast.error("Nenhuma linha válida. Verifique os avisos abaixo.");
      } else {
        toast.success(`${result.rows.length} produto(s) pronto(s) para importar.`);
      }
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível ler o arquivo.",
      );
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!companyId || rows.length === 0) return;
    setImporting(true);
    const chunkSize = 80;
    let imported = 0;
    try {
      for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const payload = slice.map((r, j) => ({
          company_id: companyId,
          name: sanitizeCatalogProductName(r.name),
          sku: generateImportSku(i + j),
          unit: r.unit,
          min_quantity: r.min_quantity,
          current_quantity: r.current_quantity,
          last_unit_value: r.last_unit_value,
        }));
        const { error } = await supabase.from("products").insert(payload);
        if (error) {
          toast.error(error.message ?? "Erro ao importar.");
          setImporting(false);
          return;
        }
        imported += slice.length;
      }
      toast.success(
        `${imported} produto(s) importado(s).`,
      );
      resetState();
      onOpenChange(false);
      onSuccess();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar produtos
          </SheetTitle>
          <SheetDescription>
            Envie um arquivo <strong>CSV</strong> ou <strong>Excel</strong>{" "}
            (.xlsx, .xls) com: nome, <strong>unidade</strong> (logo após o nome),
            quantidade em estoque, quantidade mínima e, se houver, último valor
            pago por unidade.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Dica</p>
            <p className="mt-1">
              Cabeçalho sugerido: Nome, Unidade, Estoque, Mínimo, Último preço.
              Sem cabeçalho: colunas A nome, B unidade (ex.: un, kg, l), C
              estoque, D mínimo, E último preço (opcional). Unidade vazia vira{" "}
              <code className="rounded bg-muted px-1">un</code>.
            </p>
          </div>

          <div>
            <label
              htmlFor="product-import-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background px-4 py-8 transition-colors hover:bg-muted/40"
            >
              {parsing ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {file ? file.name : "Clique para escolher arquivo"}
              </span>
              <span className="text-xs text-muted-foreground">
                CSV, XLS ou XLSX
              </span>
              <input
                id="product-import-file"
                type="file"
                accept={ACCEPT}
                className="sr-only"
                disabled={parsing || importing}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  void handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {warnings.length > 0 && (
            <div className="max-h-32 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <p className="font-medium">Avisos</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {skippedEmpty > 0 && (
            <p className="text-xs text-muted-foreground">
              {skippedEmpty} linha(s) em branco ignorada(s).
            </p>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pré-visualização</p>
              <div className="max-h-56 overflow-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="p-2 font-medium">Nome</th>
                      <th className="p-2 font-medium">Unid.</th>
                      <th className="p-2 font-medium">Estoque</th>
                      <th className="p-2 font-medium">Mín.</th>
                      <th className="p-2 font-medium">Últ. preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r) => (
                      <tr key={r.sourceRow} className="border-t">
                        <td className="p-2 align-top">{r.name}</td>
                        <td className="p-2 uppercase">{r.unit}</td>
                        <td className="p-2 tabular-nums">
                          {r.current_quantity}
                        </td>
                        <td className="p-2 tabular-nums">{r.min_quantity}</td>
                        <td className="p-2 tabular-nums">
                          {r.last_unit_value != null
                            ? r.last_unit_value.toLocaleString("pt-BR", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Mostrando 50 de {rows.length} linhas.
                </p>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="mt-auto border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing || rows.length === 0}
          >
            {importing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importando…
              </>
            ) : (
              `Importar ${rows.length || ""} produto(s)`
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

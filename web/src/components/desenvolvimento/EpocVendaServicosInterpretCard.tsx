import { Badge } from "@/components/ui/badge";
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
  catalogActionLabel,
  previewEpocVendaServicosInterpret,
  skipReasonLabel,
  type ServicoVendaCatalogAction,
  type ServicoVendasInterpretPreview,
} from "@/lib/epocVendaServicosInterpret";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { FileSearch, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatQty(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  });
}

function actionBadgeClass(action: ServicoVendaCatalogAction): string {
  if (action === "create_service") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
  }
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100";
}

export function EpocVendaServicosInterpretCard() {
  const { currentCompany } = useCompany();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ServicoVendasInterpretPreview | null>(
    null,
  );

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (!currentCompany) {
      toast.error("Selecione uma unidade no menu.");
      return;
    }

    setLoading(true);
    setPreview(null);
    try {
      const [servicesRes, text] = await Promise.all([
        supabase
          .from("services")
          .select("id, code, name, is_active")
          .eq("company_id", currentCompany.id),
        file.text(),
      ]);
      if (servicesRes.error) throw servicesRes.error;

      const result = previewEpocVendaServicosInterpret(text, file.name, [
        ...(servicesRes.data ?? []),
      ]);
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
        e instanceof Error ? e.message : "Não foi possível ler o arquivo.";
      toast.error(msg);
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSearch className="size-4" />
          EPOC — interpretar venda de serviços (CSV)
        </CardTitle>
        <CardDescription>
          Envie o CSV do export de serviços para ver, por dia e por código, o
          que seria <strong>criado</strong> ou <strong>associado</strong> ao
          cadastro (match por código), com quantidade e{" "}
          <strong>Vl.Bruto(R$)</strong>. A coluna Total do relatório é
          ignorada. Linhas do mesmo código no mesmo dia seriam somadas no
          persist real.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="epoc-vs-interpret-file">Arquivo CSV</Label>
          <Input
            ref={inputRef}
            id="epoc-vs-interpret-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={loading || !currentCompany}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={loading || !currentCompany}
          onClick={() => inputRef.current?.click()}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Interpretando…
            </>
          ) : (
            <>
              <Upload className="size-4" />
              Escolher CSV
            </>
          )}
        </Button>

        {preview ? (
          <div className="space-y-6 border-t pt-4">
            <div className="text-muted-foreground space-y-1 text-sm">
              <p>
                Arquivo:{" "}
                <span className="text-foreground">{preview.fileName}</span>
                {" · "}
                {preview.totals.rawRows} linha(s) brutas
                {preview.totals.itemRows > 0
                  ? ` · ${preview.totals.itemRows} item(ns)`
                  : ""}
              </p>
              {!preview.ok && preview.error ? (
                <p className="text-destructive">{preview.error}</p>
              ) : null}
            </div>

            {preview.ok ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryTile
                    label="Linhas válidas"
                    value={String(preview.totals.validLines)}
                    hint={`${preview.totals.skippedLines} ignorada(s)`}
                  />
                  <SummaryTile
                    label="Vl. Bruto"
                    value={formatBrl(preview.totals.vlBruto)}
                    hint={`${formatQty(preview.totals.quantity)} un · ${preview.totals.days} dia(s)`}
                  />
                  <SummaryTile
                    label="Criar serviço"
                    value={String(preview.totals.wouldCreateServices)}
                    hint="códigos sem match no cadastro"
                  />
                  <SummaryTile
                    label="Já cadastrados"
                    value={String(preview.totals.wouldMatchServices)}
                    hint="match exato por código"
                  />
                </div>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Por dia</h4>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[36rem] text-left text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Data</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Linhas
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Qtde
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Vl. Bruto
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Serviços
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Criar
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Existente
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.days.map((d) => (
                          <tr
                            key={d.dataIso}
                            className="border-b border-border/60 last:border-0"
                          >
                            <td className="px-3 py-2 font-medium">
                              {d.dataLabel}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {d.lineCount}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatQty(d.quantity)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBrl(d.vlBruto)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {d.uniqueServices}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {d.wouldCreate}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {d.wouldMatch}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium">
                    Por serviço ({preview.services.length})
                  </h4>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[44rem] text-left text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Ação</th>
                          <th className="px-3 py-2 font-medium">Código</th>
                          <th className="px-3 py-2 font-medium">Serviço CSV</th>
                          <th className="px-3 py-2 font-medium">Match</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Linhas
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Qtde
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Vl. Bruto
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Dias
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.services.map((s) => (
                          <tr
                            key={s.key}
                            className="border-b border-border/60 last:border-0"
                          >
                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-normal",
                                  actionBadgeClass(s.catalogAction),
                                )}
                              >
                                {catalogActionLabel(s.catalogAction)}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {s.code}
                            </td>
                            <td className="px-3 py-2 font-medium">{s.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {s.matchedLabel ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {s.lineCount}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatQty(s.quantity)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatBrl(s.vlBruto)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {s.days.length}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {preview.skipped.length > 0 ? (
                  <section className="space-y-2">
                    <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Linhas ignoradas ({preview.skipped.length})
                    </h4>
                    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
                      {preview.skipped.slice(0, 60).map((s) => (
                        <li key={`${s.rowNumber}-${s.reason}`}>
                          <span className="font-mono text-xs">
                            L{s.rowNumber}
                          </span>
                          {" · "}
                          {skipReasonLabel(s.reason)}
                          {s.code ? ` · ${s.code}` : ""}
                          {s.name ? ` ${s.name}` : ""}
                          {" · "}
                          <span className="text-muted-foreground">
                            {s.detail}
                          </span>
                        </li>
                      ))}
                      {preview.skipped.length > 60 ? (
                        <li className="text-muted-foreground">
                          … e mais {preview.skipped.length - 60}
                        </li>
                      ) : null}
                    </ul>
                  </section>
                ) : null}

                <p className="text-muted-foreground text-xs">
                  Colunas usadas: data=data_consulta, código=
                  {preview.headers[preview.columns.codigo] ?? "—"}, serviço=
                  {preview.headers[preview.columns.servico] ?? "—"}, qtde=
                  {preview.headers[preview.columns.quantidade] ?? "—"}, valor=
                  {preview.headers[preview.columns.vlBruto] ?? "Vl.Bruto(R$)"}.
                  Match por código; códigos novos seriam criados no sync real.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="text-foreground text-lg font-semibold tabular-nums">
        {value}
      </p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

import {
  NfeStagingInterpretPreviewCard,
  type StagingInterpretPreviewResult,
} from "@/components/desenvolvimento/NfeStagingInterpretPreviewCard";
import {
  NfeXmlDataPreviewCard,
  type NfeXmlDataPreview,
} from "@/components/desenvolvimento/NfeXmlDataPreviewCard";
import {
  NfeUnitPriceBreakdownCard,
  type NfeUnitPricePreviewResult,
} from "@/components/desenvolvimento/NfeUnitPriceBreakdownCard";
import { EpocFaturamentoExportCard } from "@/components/desenvolvimento/EpocFaturamentoExportCard";
import { EpocSyncDayCard } from "@/components/desenvolvimento/EpocSyncDayCard";
import { EpocVendaProdutosExportCard } from "@/components/desenvolvimento/EpocVendaProdutosExportCard";
import { EpocVendaServicosExportCard } from "@/components/desenvolvimento/EpocVendaServicosExportCard";
import { OnboardingResetCard } from "@/components/desenvolvimento/OnboardingResetCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UnitSetupResetCard } from "@/components/unit-setup/UnitSetupResetCard";
import { useCompany } from "@/contexts/CompanyContext";
import { defaultOnboardingFiscalRecord } from "@/lib/onboardingFiscalDefaults";
import {
  fetchSupabaseEdgeFunction,
  formatSupabaseFunctionError,
  supabase,
  supabaseUrl,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { hasFocusNfeEmpresaId } from "@/services/focusAtualizarCertificadoService";
import { FileCode2, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

type NfeXmlDetLinePreview = {
  n_item: string | null;
  c_prod: string | null;
  x_prod: string | null;
  prod: Record<string, unknown>;
};

type PreviewOkResponse = {
  ok: true;
  file_name: string;
  xml_data: NfeXmlDataPreview;
  unit_price_preview: NfeUnitPricePreviewResult | null;
  det_lines: NfeXmlDetLinePreview[];
  staging_interpret: StagingInterpretPreviewResult | null;
  staging_interpret_error?: string | null;
};

type FocusGetSyncNfeDetailRow = {
  company_id?: string;
  cnpj?: string;
  ok?: boolean;
  skipped?: string;
  error?: string;
  exec_id?: string;
  notasEncontradas?: number;
  quantasBuscasForamExecutadas?: number;
  temposDeProcessamento?: Record<string, unknown>;
};

type FocusGetSyncNfeResponse = {
  ok?: boolean;
  error?: string;
  exec_id?: string;
  detail?: FocusGetSyncNfeDetailRow[];
  metrics?: Record<string, unknown>;
};

export function Desenvolvimento() {
  const { currentCompany, refetchCompanies } = useCompany();
  const companyId = currentCompany?.id ?? "";
  const companyLabel = currentCompany?.name?.trim() || "—";
  const cnpjDigits = String(currentCompany?.document ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);
  const hasFocus = hasFocusNfeEmpresaId(currentCompany?.focusnfe ?? null);

  const [mainTab, setMainTab] = useState<"geral" | "epoc" | "fiscal">("geral");

  const [getSyncVersao, setGetSyncVersao] = useState("");
  const [getSyncOnboarding, setGetSyncOnboarding] = useState(true);
  const [loadingGetSyncNfe, setLoadingGetSyncNfe] = useState(false);
  const [getSyncError, setGetSyncError] = useState<string | null>(null);
  const [getSyncLastJson, setGetSyncLastJson] = useState<string | null>(null);
  const [getSyncResponse, setGetSyncResponse] =
    useState<FocusGetSyncNfeResponse | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewOkResponse | null>(
    null,
  );
  const runGetSyncNfe = useCallback(async () => {
    if (!companyId) {
      toast.error("Selecione uma unidade (empresa) no app.");
      return;
    }
    if (!hasFocus) {
      toast.error("A unidade precisa de id_empresa Focus em focusnfe.");
      return;
    }
    if (cnpjDigits.length !== 14) {
      toast.error(
        "CNPJ da unidade deve ter 14 dígitos (documento da empresa).",
      );
      return;
    }
    let versao: number | undefined;
    const vTrim = getSyncVersao.trim();
    if (vTrim !== "") {
      const v = Number(vTrim);
      if (!Number.isFinite(v) || v < 0) {
        toast.error("Versão inicial: número ≥ 0 ou vazio.");
        return;
      }
      versao = Math.floor(v);
    }

    setLoadingGetSyncNfe(true);
    setGetSyncError(null);
    setGetSyncLastJson(null);
    setGetSyncResponse(null);
    try {
      if (getSyncOnboarding) {
        const { error: fiscalResetErr } = await supabase
          .from("companies")
          .update({ onboarding_fiscal: defaultOnboardingFiscalRecord() })
          .eq("id", companyId);
        if (fiscalResetErr) {
          const msg =
            fiscalResetErr.message ??
            "Não foi possível repor onboarding_fiscal aos valores iniciais.";
          setGetSyncError(msg);
          toast.error(msg);
          return;
        }
        await refetchCompanies();
      }

      const body: Record<string, unknown> = {
        manual: true,
        company_id: companyId,
      };
      if (versao !== undefined) body.versao = versao;
      if (getSyncOnboarding) body.onboarding = true;

      const { data, error } = await supabase.functions.invoke(
        "focus-get-sync-nfe",
        {
          body,
        },
      );
      if (error) {
        const msg = formatSupabaseFunctionError(error);
        setGetSyncError(msg);
        toast.error(msg);
        return;
      }
      const typed = (data ?? {}) as FocusGetSyncNfeResponse;
      setGetSyncResponse(typed);
      setGetSyncLastJson(JSON.stringify(typed, null, 2));
      const ok = typed.ok === true;
      const d0 = Array.isArray(typed.detail) ? typed.detail[0] : undefined;
      if (ok && d0?.ok === true) {
        toast.success(`Busca na SEFAZ concluída.`);
        if (getSyncOnboarding) await refetchCompanies();
      } else if (ok && d0?.skipped) {
        toast.message(String(d0.skipped));
      } else {
        const err =
          typeof typed.error === "string"
            ? typed.error
            : typeof d0?.error === "string"
              ? d0.error
              : "Resposta inesperada";
        setGetSyncError(err);
        toast.error(err);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setGetSyncError(msg);
      toast.error(msg);
    } finally {
      setLoadingGetSyncNfe(false);
    }
  }, [
    companyId,
    cnpjDigits.length,
    getSyncVersao,
    getSyncOnboarding,
    hasFocus,
    refetchCompanies,
  ]);

  const runPreview = useCallback(async () => {
    if (!companyId) {
      toast.error("Selecione uma unidade.");
      return;
    }
    const file = fileInputRef.current?.files?.[0];
    if (!file || file.size === 0) {
      toast.error("Escolha um ficheiro .xml.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xml")) {
      toast.error("Use um ficheiro com extensão .xml.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error("Sessão expirada. Entre novamente.");
      return;
    }
    if (!supabaseUrl) {
      toast.error("VITE_SUPABASE_URL não configurado.");
      return;
    }

    setLoadingPreview(true);
    setPreviewError(null);
    setPreviewResult(null);

    try {
      const form = new FormData();
      form.append("company_id", companyId);
      form.append("file", file);

      const res = await fetchSupabaseEdgeFunction(
        "dev-preview-nfe-xml",
        { method: "POST", body: form },
        session.access_token,
      );

      let payload: Record<string, unknown> | null = null;
      const ct = (res.headers.get("Content-Type") ?? "").split(";")[0].trim();
      if (ct === "application/json") {
        payload = (await res.json()) as Record<string, unknown>;
      } else {
        const text = await res.text();
        if (!res.ok) {
          const msg = text
            ? `HTTP ${res.status}: ${text.slice(0, 500)}`
            : `HTTP ${res.status}`;
          setPreviewError(msg);
          toast.error(msg);
          return;
        }
        setPreviewError("Resposta não-JSON da função.");
        toast.error("Resposta não-JSON da função.");
        return;
      }

      if (!res.ok) {
        const err =
          typeof payload?.error === "string"
            ? payload.error
            : `HTTP ${res.status}`;
        setPreviewError(err);
        toast.error(err);
        return;
      }

      if (!payload || typeof payload !== "object") {
        setPreviewError("Resposta vazia da função.");
        toast.error("Resposta vazia da função.");
        return;
      }

      if (payload.ok !== true || !payload.xml_data) {
        const err =
          typeof payload.error === "string"
            ? payload.error
            : "Resposta inválida";
        setPreviewError(err);
        toast.error(err);
        return;
      }

      setPreviewResult(payload as PreviewOkResponse);
      toast.success("XML analisado.");
    } catch (e) {
      const msg = formatSupabaseFunctionError(e) || "Erro ao enviar XML.";
      setPreviewError(msg);
      toast.error(msg);
    } finally {
      setLoadingPreview(false);
    }
  }, [companyId]);

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title="Administrador"
        description="Ferramentas internas para a unidade selecionada no menu."
        icon={FlaskConical}
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-px">
        <button
          type="button"
          onClick={() => setMainTab("geral")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            mainTab === "geral"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Geral
        </button>
        <button
          type="button"
          onClick={() => setMainTab("epoc")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            mainTab === "epoc"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          EPOC
        </button>
        <button
          type="button"
          onClick={() => setMainTab("fiscal")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            mainTab === "fiscal"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Fiscal
        </button>
      </div>

      {mainTab === "geral" ? (
        <div className="space-y-6">
          <UnitSetupResetCard />
          <OnboardingResetCard />
        </div>
      ) : null}

      {mainTab === "epoc" ? (
        <div className="space-y-8">
          <EpocSyncDayCard />

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Vendas</h2>
              <p className="text-muted-foreground text-sm">
                Cada fluxo gera o CSV no portal e interpreta o resultado. Se o
                arquivo já existir, use só Escolher CSV.
              </p>
            </div>
            <div className="space-y-6">
              <EpocVendaProdutosExportCard />
              <EpocVendaServicosExportCard />
            </div>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Faturamento</h2>
              <p className="text-muted-foreground text-sm">
                Gera o CSV no portal e interpreta o resultado. Se o arquivo já
                existir, use só Escolher CSV.
              </p>
            </div>
            <EpocFaturamentoExportCard />
          </section>
        </div>
      ) : null}

      {mainTab === "fiscal" ? (
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Sync NFs</h2>
              <p className="text-muted-foreground text-sm">
                Listagem resumida na Focus para a unidade selecionada.
              </p>
            </div>
          <Card className="w-full min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Listagem resumida: focus-get-sync-nfe
              </CardTitle>
              <CardDescription>
                Chama a Edge Function só para{" "}
                <span className="font-medium text-foreground">
                  {companyLabel}
                </span>
                {companyId ? (
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">
                    {companyId}
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 space-y-6">
              <div className="space-y-2 max-w-md">
                <Label htmlFor="dev-getsync-versao">
                  Versão inicial (opcional)
                </Label>
                <Input
                  id="dev-getsync-versao"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Vazio = usar cursor em focusnfe.nfes_recebidas_ultima_versao"
                  value={getSyncVersao}
                  onChange={(e) => setGetSyncVersao(e.target.value)}
                  disabled={loadingGetSyncNfe || !companyId}
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="dev-getsync-onboarding"
                  checked={getSyncOnboarding}
                  onCheckedChange={(v) => setGetSyncOnboarding(v === true)}
                  disabled={loadingGetSyncNfe || !companyId}
                />
                <Label
                  htmlFor="dev-getsync-onboarding"
                  className="font-normal text-sm"
                >
                  Fluxo onboarding (
                  <code className="rounded bg-muted px-1 text-xs">
                    onboarding: true
                  </code>
                  {" — "}redefine{" "}
                  <code className="rounded bg-muted px-1 text-xs">
                    onboarding_fiscal
                  </code>{" "}
                  (sync, completed, contadores) antes do sync e atualiza{" "}
                  <code className="rounded bg-muted px-1 text-xs">
                    max_nfes_sync
                  </code>{" "}
                  após a primeira lista Focus)
                </Label>
              </div>

              <Button
                type="button"
                disabled={
                  loadingGetSyncNfe ||
                  !companyId ||
                  !hasFocus ||
                  cnpjDigits.length !== 14
                }
                onClick={() => void runGetSyncNfe()}
              >
                {loadingGetSyncNfe ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />A listar na
                    Focus…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Executar sync resumido
                  </>
                )}
              </Button>

              {!companyId ? (
                <p className="text-sm text-muted-foreground">
                  Selecione uma unidade.
                </p>
              ) : !hasFocus ? (
                <p className="text-sm text-muted-foreground">
                  Associe a unidade à Focus (id_empresa) para habilitar.
                </p>
              ) : cnpjDigits.length !== 14 ? (
                <p className="text-sm text-muted-foreground">
                  O documento da unidade precisa de um CNPJ com 14 dígitos.
                </p>
              ) : null}

              {getSyncResponse?.exec_id ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">exec_id</span>{" "}
                  <code className="rounded bg-muted px-1 font-mono">
                    {getSyncResponse.exec_id}
                  </code>
                  {" — "}exemplo no SQL Editor:{" "}
                  <code className="break-all rounded bg-muted px-1 font-mono text-[11px]">
                    {`select * from public.focus_get_sync_nfe_staging where exec_id = '${getSyncResponse.exec_id}';`}
                  </code>
                </p>
              ) : null}

              {getSyncError ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {getSyncError}
                </div>
              ) : null}

              {getSyncResponse?.detail?.[0] &&
              getSyncResponse.detail[0].ok === true &&
              getSyncResponse.detail[0].temposDeProcessamento ? (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
                  <p>
                    <span className="text-muted-foreground">CNPJ:</span>{" "}
                    <span className="font-mono">
                      {String(getSyncResponse.detail[0].cnpj ?? "—")}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      Notas encontradas (gravadas):
                    </span>{" "}
                    {String(getSyncResponse.detail[0].notasEncontradas ?? 0)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      Buscas Focus executadas:
                    </span>{" "}
                    {String(
                      getSyncResponse.detail[0].quantasBuscasForamExecutadas ??
                        0,
                    )}
                  </p>
                  <p className="text-muted-foreground">Tempos (ms / objeto):</p>
                  <pre className="max-h-40 overflow-auto rounded border bg-background/80 p-2 font-mono text-[11px]">
                    {JSON.stringify(
                      getSyncResponse.detail[0].temposDeProcessamento,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ) : null}

              {getSyncLastJson ? (
                <div className="space-y-2">
                  <Label>Resposta JSON</Label>
                  <pre className="max-h-[min(70vh,560px)] overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono">
                    {getSyncLastJson}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Pré-visualizar XML</h2>
              <p className="text-muted-foreground text-sm">
                Analisa um XML de NF-e sem gravar no banco.
              </p>
            </div>
        <Card className="w-full min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5" />
              Pré-visualizar XML (NF-e)
            </CardTitle>
            <CardDescription>
              Envie um XML de NF-e da unidade{" "}
              <span className="font-medium text-foreground">
                {companyLabel}
              </span>
              . Exibe os dados do XML, o valor unitário efetivo e a simulação
              completa da interpretação staging (fornecedor, produtos,
              conversões, despesa e boletos) — sem gravar no banco.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="dev-xml-file">Ficheiro XML</Label>
              <Input
                id="dev-xml-file"
                ref={fileInputRef}
                type="file"
                accept=".xml,application/xml,text/xml"
                disabled={loadingPreview || !companyId}
                className="max-w-md cursor-pointer font-mono text-sm"
              />
            </div>

            <Button
              type="button"
              disabled={loadingPreview || !companyId}
              onClick={() => void runPreview()}
            >
              {loadingPreview ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A analisar…
                </>
              ) : (
                <>
                  <FileCode2 className="mr-2 h-4 w-4" />
                  Analisar XML
                </>
              )}
            </Button>

            {previewError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {previewError}
              </div>
            ) : null}

            {previewResult ? (
              <div className="space-y-6">
                <NfeXmlDataPreviewCard
                  fileName={previewResult.file_name}
                  xmlData={previewResult.xml_data}
                  detLines={previewResult.det_lines}
                />

                <NfeUnitPriceBreakdownCard
                  preview={previewResult.unit_price_preview}
                />

                <NfeStagingInterpretPreviewCard
                  preview={previewResult.staging_interpret}
                  error={previewResult.staging_interpret_error}
                />

                <details className="rounded-md border">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    JSON da resposta
                  </summary>
                  <pre className="max-h-[min(50vh,400px)] overflow-auto border-t bg-muted/30 p-3 text-xs font-mono">
                    {JSON.stringify(previewResult, null, 2)}
                  </pre>
                </details>
              </div>
            ) : null}
          </CardContent>
        </Card>
          </section>
        </div>
      ) : null}
    </PageShell>
  );
}

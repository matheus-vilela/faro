import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
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
import { useCompany } from "@/contexts/CompanyContext";
import { consolidationKey } from "@/lib/productImport/consolidateItems";
import { stripPackSizeFromLabel } from "@/lib/productImport/packSizeFromLabel";
import {
  fetchSupabaseEdgeFunction,
  formatSupabaseFunctionError,
  supabase,
  supabaseUrl,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { hasFocusNfeEmpresaId } from "@/services/focusAtualizarCertificadoService";
import {
  ChevronRight,
  FileCode2,
  FlaskConical,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

type PreviewOkResponse = {
  ok: true;
  dry_run?: boolean;
  simulate_import_batch?: boolean;
  ai_line_units_preview?: boolean;
  line_units_ai?: Record<string, unknown> | null;
  defer_product_creation_to_reconciliation?: boolean | null;
  borderline_llm_calls?: number | null;
  catalog_preview?: {
    items: Array<{ id: string; name: string; unit: string | null }>;
    truncated: boolean;
    limit: number;
  };
  file_name?: string;
  hint?: string;
  raw: Record<string, unknown>;
  enriched: Record<string, unknown>;
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

function formatMaybeBrl(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return BRL_PREVIEW.format(n);
}

const BRL_PREVIEW = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatPreviewBrl(v: unknown): string {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  return BRL_PREVIEW.format(n);
}

/** Códigos de `previewLineDecision.manual_review.reason_codes` → rótulos em PT-BR (somente UI). */
const LAB_REVIEW_REASON_PT: Record<string, string> = {
  PRODUCT_MATCH_NEEDS_CONFIRMATION:
    "Confirmação do vínculo do produto necessária",
  UNIT_CONFLICT_OR_VALIDATION: "Conflito ou validação de unidade",
  PRIMARY_UNIT_NOT_UN:
    "Unidade primária sugerida não é UN — confirmar cadastro",
  NO_CLEAR_EXISTING_PRODUCT: "Sem produto existente claro (possível item novo)",
  POSSIBLE_FICHA_TECNICA_NAME: "Possível ficha técnica ou preparo (nome)",
  NO_RECIPE_LINK_EVIDENCE: "Sem evidência de vínculo com receita",
  LINE_TOTAL_NUMERIC_MISMATCH:
    "Inconsistência numérica na linha (quantidade × valor ≠ total)",
};

function labReasonLabelPt(code: string): string {
  return LAB_REVIEW_REASON_PT[code] ?? code;
}

const LAB_MANUAL_STATUS_PT: Record<string, string> = {
  REVIEW_REQUIRED: "Revisão necessária",
  OK: "OK",
};

function labManualStatusLabelPt(status: string): string {
  return LAB_MANUAL_STATUS_PT[status] ?? status;
}

/** Igual à lógica do Edge (`invoiceLineUnitsLlmAssist`): nome para card sem unidade no rótulo. */
function catalogCardTitleClean(
  raw: string,
  unitCommercial: unknown,
  unitTax: unknown,
): string {
  let s = stripPackSizeFromLabel(raw).trim();
  const units = [
    ...new Set(
      [unitCommercial, unitTax]
        .filter(Boolean)
        .map((u) => String(u).trim())
        .filter((u) => u.length >= 2 && u.length <= 16),
    ),
  ];
  for (const u of units) {
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:\\s+|-)\\s*${esc}\\s*\\.?\\s*$`, "i");
    const next = s.replace(re, "").trim();
    if (next.length >= 2) s = next;
  }
  const out = s.replace(/\s+/g, " ").trim();
  return out || raw.trim();
}

/** Alinhado ao default jsonb em `companies.onboarding_fiscal` (migrations). */
const DEFAULT_ONBOARDING_FISCAL = {
  sync: true,
  max_nfes_sync: 0,
  nfes_sync: 0,
  nfes_ignored: 0,
  completed: false,
  interpret_confirmed: false,
} as const;

export function Desenvolvimento() {
  const { currentCompany, refetchCompanies } = useCompany();
  const companyId = currentCompany?.id ?? "";
  const companyLabel = currentCompany?.name?.trim() || "—";
  const cnpjDigits = String(currentCompany?.document ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);
  const hasFocus = hasFocusNfeEmpresaId(currentCompany?.focusnfe ?? null);

  const [mainTab, setMainTab] = useState<"syncNfs" | "preview">("syncNfs");

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
  const [simulateImportBatch, setSimulateImportBatch] = useState(false);
  const [aiLineUnitsPreview, setAiLineUnitsPreview] = useState(false);

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
      const { error: fiscalResetErr } = await supabase
        .from("companies")
        .update({ onboarding_fiscal: { ...DEFAULT_ONBOARDING_FISCAL } })
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
        toast.success(
          `Listagem resumida concluída. Notas gravadas (nfe_completa): ${String(d0.notasEncontradas ?? 0)}.`,
        );
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
      form.append(
        "simulate_import_batch",
        simulateImportBatch ? "true" : "false",
      );
      if (aiLineUnitsPreview) {
        form.append("ai_line_units_preview", "true");
      }

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

      if (payload.ok !== true || !payload.raw || !payload.enriched) {
        const err =
          typeof payload.error === "string"
            ? payload.error
            : "Resposta inválida";
        setPreviewError(err);
        toast.error(err);
        return;
      }

      setPreviewResult(payload as PreviewOkResponse);
      toast.success("Pré-visualização pronta.");
    } catch (e) {
      const msg = formatSupabaseFunctionError(e) || "Erro ao enviar XML.";
      setPreviewError(msg);
      toast.error(msg);
    } finally {
      setLoadingPreview(false);
    }
  }, [companyId, simulateImportBatch, aiLineUnitsPreview]);

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title="Desenvolvimento"
        description="Ferramentas internas para a unidade selecionada no menu."
        icon={FlaskConical}
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-px">
        <button
          type="button"
          onClick={() => setMainTab("syncNfs")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            mainTab === "syncNfs"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Sync NFs
        </button>
        <button
          type="button"
          onClick={() => setMainTab("preview")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            mainTab === "preview"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Pré-visualizar XML (NF-e)
        </button>
      </div>

      {mainTab === "syncNfs" ? (
        <div className="space-y-6">
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
                . Lista NF-e recebidas na Focus (sem parâmetro{" "}
                <code className="rounded bg-muted px-1 text-xs">limite</code>;
                tamanho da página é o da API) com paginação por{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  x-total-count
                </code>{" "}
                /{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  x-max-version
                </code>{" "}
                e grava em{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  focus_get_sync_nfe_staging
                </code>{" "}
                apenas notas com{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  nfe_completa
                </code>{" "}
                explicitamente verdadeiro (sem download de XML nem fila de
                import). Com{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  onboarding: true
                </code>
                , a primeira lista Focus bem-sucedida atualiza{" "}
                <code className="rounded bg-muted px-1 text-xs">
                  companies.onboarding_fiscal.max_nfes_sync
                </code>{" "}
                para o dashboard.
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
                  {" — "}atualiza{" "}
                  <code className="rounded bg-muted px-1 text-xs">
                    onboarding_fiscal
                  </code>{" "}
                  na empresa após a primeira lista Focus)
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
        </div>
      ) : (
        <Card className="w-full min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5" />
              Laboratório: extração a partir de XML
            </CardTitle>
            <CardDescription>
              Envie um XML de NF-e da unidade{" "}
              <span className="font-medium text-foreground">
                {companyLabel}
              </span>
              . A leitura é{" "}
              <strong className="text-foreground">determinística</strong>{" "}
              (parser em{" "}
              <code className="rounded bg-muted px-1 text-xs">parseNfeXml</code>
              ); «enriched» aplica matching de produtos{" "}
              <strong className="text-foreground">sem gravar fornecedor</strong>
              .
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

            <div className="flex items-center gap-2">
              <Checkbox
                id="dev-simulate-batch"
                checked={simulateImportBatch}
                onCheckedChange={(v) => setSimulateImportBatch(v === true)}
                disabled={loadingPreview || !companyId}
              />
              <Label htmlFor="dev-simulate-batch" className="font-normal">
                Modo económico (desliga IA/embeddings de catálogo)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              Por defeito o laboratório usa a mesma política que o motor XML em
              produção (matching com IA quando as regras permitem). Activar esta
              opção reproduce o comportamento antigo com{" "}
              <code className="rounded bg-muted px-1">importBatch</code> sem
              assistência LLM/embeddings.
            </p>

            <div className="flex items-center gap-2">
              <Checkbox
                id="dev-ai-line-units"
                checked={aiLineUnitsPreview}
                onCheckedChange={(v) => setAiLineUnitsPreview(v === true)}
                disabled={loadingPreview || !companyId}
              />
              <Label htmlFor="dev-ai-line-units" className="font-normal">
                IA: unidades, conversões e stock (laboratório)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              Chama a OpenAI por linha (limite em{" "}
              <code className="rounded bg-muted px-1 text-xs">
                LINE_UNITS_AI_MAX_PER_PREVIEW
              </code>{" "}
              (padrão 8) e paralelismo{" "}
              <code className="rounded bg-muted px-1 text-xs">
                LINE_UNITS_AI_CONCURRENCY
              </code>{" "}
              (padrão 4).{" "}
              <strong className="text-foreground">
                Substituição automática
              </strong>{" "}
              só quando{" "}
              <code className="rounded bg-muted px-1 text-xs">confidence</code>{" "}
              ≥{" "}
              <code className="rounded bg-muted px-1 text-xs">
                LINE_UNITS_AI_AUTO_CONFIDENCE_THRESHOLD
              </code>{" "}
              (padrão 0,92) e a validação numérica da linha passa — por agora só
              para análise na tabela; importação real não usa isto.
            </p>

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
                {previewResult.hint ? (
                  <p className="text-sm text-muted-foreground">
                    {previewResult.hint}
                  </p>
                ) : null}

                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1">
                  <p>
                    <span className="text-muted-foreground">
                      Modo batch simulado:
                    </span>{" "}
                    {previewResult.simulate_import_batch ? "sim" : "não"}
                  </p>
                  {previewResult.defer_product_creation_to_reconciliation !=
                  null ? (
                    <p>
                      <span className="text-muted-foreground">
                        defer_product_creation_to_reconciliation:
                      </span>{" "}
                      {String(
                        previewResult.defer_product_creation_to_reconciliation,
                      )}
                    </p>
                  ) : null}
                  {previewResult.borderline_llm_calls != null ? (
                    <p>
                      <span className="text-muted-foreground">
                        borderline_llm_calls:
                      </span>{" "}
                      {previewResult.borderline_llm_calls}
                    </p>
                  ) : null}
                </div>

                <NfePreviewSimulationTable
                  enriched={previewResult.enriched}
                  raw={previewResult.raw}
                  lineUnitsAi={previewResult.line_units_ai ?? null}
                />

                <ExtractedSummaryBlock
                  title="Resumo (enriched — após matching)"
                  doc={previewResult.enriched}
                />
                <ExtractedSummaryBlock
                  title="Resumo (raw — só parser XML)"
                  doc={previewResult.raw}
                />

                <details className="rounded-md border">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                    JSON completo (raw + enriched)
                  </summary>
                  <pre className="max-h-[min(50vh,400px)] overflow-auto border-t bg-muted/30 p-3 text-xs font-mono">
                    {JSON.stringify(
                      {
                        simulate_import_batch:
                          previewResult.simulate_import_batch,
                        ai_line_units_preview:
                          previewResult.ai_line_units_preview,
                        line_units_ai: previewResult.line_units_ai,
                        defer_product_creation_to_reconciliation:
                          previewResult.defer_product_creation_to_reconciliation,
                        borderline_llm_calls:
                          previewResult.borderline_llm_calls,
                        catalog_preview: previewResult.catalog_preview,
                        raw: previewResult.raw,
                        enriched: previewResult.enriched,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function NfePreviewSimulationTable({
  enriched,
  raw,
  lineUnitsAi,
}: {
  enriched: Record<string, unknown>;
  raw: Record<string, unknown>;
  lineUnitsAi: Record<string, unknown> | null;
}) {
  const items = Array.isArray(enriched.items)
    ? (enriched.items as Record<string, unknown>[])
    : [];
  const rawItems = Array.isArray(raw.items)
    ? (raw.items as Record<string, unknown>[])
    : [];
  const rawNameByConsolidationKey = new Map<string, string>();
  for (const r of rawItems) {
    const maybeName = r?.productName != null ? String(r.productName) : "";
    if (!maybeName) continue;
    const key = consolidationKey({
      productName: maybeName,
      quantity: Number(r?.quantity ?? 0) || 0,
      unitValue: Number(r?.unitValue ?? 0) || 0,
      lineTotal: Number(r?.lineTotal ?? 0) || 0,
      unitCommercial:
        r?.unitCommercial != null ? String(r.unitCommercial) : null,
      unitTax: r?.unitTax != null ? String(r.unitTax) : null,
      invoiceUnitRaw: null,
      ncm: r?.ncm != null ? String(r.ncm) : null,
      ean: r?.ean != null ? String(r.ean) : null,
    });
    if (!rawNameByConsolidationKey.has(key)) {
      rawNameByConsolidationKey.set(key, maybeName);
    }
  }

  if (items.length === 0) {
    return null;
  }

  const hasSim = items.some((it) => it._preview_line_simulation != null);
  const hasAi = items.some((it) => it._preview_line_ai_units != null);
  if (!hasSim) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem dados de simulação por linha (apenas em notas de compra com itens
        matched).
      </p>
    );
  }

  const aiMeta = lineUnitsAi;
  const aiValidationMode = aiMeta?.enabled === true;
  const aiCalls =
    typeof aiMeta?.calls_made === "number" ? aiMeta.calls_made : null;
  const aiThreshold =
    typeof aiMeta?.auto_confidence_threshold === "number"
      ? aiMeta.auto_confidence_threshold
      : null;

  return (
    <div className="space-y-2">
      <div className="w-full min-w-0 space-y-3 rounded-lg border bg-muted/10 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">
            Pré-visualização no catálogo
          </h3>
          <span className="text-xs text-muted-foreground">
            (nome ajustado, unidade e valor de compra nesta NF-e)
          </span>
        </div>
        <p className="text-xs text-muted-foreground max-w-3xl">
          <strong className="font-medium text-foreground">
            Produto existente
          </strong>{" "}
          mostra o nome já cadastrado quando há match automático.{" "}
          <strong className="font-medium text-foreground">Novo cadastro</strong>{" "}
          combina heurística do nome da nota; a{" "}
          <strong className="font-medium text-foreground">
            unidade de cadastro
          </strong>{" "}
          é validada pelo contexto do laboratório. Com IA ativa, esta tela
          prioriza os campos finais de contexto
          (`unitSuggestion`/`previewLineDecision`) para validação. O valor é o{" "}
          <strong className="font-medium text-foreground">
            unitário ajustado
          </strong>{" "}
          (após fator de embalagem na linha, quando aplicável).
        </p>
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => {
            const rawIt = rawItems[i] ?? null;
            const rawKey = consolidationKey({
              productName: String(it.productName ?? ""),
              quantity: Number(it.quantity ?? 0) || 0,
              unitValue: Number(it.unitValue ?? 0) || 0,
              lineTotal: Number(it.lineTotal ?? 0) || 0,
              unitCommercial:
                it.unitCommercial != null ? String(it.unitCommercial) : null,
              unitTax: it.unitTax != null ? String(it.unitTax) : null,
              invoiceUnitRaw: null,
              ncm: it.ncm != null ? String(it.ncm) : null,
              ean: it.ean != null ? String(it.ean) : null,
            });
            const rawNameByKey = rawNameByConsolidationKey.get(rawKey) ?? null;
            const sim = it._preview_line_simulation as
              | Record<string, unknown>
              | undefined;
            const pm = it.productMatch as Record<string, unknown> | undefined;
            const ai = it._preview_line_ai_units as
              | Record<string, unknown>
              | undefined;
            const aiKind = ai?.kind != null ? String(ai.kind) : "";
            const suggestedName =
              pm?.suggestedProductName != null
                ? String(pm.suggestedProductName)
                : null;
            const suggestedId =
              pm?.suggestedProductId != null
                ? String(pm.suggestedProductId)
                : null;
            const isExisting = suggestedName != null || suggestedId != null;
            const catalogName =
              sim?.catalogNameForRegistration != null
                ? String(sim.catalogNameForRegistration)
                : String(it.productName ?? "—");
            const aiName =
              aiKind === "OK" && ai?.cleaned_product_name != null
                ? String(ai.cleaned_product_name).trim()
                : "";
            const rawCardTitle = isExisting
              ? (suggestedName ?? `ID ${suggestedId ?? "—"}`)
              : aiName || catalogName;
            const displayName = catalogCardTitleClean(
              rawCardTitle,
              it.unitCommercial,
              it.unitTax,
            );
            const catUnit =
              pm?.catalogUnitNormalized != null
                ? String(pm.catalogUnitNormalized)
                : "—";
            const unitNote =
              sim?.invoiceUnitRaw != null
                ? String(sim.invoiceUnitRaw)
                : String(it.unitCommercial ?? it.unitTax ?? "—");
            const unitSuggestion = sim?.unitSuggestion as
              | Record<string, unknown>
              | undefined;
            const suggestedPrimaryUnit =
              unitSuggestion?.primary_unit_code != null
                ? String(unitSuggestion.primary_unit_code)
                : null;
            const suggestedSource =
              unitSuggestion?.source != null
                ? String(unitSuggestion.source)
                : null;
            const suggestedConversions = Array.isArray(
              unitSuggestion?.suggested_conversions,
            )
              ? (unitSuggestion.suggested_conversions as Array<
                  Record<string, unknown>
                >)
              : [];
            const suggestionNote =
              unitSuggestion?.note != null ? String(unitSuggestion.note) : null;
            const previewLineDecision = sim?.previewLineDecision as
              | Record<string, unknown>
              | undefined;
            const pldManual = previewLineDecision?.manual_review as
              | Record<string, unknown>
              | undefined;
            const pldCost = previewLineDecision?.cost_suggestion as
              | Record<string, unknown>
              | undefined;
            const pldReuse = previewLineDecision?.match_reuse as
              | Record<string, unknown>
              | undefined;
            const labReviewRequired = pldManual?.required === true;
            const labStatus =
              pldManual?.status != null ? String(pldManual.status) : null;
            const labReasonCodesRaw = Array.isArray(pldManual?.reason_codes)
              ? (pldManual.reason_codes as unknown[]).map((x) => String(x))
              : [];
            const labReasons = labReasonCodesRaw.map(labReasonLabelPt);
            const labActions = Array.isArray(pldManual?.recommended_actions)
              ? (pldManual.recommended_actions as unknown[]).map((x) =>
                  String(x),
                )
              : [];
            const labCostPrimary =
              pldCost?.unit_cost_in_primary != null &&
              Number.isFinite(Number(pldCost.unit_cost_in_primary))
                ? Number(pldCost.unit_cost_in_primary)
                : null;
            const labQtyPrimary =
              pldCost?.quantity_in_primary != null &&
              Number.isFinite(Number(pldCost.quantity_in_primary))
                ? Number(pldCost.quantity_in_primary)
                : null;
            const labLineOk = pldCost?.line_total_check_ok === true;
            const labTrace =
              pldCost?.calculation_trace != null
                ? String(pldCost.calculation_trace)
                : null;
            const labBlockedNew =
              pldReuse?.blocked_new_product_suggestion === true;
            const labPlannedAutoCreate =
              pldReuse?.planned_auto_catalog_create === true;
            const labSuggestedNewName =
              pldReuse?.suggested_new_catalog_name != null
                ? String(pldReuse.suggested_new_catalog_name).trim()
                : "";
            const hasUnitConflictReason = labReasonCodesRaw.some(
              (r) => r === "UNIT_CONFLICT_OR_VALIDATION",
            );
            const displayUnit = isExisting
              ? catUnit !== "—"
                ? catUnit
                : unitNote
              : suggestedPrimaryUnit || (catUnit !== "—" ? catUnit : unitNote);
            const vuRaw = sim?.unitValueAdjusted ?? it.unitValue;
            const lineTotal = it.lineTotal;
            const stockMatch =
              pm?.stockQuantity != null ? String(pm.stockQuantity) : null;
            const aiStock =
              aiKind === "OK" && ai?.stock_quantity_suggested != null
                ? String(ai.stock_quantity_suggested)
                : null;
            const qtyAdj =
              sim?.quantityAdjusted != null
                ? String(sim.quantityAdjusted)
                : null;
            const stockLabel = isExisting
              ? stockMatch
              : unitSuggestion?.suggested_stock_quantity_in_primary != null
                ? String(unitSuggestion.suggested_stock_quantity_in_primary)
                : (aiStock ?? stockMatch ?? qtyAdj);
            const stockCaption = isExisting
              ? "Quantidade (match)"
              : aiValidationMode
                ? "Quantidade (IA contexto)"
                : aiStock != null
                  ? "Quantidade (IA bruto)"
                  : "Quantidade (nota)";
            const invoiceName =
              rawNameByKey != null
                ? rawNameByKey
                : rawIt?.productName != null
                  ? String(rawIt.productName)
                  : "—";
            const hasLineTotal =
              lineTotal != null && String(lineTotal).trim() !== "";
            const stockUnitSuffix = displayUnit;
            return (
              <div key={i} className="flex h-full min-h-0 min-w-0 w-full">
                <div
                  className={cn(
                    "relative flex w-full max-w-full min-h-[17rem] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/25 text-left shadow-sm transition-colors",
                    "p-4 sm:p-5 md:p-6",
                    labReviewRequired
                      ? "border-amber-500/55 ring-1 ring-amber-500/25"
                      : "border-border/80",
                  )}
                >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 sm:gap-4">
                    <div className="flex min-h-0 min-w-0 flex-1 gap-3 sm:gap-4">
                      <div
                        className={cn(
                          "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-sm sm:h-12 sm:w-12",
                          "border-border/70 bg-muted/50 text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        <Package
                          className="h-5 w-5 sm:h-6 sm:w-6"
                          strokeWidth={1.6}
                        />
                      </div>

                      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                              <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                Linha {i + 1}
                              </span>
                              <Badge
                                variant={isExisting ? "secondary" : "outline"}
                                className="h-6 gap-1 px-2 text-[0.7rem] font-normal"
                              >
                                {isExisting ? "Catálogo" : "Novo cadastro"}
                              </Badge>
                              {hasUnitConflictReason ? (
                                <Badge
                                  variant="outline"
                                  className="h-6 gap-1 border-amber-500/60 bg-amber-500/10 px-2 text-[0.65rem] font-normal text-amber-950 dark:text-amber-100"
                                >
                                  Unidade a rever (contexto)
                                </Badge>
                              ) : null}
                              {labStatus === "REVIEW_REQUIRED" ? (
                                <Badge
                                  variant="outline"
                                  className="h-6 gap-1 border-amber-600/70 bg-amber-500/15 px-2 text-[0.65rem] font-normal text-amber-950 dark:text-amber-100"
                                >
                                  {labManualStatusLabelPt("REVIEW_REQUIRED")}{" "}
                                  (lab)
                                </Badge>
                              ) : previewLineDecision ? (
                                <Badge
                                  variant="outline"
                                  className="h-6 gap-1 border-emerald-600/40 bg-emerald-500/10 px-2 text-[0.65rem] font-normal text-emerald-950 dark:text-emerald-100"
                                >
                                  {labManualStatusLabelPt("OK")} (lab)
                                </Badge>
                              ) : null}
                            </div>
                            <h3
                              className="break-words text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl"
                              title={displayName}
                            >
                              {displayName}
                            </h3>
                            <p
                              className="line-clamp-2 break-words text-xs text-muted-foreground sm:text-[0.8rem]"
                              title={invoiceName}
                            >
                              <span className="font-medium text-foreground/80">
                                Na NF-e:
                              </span>{" "}
                              {invoiceName}
                            </p>
                            <p className="break-words text-xs text-muted-foreground sm:text-[0.8rem]">
                              <span className="font-mono text-[0.8rem] sm:text-sm">
                                —
                              </span>
                              <span className="mx-2 text-border">·</span>
                              <span>Unidade: {displayUnit}</span>
                              <span className="mx-2 text-border">·</span>
                              <span>Compra (NF-e): {unitNote}</span>
                            </p>
                            {suggestedPrimaryUnit ? (
                              <p className="break-words text-xs text-muted-foreground sm:text-[0.8rem]">
                                <span className="font-medium text-foreground/80">
                                  Unidade sugerida:
                                </span>{" "}
                                <span className="font-mono">
                                  {suggestedPrimaryUnit}
                                </span>
                                {suggestedSource ? (
                                  <>
                                    {" "}
                                    <span className="text-border">·</span>{" "}
                                    {suggestedSource === "existing_product"
                                      ? "produto existente"
                                      : "padrão UN"}
                                  </>
                                ) : null}
                              </p>
                            ) : null}
                            {suggestedConversions.length > 0 ? (
                              <p className="break-words text-xs text-emerald-700 dark:text-emerald-400 sm:text-[0.8rem]">
                                <span className="font-medium">
                                  Conversões sugeridas:
                                </span>{" "}
                                {suggestedConversions
                                  .map((c) => String(c.relation ?? "—"))
                                  .join(" | ")}
                              </p>
                            ) : suggestionNote ? (
                              <p className="break-words text-xs text-muted-foreground sm:text-[0.8rem]">
                                {suggestionNote}
                              </p>
                            ) : null}
                            {previewLineDecision ? (
                              <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-[0.7rem] sm:text-[0.75rem]">
                                <p className="font-medium text-foreground/90">
                                  Decisão laboratório{" "}
                                  <span className="font-normal text-muted-foreground">
                                    (somente dev-preview)
                                  </span>
                                </p>
                                {labPlannedAutoCreate ? (
                                  <p className="text-muted-foreground">
                                    <span className="font-medium text-foreground/85">
                                      Reaproveitamento:
                                    </span>{" "}
                                    cadastro automático planejado (modo batch)
                                    como{" "}
                                    <span className="font-medium text-foreground">
                                      {labSuggestedNewName || "—"}
                                    </span>
                                    .
                                  </p>
                                ) : labBlockedNew ? (
                                  <p className="text-muted-foreground">
                                    <span className="font-medium text-foreground/85">
                                      Reaproveitamento:
                                    </span>{" "}
                                    sugestão de produto novo bloqueada quando o
                                    match é considerado confiável.
                                  </p>
                                ) : (
                                  <p className="text-muted-foreground">
                                    <span className="font-medium text-foreground/85">
                                      Reaproveitamento:
                                    </span>{" "}
                                    vínculo fraco ou pendente — validar
                                    duplicidade.
                                  </p>
                                )}
                                {labCostPrimary != null ? (
                                  <p className="text-muted-foreground">
                                    <span className="font-medium text-foreground/85">
                                      Custo sugerido (un. prim.):
                                    </span>{" "}
                                    {formatPreviewBrl(labCostPrimary)}
                                    {labQtyPrimary != null ? (
                                      <>
                                        {" "}
                                        <span className="text-border">
                                          ·
                                        </span>{" "}
                                        qtd prim.{" "}
                                        <span className="font-mono tabular-nums">
                                          {labQtyPrimary}
                                        </span>
                                      </>
                                    ) : null}
                                    {!labLineOk ? (
                                      <span className="ml-1 text-amber-700 dark:text-amber-400">
                                        (NF-e: q×v ≠ total)
                                      </span>
                                    ) : null}
                                  </p>
                                ) : null}
                                {labTrace ? (
                                  <p
                                    className="font-mono text-[0.65rem] text-muted-foreground break-words"
                                    title={labTrace}
                                  >
                                    {labTrace}
                                  </p>
                                ) : null}
                                {labReasons.length > 0 ? (
                                  <p className="text-amber-900/90 dark:text-amber-200/95">
                                    <span className="font-medium">
                                      Motivos:
                                    </span>{" "}
                                    {labReasons.join(", ")}
                                  </p>
                                ) : null}
                                {labActions.length > 0 ? (
                                  <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                                    {labActions.map((a, j) => (
                                      <li key={j}>{a}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <span
                            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground sm:flex sm:h-10 sm:w-10"
                            aria-hidden
                          >
                            <ChevronRight className="h-5 w-5" />
                          </span>
                        </div>

                        <div className="mt-auto grid min-h-0 w-full min-w-0 flex-1 grid-cols-1 content-end gap-2.5 pt-2 sm:grid-cols-3 sm:gap-3">
                          <div className="flex min-h-[5.25rem] min-w-0 flex-col justify-center rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              {stockCaption}
                            </p>
                            <p className="mt-2 text-lg font-semibold tabular-nums leading-none text-foreground sm:text-xl">
                              {stockLabel != null && stockLabel !== "—" ? (
                                <span className="inline-flex flex-wrap items-baseline gap-x-1">
                                  <span>{stockLabel}</span>
                                  <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                                    {stockUnitSuffix}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </p>
                          </div>
                          <div className="flex min-h-[5.25rem] min-w-0 flex-col justify-center rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              Preço unitário
                            </p>
                            <p className="mt-2 break-words text-sm font-semibold tabular-nums leading-tight text-foreground sm:text-base">
                              <span className="inline-block max-w-full">
                                {formatPreviewBrl(vuRaw)}
                              </span>
                              <span className="mt-1 block text-[0.65rem] font-normal text-muted-foreground sm:text-xs">
                                por {displayUnit} (compra)
                              </span>
                            </p>
                          </div>
                          <div className="flex min-h-[5.25rem] min-w-0 flex-col justify-center rounded-xl border border-border/70 bg-background/70 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4 sm:py-3.5">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              Total da linha
                            </p>
                            <p className="mt-2 text-lg font-semibold tabular-nums leading-none text-foreground sm:text-xl">
                              {hasLineTotal ? (
                                formatPreviewBrl(lineTotal)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </p>
                            <p className="mt-1 text-[0.65rem] text-muted-foreground">
                              NF-e (vProd)
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <h3 className="text-sm font-semibold">
        Simulação por linha (visão de validação IA)
      </h3>
      {hasAi && aiMeta?.enabled === true ? (
        <div className="rounded-md border border-dashed bg-muted/15 px-3 py-2 text-xs space-y-1">
          <p>
            <span className="text-muted-foreground">
              OPENAI_API_KEY na função:
            </span>{" "}
            {aiMeta.openai_api_key_configured === true
              ? "configurada"
              : aiMeta.openai_api_key_configured === false
                ? "ausente (ver secrets)"
                : "—"}
          </p>
          <p>
            <span className="text-muted-foreground">IA unidades/stock:</span>{" "}
            {aiMeta.skipped === true
              ? String(aiMeta.reason ?? "ignorado")
              : `chamadas ${aiCalls ?? "—"} · conc. ${typeof aiMeta.concurrency === "number" ? aiMeta.concurrency : "—"} · limiar auto ${aiThreshold != null ? String(aiThreshold) : "—"}`}
          </p>
          {typeof aiMeta.note === "string" ? (
            <p className="text-muted-foreground">{aiMeta.note}</p>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-md border bg-emerald-500/5 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100">
        <strong>Resultado final (contexto aplicado):</strong> esta tabela é a
        decisão efetiva do laboratório (`unitSuggestion` +
        `previewLineDecision`), incluindo conversões sugeridas para criar.
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full caption-bottom border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="p-2 font-medium">Produto (nota)</th>
              <th className="p-2 font-medium">Nome p/ cadastro</th>
              <th className="p-2 text-right font-medium">Qtd raw</th>
              <th className="p-2 font-medium">Un. nota</th>
              <th className="p-2 text-right font-medium">Fator emb.</th>
              <th className="p-2 text-right font-medium">Qtd ajust.</th>
              <th className="p-2 font-medium">Sugerido</th>
              <th className="p-2 font-medium">Un. cadastro</th>
              <th className="p-2 font-medium">Un. sugerida</th>
              <th className="p-2 font-medium">Conversões faltantes</th>
              <th className="p-2 font-medium">Derivadas padrão</th>
              <th className="max-w-[140px] p-2 font-medium">Revisão (lab)</th>
              <th className="p-2 text-right font-medium">Custo / UN prim.</th>
              <th className="p-2 font-medium">Reuso</th>
              <th className="p-2 text-right font-medium">Conversão</th>
              <th className="p-2 text-right font-medium">Stock qty</th>
              <th className="p-2 text-right font-medium">V. unit. ajust.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const rawIt = rawItems[i] ?? null;
              const rawKey = consolidationKey({
                productName: String(it.productName ?? ""),
                quantity: Number(it.quantity ?? 0) || 0,
                unitValue: Number(it.unitValue ?? 0) || 0,
                lineTotal: Number(it.lineTotal ?? 0) || 0,
                unitCommercial:
                  it.unitCommercial != null ? String(it.unitCommercial) : null,
                unitTax: it.unitTax != null ? String(it.unitTax) : null,
                invoiceUnitRaw: null,
                ncm: it.ncm != null ? String(it.ncm) : null,
                ean: it.ean != null ? String(it.ean) : null,
              });
              const rawNameByKey =
                rawNameByConsolidationKey.get(rawKey) ?? null;
              const sim = it._preview_line_simulation as
                | Record<string, unknown>
                | undefined;
              const pm = it.productMatch as Record<string, unknown> | undefined;
              const rawQty =
                sim?.rawQuantity != null
                  ? String(sim.rawQuantity)
                  : String(it.quantity ?? "—");
              const unitNote =
                sim?.invoiceUnitRaw != null
                  ? String(sim.invoiceUnitRaw)
                  : String(it.unitCommercial ?? it.unitTax ?? "—");
              const pack =
                sim?.packFactor != null ? String(sim.packFactor) : "—";
              const qtyAdj =
                sim?.quantityAdjusted != null
                  ? String(sim.quantityAdjusted)
                  : "—";
              const suggested =
                pm?.suggestedProductName != null
                  ? String(pm.suggestedProductName)
                  : pm?.suggestedProductId != null
                    ? String(pm.suggestedProductId)
                    : "—";
              const catUnit =
                pm?.catalogUnitNormalized != null
                  ? String(pm.catalogUnitNormalized)
                  : "—";
              const conv =
                pm?.conversionFactorApplied != null
                  ? String(pm.conversionFactorApplied)
                  : "—";
              const stock =
                pm?.stockQuantity != null ? String(pm.stockQuantity) : "—";
              const vu =
                sim?.unitValueAdjusted != null
                  ? String(sim.unitValueAdjusted)
                  : "—";
              const catalogName =
                sim?.catalogNameForRegistration != null
                  ? String(sim.catalogNameForRegistration)
                  : String(it.productName ?? "—");
              const unitSuggestion = sim?.unitSuggestion as
                | Record<string, unknown>
                | undefined;
              const suggestedPrimaryUnit =
                unitSuggestion?.primary_unit_code != null
                  ? String(unitSuggestion.primary_unit_code)
                  : "—";
              const suggestedConversions = Array.isArray(
                unitSuggestion?.suggested_conversions,
              )
                ? (unitSuggestion.suggested_conversions as Array<
                    Record<string, unknown>
                  >)
                : [];
              const suggestedConversionSummary =
                suggestedConversions.length > 0
                  ? suggestedConversions
                      .map((c) => String(c.relation ?? "—"))
                      .join(" | ")
                  : "—";
              const derivedSummary =
                suggestedConversions
                  .flatMap((c) => {
                    if (!Array.isArray(c.derived_standard)) return [];
                    return (
                      c.derived_standard as Array<Record<string, unknown>>
                    ).map(
                      (d) =>
                        `1 UN = ${String(d.qty_for_1_un ?? "—")} ${String(
                          d.unit_code ?? "",
                        ).toUpperCase()}`,
                    );
                  })
                  .join(" | ") || "—";
              const rowPld = sim?.previewLineDecision as
                | Record<string, unknown>
                | undefined;
              const rowManual = rowPld?.manual_review as
                | Record<string, unknown>
                | undefined;
              const rowCost = rowPld?.cost_suggestion as
                | Record<string, unknown>
                | undefined;
              const rowReuse = rowPld?.match_reuse as
                | Record<string, unknown>
                | undefined;
              const rowLabStatusRaw =
                rowManual?.status != null ? String(rowManual.status) : "—";
              const rowLabStatus =
                rowLabStatusRaw !== "—"
                  ? labManualStatusLabelPt(rowLabStatusRaw)
                  : "—";
              const rowLabReasonsRaw = Array.isArray(rowManual?.reason_codes)
                ? (rowManual.reason_codes as unknown[]).map((x) => String(x))
                : [];
              const rowLabReasons =
                rowLabReasonsRaw.length > 0
                  ? rowLabReasonsRaw.map(labReasonLabelPt).join(" · ")
                  : "—";
              const rowLabReviewSummary =
                rowLabStatus !== "—"
                  ? `${rowLabStatus}${rowLabReasons !== "—" && rowLabReasons !== "" ? ` · ${rowLabReasons}` : ""}`
                  : "—";
              const rowCostPrimary =
                rowCost?.unit_cost_in_primary != null &&
                Number.isFinite(Number(rowCost.unit_cost_in_primary))
                  ? formatPreviewBrl(Number(rowCost.unit_cost_in_primary))
                  : "—";
              const rowReuseLabel =
                rowReuse?.reused_existing_product === true
                  ? "sim"
                  : rowReuse?.reused_existing_product === false
                    ? "não"
                    : "—";
              return (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="max-w-[160px] p-2 font-mono">
                    {rawNameByKey != null
                      ? rawNameByKey
                      : rawIt?.productName != null
                        ? String(rawIt.productName)
                        : "—"}
                  </td>
                  <td className="max-w-[140px] p-2 font-mono text-muted-foreground">
                    {catalogName}
                  </td>
                  <td className="p-2 text-right font-mono">{rawQty}</td>
                  <td className="p-2 font-mono">{unitNote}</td>
                  <td className="p-2 text-right font-mono">{pack}</td>
                  <td className="p-2 text-right font-mono">{qtyAdj}</td>
                  <td className="max-w-[140px] p-2">{suggested}</td>
                  <td className="p-2 font-mono">{catUnit}</td>
                  <td className="p-2 font-mono">{suggestedPrimaryUnit}</td>
                  <td className="max-w-[220px] p-2">
                    {suggestedConversionSummary}
                  </td>
                  <td className="max-w-[220px] p-2">{derivedSummary}</td>
                  <td className="max-w-[140px] p-2 text-[11px] leading-snug">
                    {rowLabReviewSummary}
                  </td>
                  <td className="p-2 text-right font-mono">{rowCostPrimary}</td>
                  <td className="p-2 font-mono">{rowReuseLabel}</td>
                  <td className="p-2 text-right font-mono">{conv}</td>
                  <td className="p-2 text-right font-mono">{stock}</td>
                  <td className="p-2 text-right font-mono">{vu}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasAi ? (
        <>
          <div className="rounded-md border bg-primary/5 px-3 py-2 text-xs text-primary/95">
            <strong>Diagnóstico IA bruto (LLM):</strong> comparação do retorno
            cru do modelo; não substitui a decisão final do contexto.
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full caption-bottom border-collapse text-xs">
              <thead>
                <tr className="border-b bg-primary/5 text-left">
                  <th className="p-2 font-medium">Produto (nota)</th>
                  <th className="p-2 font-medium">IA nome</th>
                  <th className="p-2 font-medium">IA un. bruta</th>
                  <th className="p-2 text-right font-medium">IA stock bruto</th>
                  <th className="p-2 text-right font-medium">IA fator bruto</th>
                  <th className="p-2 text-right font-medium">IA conf.</th>
                  <th className="p-2 font-medium">IA auto?</th>
                  <th className="max-w-[260px] p-2 font-medium">
                    Sugestão conversão (bruta)
                  </th>
                  <th className="max-w-[260px] p-2 font-medium">
                    Interpretação / nota
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const rawIt = rawItems[i] ?? null;
                  const rawKey = consolidationKey({
                    productName: String(it.productName ?? ""),
                    quantity: Number(it.quantity ?? 0) || 0,
                    unitValue: Number(it.unitValue ?? 0) || 0,
                    lineTotal: Number(it.lineTotal ?? 0) || 0,
                    unitCommercial:
                      it.unitCommercial != null
                        ? String(it.unitCommercial)
                        : null,
                    unitTax: it.unitTax != null ? String(it.unitTax) : null,
                    invoiceUnitRaw: null,
                    ncm: it.ncm != null ? String(it.ncm) : null,
                    ean: it.ean != null ? String(it.ean) : null,
                  });
                  const rawNameByKey =
                    rawNameByConsolidationKey.get(rawKey) ?? null;
                  const sim = it._preview_line_simulation as
                    | Record<string, unknown>
                    | undefined;
                  const ai = it._preview_line_ai_units as
                    | Record<string, unknown>
                    | undefined;
                  const aiKind = ai?.kind != null ? String(ai.kind) : "";
                  const aiName =
                    aiKind === "OK" && ai?.cleaned_product_name != null
                      ? String(ai.cleaned_product_name)
                      : "—";
                  const aiUnitRaw =
                    aiKind === "OK" && ai?.catalog_unit_target != null
                      ? String(ai.catalog_unit_target)
                      : "—";
                  const aiStockRaw =
                    aiKind === "OK" && ai?.stock_quantity_suggested != null
                      ? String(ai.stock_quantity_suggested)
                      : "—";
                  const aiFactorRaw =
                    aiKind === "OK" &&
                    ai?.conversion_factor_per_invoice_unit != null
                      ? String(ai.conversion_factor_per_invoice_unit)
                      : "—";
                  const aiConf =
                    aiKind === "OK" && ai?.confidence != null
                      ? String(ai.confidence)
                      : "—";
                  const aiAuto =
                    aiKind === "OK" && ai?.would_substitute_stock === true
                      ? "sim"
                      : aiKind === "OK"
                        ? "não"
                        : "—";
                  const aiInterpret =
                    aiKind === "OK" && ai?.interpretation != null
                      ? String(ai.interpretation)
                      : null;
                  const aiNote =
                    aiKind === "ERROR" && ai?.message != null
                      ? String(ai.message)
                      : aiKind === "SKIP" && ai?.rationale != null
                        ? String(ai.rationale)
                        : null;
                  const unitNote =
                    sim?.invoiceUnitRaw != null
                      ? String(sim.invoiceUnitRaw)
                      : String(it.unitCommercial ?? it.unitTax ?? "—");
                  const factorNum = Number(aiFactorRaw);
                  const aiRawConversionHint =
                    aiKind === "OK" &&
                    aiUnitRaw !== "—" &&
                    unitNote !== "—" &&
                    Number.isFinite(factorNum) &&
                    factorNum > 0
                      ? `1 ${unitNote.toUpperCase()} = ${factorNum} ${aiUnitRaw.toUpperCase()}`
                      : "—";
                  return (
                    <tr key={i} className="border-b border-border/60 align-top">
                      <td className="max-w-[180px] p-2 font-mono">
                        {rawNameByKey != null
                          ? rawNameByKey
                          : rawIt?.productName != null
                            ? String(rawIt.productName)
                            : "—"}
                      </td>
                      <td className="max-w-[180px] p-2 font-mono">{aiName}</td>
                      <td className="p-2 font-mono">{aiUnitRaw}</td>
                      <td className="p-2 text-right font-mono">{aiStockRaw}</td>
                      <td className="p-2 text-right font-mono">
                        {aiFactorRaw}
                      </td>
                      <td className="p-2 text-right font-mono">{aiConf}</td>
                      <td className="p-2 font-mono">{aiAuto}</td>
                      <td className="max-w-[260px] p-2">
                        {aiRawConversionHint}
                      </td>
                      <td className="max-w-[260px] p-2 text-[11px] leading-snug text-muted-foreground">
                        {aiInterpret != null ? aiInterpret : (aiNote ?? "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {items.some(
        (it) =>
          (it._preview_line_simulation as Record<string, unknown> | undefined)
            ?.packRationale,
      ) ? (
        <p className="text-xs text-muted-foreground">
          Fator de embalagem: heurística no nome da linha;{" "}
          <strong className="font-medium text-foreground">
            Nome p/ cadastro
          </strong>{" "}
          é o que a importação em lote gravaria ao criar produto novo (trecho “N
          un / cx / …” removido).{" "}
          <code className="rounded bg-muted px-1">stock qty</code> e conversões
          para criar vêm do contexto final (`unitSuggestion` /
          `previewLineDecision`). A tabela de diagnóstico mostra apenas a saída
          bruta do modelo para auditoria.
        </p>
      ) : null}
    </div>
  );
}

function ExtractedSummaryBlock({
  title,
  doc,
}: {
  title: string;
  doc: Record<string, unknown>;
}) {
  const items = Array.isArray(doc.items)
    ? (doc.items as Record<string, unknown>[])
    : [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Fornecedor</dt>
          <dd className="font-medium">{String(doc.supplierName ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">CNPJ/CPF</dt>
          <dd className="font-mono text-xs">
            {String(doc.supplierDocument ?? "—")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total (vNF / soma)</dt>
          <dd className="font-mono">{String(doc.totalAmount ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Data emissão</dt>
          <dd>{String(doc.emissionDate ?? "—")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Chave NF-e</dt>
          <dd className="break-all font-mono text-xs">
            {String(doc.nfeAccessKey ?? "—")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nº / série</dt>
          <dd className="font-mono text-xs">
            {String(doc.invoiceNumber ?? "—")} /{" "}
            {String(doc.invoiceSeries ?? "—")}
          </dd>
        </div>
      </dl>

      {doc._requiresProductConfirmation === true ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Requer confirmação de produto (matching).
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full caption-bottom border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="p-2 font-medium">Produto</th>
                <th className="p-2 text-right font-medium">Qtd</th>
                <th className="p-2 font-medium">Un.</th>
                <th className="p-2 text-right font-medium">V. unit.</th>
                <th className="p-2 text-right font-medium">Total linha</th>
                <th className="hidden p-2 font-medium sm:table-cell">NCM</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="max-w-[200px] truncate p-2 text-xs">
                    {String(it.productName ?? "—")}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">
                    {String(it.quantity ?? "—")}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {String(it.unitCommercial ?? it.unitTax ?? "—")}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">
                    {String(it.unitValue ?? "—")}
                  </td>
                  <td className="p-2 text-right font-mono text-xs">
                    {String(it.lineTotal ?? "—")}
                  </td>
                  <td className="hidden p-2 font-mono text-xs sm:table-cell">
                    {String(it.ncm ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem linhas de itens.</p>
      )}
    </div>
  );
}

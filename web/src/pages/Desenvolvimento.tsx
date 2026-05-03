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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import {
  fetchSupabaseEdgeFunction,
  formatSupabaseFunctionError,
  supabase,
  supabaseUrl,
} from "@/lib/supabase";
import { stripPackSizeFromLabel } from "@/lib/productImport/packSizeFromLabel";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  FileCode2,
  FlaskConical,
  Loader2,
  Package,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

type PhaseOpt = "auto" | "list" | "download";

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

const BRL_PREVIEW = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatPreviewBrl(v: unknown): string {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  return BRL_PREVIEW.format(n);
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

export function Desenvolvimento() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id ?? "";
  const companyLabel = currentCompany?.name?.trim() || "—";

  const [mainTab, setMainTab] = useState<"focus" | "preview">("focus");

  const [phase, setPhase] = useState<PhaseOpt>("auto");
  const [maxListPages, setMaxListPages] = useState("2");
  const [maxXmlDownloads, setMaxXmlDownloads] = useState("3");
  const [maxChainDepth, setMaxChainDepth] = useState("0");
  const [versaoInicial, setVersaoInicial] = useState("");
  const [loadingFocus, setLoadingFocus] = useState(false);
  const [lastJson, setLastJson] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewOkResponse | null>(
    null,
  );
  const [simulateImportBatch, setSimulateImportBatch] = useState(false);
  const [aiLineUnitsPreview, setAiLineUnitsPreview] = useState(false);

  const runFocus = useCallback(async () => {
    if (!companyId) {
      toast.error("Selecione uma unidade (empresa) no app.");
      return;
    }
    const nPages = Number(maxListPages);
    const nXml = Number(maxXmlDownloads);
    const nChain = Number(maxChainDepth);
    if (!Number.isFinite(nPages) || nPages < 1 || nPages > 80) {
      toast.error("Páginas de listagem: número entre 1 e 80.");
      return;
    }
    if (!Number.isFinite(nXml) || nXml < 1 || nXml > 500) {
      toast.error("Máx. XML: número entre 1 e 500.");
      return;
    }
    if (!Number.isFinite(nChain) || nChain < 0 || nChain > 5) {
      toast.error("Profundidade de encadeamento: 0 a 5.");
      return;
    }
    let versao: number | undefined;
    const vTrim = versaoInicial.trim();
    if (vTrim !== "") {
      const v = Number(vTrim);
      if (!Number.isFinite(v) || v < 0) {
        toast.error("Versão inicial: número ≥ 0 ou vazio.");
        return;
      }
      versao = Math.floor(v);
    }

    setLoadingFocus(true);
    setLastError(null);
    setLastJson(null);
    try {
      const body: Record<string, unknown> = {
        manual: true,
        company_id: companyId,
        phase,
        max_list_pages: Math.floor(nPages),
        max_xml_downloads: Math.floor(nXml),
        max_chain_depth: Math.floor(nChain),
      };
      if (versao !== undefined) body.versao_inicial = versao;

      const { data, error } = await supabase.functions.invoke(
        "focus-sync-nfe-recebidas",
        { body },
      );
      if (error) {
        const msg = formatSupabaseFunctionError(error);
        setLastError(msg);
        toast.error(msg);
        return;
      }
      const text = JSON.stringify(data, null, 2);
      setLastJson(text);
      const ok =
        data &&
        typeof data === "object" &&
        (data as { ok?: boolean }).ok === true;
      if (ok) {
        toast.success("Função concluída. Ver resposta abaixo.");
      } else {
        const err =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error)
            : "Resposta inesperada";
        setLastError(err);
        toast.error(err);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setLastError(msg);
      toast.error(msg);
    } finally {
      setLoadingFocus(false);
    }
  }, [
    companyId,
    maxChainDepth,
    maxListPages,
    maxXmlDownloads,
    phase,
    versaoInicial,
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
      if (simulateImportBatch) {
        form.append("simulate_import_batch", "true");
      }
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
          typeof payload.error === "string" ? payload.error : "Resposta inválida";
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
          onClick={() => setMainTab("focus")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            mainTab === "focus"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Focus NF-e recebidas
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

      {mainTab === "focus" ? (
        <Card className="w-full min-w-0">
          <CardHeader>
            <CardTitle>Teste: focus-sync-nfe-recebidas</CardTitle>
            <CardDescription>
              Executa a Edge Function em modo manual só para{" "}
              <span className="font-medium text-foreground">{companyLabel}</span>
              {companyId ? (
                <span className="block font-mono text-xs text-muted-foreground mt-1">
                  {companyId}
                </span>
              ) : null}
              . Reduza páginas e XML para testes leves.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dev-phase">Fase</Label>
                <Select
                  value={phase}
                  onValueChange={(v) => setPhase(v as PhaseOpt)}
                  disabled={loadingFocus || !companyId}
                >
                  <SelectTrigger id="dev-phase" className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      auto (listar + descarregar)
                    </SelectItem>
                    <SelectItem value="list">list (só listagem → fila)</SelectItem>
                    <SelectItem value="download">
                      download (só fila → XML)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-versao">Versão inicial (opcional)</Label>
                <Input
                  id="dev-versao"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Vazio = usar cursor gravado na unidade"
                  value={versaoInicial}
                  onChange={(e) => setVersaoInicial(e.target.value)}
                  disabled={loadingFocus || !companyId}
                  className="max-w-xs font-mono text-sm"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="dev-pages">Máx. páginas listagem</Label>
                <Input
                  id="dev-pages"
                  type="number"
                  min={1}
                  max={80}
                  value={maxListPages}
                  onChange={(e) => setMaxListPages(e.target.value)}
                  disabled={loadingFocus || !companyId}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-xml">Máx. downloads XML</Label>
                <Input
                  id="dev-xml"
                  type="number"
                  min={1}
                  max={500}
                  value={maxXmlDownloads}
                  onChange={(e) => setMaxXmlDownloads(e.target.value)}
                  disabled={loadingFocus || !companyId}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-chain">Encadeamento automático (prof.)</Label>
                <Input
                  id="dev-chain"
                  type="number"
                  min={0}
                  max={5}
                  value={maxChainDepth}
                  onChange={(e) => setMaxChainDepth(e.target.value)}
                  disabled={loadingFocus || !companyId}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  0 = não re-disparar a função ao fim do POST.
                </p>
              </div>
            </div>

            <Button
              type="button"
              disabled={loadingFocus || !companyId}
              onClick={() => void runFocus()}
            >
              {loadingFocus ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  A executar…
                </>
              ) : (
                <>
                  <FlaskConical className="mr-2 h-4 w-4" />
                  Executar teste
                </>
              )}
            </Button>

            {lastError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {lastError}
              </div>
            ) : null}

            {lastJson ? (
              <div className="space-y-2">
                <Label>Resposta JSON</Label>
                <pre className="max-h-[min(70vh,560px)] overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono">
                  {lastJson}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5" />
              Laboratório: extração a partir de XML
            </CardTitle>
            <CardDescription>
              Envie um XML de NF-e da unidade{" "}
              <span className="font-medium text-foreground">{companyLabel}</span>.
              A leitura é{" "}
              <strong className="text-foreground">determinística</strong> (parser
              em <code className="rounded bg-muted px-1 text-xs">parseNfeXml</code>
              ); «enriched» aplica matching de produtos{" "}
              <strong className="text-foreground">sem gravar fornecedor</strong>.
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
                Simular resolução como importação XML (batch)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              Usa o mesmo modo que{" "}
              <code className="rounded bg-muted px-1">process-import-job-batch</code>{" "}
              (limiares, IA extra,{" "}
              <code className="rounded bg-muted px-1">deferProductCreationToReconciliation</code>{" "}
              desligado).
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
              <strong className="text-foreground">Substituição automática</strong> só quando{" "}
              <code className="rounded bg-muted px-1 text-xs">confidence</code> ≥{" "}
              <code className="rounded bg-muted px-1 text-xs">
                LINE_UNITS_AI_AUTO_CONFIDENCE_THRESHOLD
              </code>{" "}
              (padrão 0,92) e a validação numérica da linha passa — por agora só para
              análise na tabela; importação real não usa isto.
            </p>

            <Button
              type="button"
              disabled={loadingPreview || !companyId}
              onClick={() => void runPreview()}
            >
              {loadingPreview ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  A analisar…
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
                  <p className="text-sm text-muted-foreground">{previewResult.hint}</p>
                ) : null}

                <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1">
                  <p>
                    <span className="text-muted-foreground">Modo batch simulado:</span>{" "}
                    {previewResult.simulate_import_batch ? "sim" : "não"}
                  </p>
                  {previewResult.defer_product_creation_to_reconciliation != null ? (
                    <p>
                      <span className="text-muted-foreground">
                        defer_product_creation_to_reconciliation:
                      </span>{" "}
                      {String(previewResult.defer_product_creation_to_reconciliation)}
                    </p>
                  ) : null}
                  {previewResult.borderline_llm_calls != null ? (
                    <p>
                      <span className="text-muted-foreground">borderline_llm_calls:</span>{" "}
                      {previewResult.borderline_llm_calls}
                    </p>
                  ) : null}
                </div>

                <NfePreviewSimulationTable
                  enriched={previewResult.enriched}
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
                        simulate_import_batch: previewResult.simulate_import_batch,
                        ai_line_units_preview: previewResult.ai_line_units_preview,
                        line_units_ai: previewResult.line_units_ai,
                        defer_product_creation_to_reconciliation:
                          previewResult.defer_product_creation_to_reconciliation,
                        borderline_llm_calls: previewResult.borderline_llm_calls,
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
  lineUnitsAi,
}: {
  enriched: Record<string, unknown>;
  lineUnitsAi: Record<string, unknown> | null;
}) {
  const items = Array.isArray(enriched.items)
    ? (enriched.items as Record<string, unknown>[])
    : [];

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
          <strong className="font-medium text-foreground">Produto existente</strong>{" "}
          mostra o nome já cadastrado quando há match automático.{" "}
          <strong className="font-medium text-foreground">Novo cadastro</strong>{" "}
          combina heurística do nome da nota; a{" "}
          <strong className="font-medium text-foreground">unidade de cadastro</strong>{" "}
          segue a NF-e (mapeamento do sistema). Com IA ativa, o laboratório ajusta o
          nome e sugere interpretação/conversões. O valor é o{" "}
          <strong className="font-medium text-foreground">unitário ajustado</strong>{" "}
          (após fator de embalagem na linha, quando aplicável).
        </p>
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => {
            const sim = it._preview_line_simulation as
              | Record<string, unknown>
              | undefined;
            const pm = it.productMatch as
              | Record<string, unknown>
              | undefined;
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
              ? suggestedName ?? `ID ${suggestedId ?? "—"}`
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
            const aiUnit =
              aiKind === "OK" && ai?.catalog_unit_target != null
                ? String(ai.catalog_unit_target)
                : "";
            const aiUnitNeedsReview =
              aiKind === "OK" && ai?.catalog_unit_needs_review === true;
            const unitNote =
              sim?.invoiceUnitRaw != null
                ? String(sim.invoiceUnitRaw)
                : String(it.unitCommercial ?? it.unitTax ?? "—");
            const displayUnit = isExisting
              ? catUnit !== "—"
                ? catUnit
                : unitNote
              : aiUnit || (catUnit !== "—" ? catUnit : unitNote);
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
              : aiStock ?? stockMatch ?? qtyAdj;
            const stockCaption = isExisting
              ? "Quantidade (match)"
              : aiStock != null
                ? "Quantidade (IA)"
                : "Quantidade (nota)";
            const invoiceName = String(it.productName ?? "—");
            const hasLineTotal =
              lineTotal != null && String(lineTotal).trim() !== "";
            const stockUnitSuffix =
              !isExisting && aiUnit ? aiUnit : displayUnit;
            return (
              <div key={i} className="flex h-full min-h-0 min-w-0 w-full">
                <div
                  className={cn(
                    "relative flex w-full max-w-full min-h-[17rem] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-muted/25 text-left shadow-sm transition-colors",
                    "p-4 sm:p-5 md:p-6",
                    "border-border/80",
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
                              {aiUnitNeedsReview ? (
                                <Badge
                                  variant="outline"
                                  className="h-6 gap-1 border-amber-500/60 bg-amber-500/10 px-2 text-[0.65rem] font-normal text-amber-950 dark:text-amber-100"
                                >
                                  Unidade a rever
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
        Simulação por linha (raw vs ajustado vs match)
      </h3>
      {hasAi && aiMeta?.enabled === true ? (
        <div className="rounded-md border border-dashed bg-muted/15 px-3 py-2 text-xs space-y-1">
          <p>
            <span className="text-muted-foreground">OPENAI_API_KEY na função:</span>{" "}
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
              <th className="p-2 text-right font-medium">Conversão</th>
              <th className="p-2 text-right font-medium">Stock qty</th>
              <th className="p-2 text-right font-medium">V. unit. ajust.</th>
              {hasAi ? (
                <>
                  <th className="p-2 font-medium bg-primary/5">IA stock</th>
                  <th className="p-2 font-medium bg-primary/5">IA fator</th>
                  <th className="p-2 font-medium bg-primary/5">IA un.</th>
                  <th className="p-2 text-right font-medium bg-primary/5">IA conf.</th>
                  <th className="p-2 font-medium bg-primary/5">IA auto?</th>
                  <th className="max-w-[120px] p-2 font-medium bg-primary/5">
                    IA nome
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const sim = it._preview_line_simulation as
                | Record<string, unknown>
                | undefined;
              const pm = it.productMatch as
                | Record<string, unknown>
                | undefined;
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
              const ai = it._preview_line_ai_units as
                | Record<string, unknown>
                | undefined;
              const aiKind = ai?.kind != null ? String(ai.kind) : "";
              const aiStock =
                aiKind === "OK" && ai?.stock_quantity_suggested != null
                  ? String(ai.stock_quantity_suggested)
                  : aiKind === "SKIP" || aiKind === "ERROR"
                    ? "—"
                    : ai?.skipped === true
                      ? "—"
                      : "—";
              const aiFactor =
                aiKind === "OK" && ai?.conversion_factor_per_invoice_unit != null
                  ? String(ai.conversion_factor_per_invoice_unit)
                  : "—";
              const aiUnit =
                aiKind === "OK" && ai?.catalog_unit_target != null
                  ? String(ai.catalog_unit_target)
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
              const aiName =
                aiKind === "OK" && ai?.cleaned_product_name != null
                  ? String(ai.cleaned_product_name)
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
              return (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="max-w-[160px] p-2 font-mono">
                    {String(it.productName ?? "—")}
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
                  <td className="p-2 text-right font-mono">{conv}</td>
                  <td className="p-2 text-right font-mono">{stock}</td>
                  <td className="p-2 text-right font-mono">{vu}</td>
                  {hasAi ? (
                    <>
                      <td className="p-2 text-right font-mono bg-primary/5">
                        {aiStock}
                        {aiInterpret ? (
                          <span className="block text-[10px] text-muted-foreground font-normal">
                            {aiInterpret.slice(0, 100)}
                            {aiInterpret.length > 100 ? "…" : ""}
                          </span>
                        ) : null}
                        {aiNote ? (
                          <span className="block text-[10px] text-destructive/80 font-normal">
                            {aiNote.slice(0, 80)}
                            {aiNote.length > 80 ? "…" : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 text-right font-mono bg-primary/5">
                        {aiFactor}
                      </td>
                      <td className="p-2 font-mono bg-primary/5">
                        {aiUnit}
                        {aiKind === "OK" &&
                        ai?.catalog_unit_needs_review === true ? (
                          <span className="mt-0.5 block text-[10px] font-normal text-amber-800 dark:text-amber-300">
                            Rever código (nota não mapeada)
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 text-right font-mono bg-primary/5">
                        {aiConf}
                      </td>
                      <td className="p-2 font-mono bg-primary/5">{aiAuto}</td>
                      <td className="max-w-[120px] p-2 font-mono bg-primary/5">
                        {aiName}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.some(
        (it) =>
          (it._preview_line_simulation as Record<string, unknown> | undefined)
            ?.packRationale,
      ) ? (
        <p className="text-xs text-muted-foreground">
          Fator de embalagem: heurística no nome da linha;{" "}
          <strong className="font-medium text-foreground">Nome p/ cadastro</strong>{" "}
          é o que a importação em lote gravaria ao criar produto novo (trecho
          “N un / cx / …” removido).{" "}
          <code className="rounded bg-muted px-1">stock qty</code> vem do match
          (regras + heurísticas). Colunas <strong>IA</strong> são só laboratório;
          <strong>IA auto?</strong> = sim só com confiança alta e totais coerentes.
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
          <dd className="font-mono text-xs">{String(doc.supplierDocument ?? "—")}</dd>
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
            {String(doc.invoiceNumber ?? "—")} / {String(doc.invoiceSeries ?? "—")}
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

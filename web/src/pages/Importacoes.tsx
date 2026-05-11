import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { importJobStatusLabel } from "@/lib/importBatchStatus";
import { drainProcessImportJobBatch } from "@/lib/processImportJobBatchClient";
import { supabase } from "@/lib/supabase";
import { Loader2, RefreshCcw, Ban } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type BatchRow = {
  id: string;
  source_file_name: string | null;
  status: string;
  total_files: number;
  processed_files: number;
  success_files: number;
  failed_files: number;
  pending_review_files: number;
  progress_percent: number;
  created_at: string;
};

type XmlLinkPendingRow = {
  id: string;
  title: string;
  detail: string | null;
  expense_id: string | null;
  created_at: string;
};

type CreationHistoryRow = {
  id: string;
  batch_id: string;
  stage: string;
  message: string | null;
  meta: {
    source?: string;
    exec_id?: string;
    summary?: {
      processed?: number;
      created?: number;
      skipped_existing_active?: number;
      suppliers_created?: number;
      failed?: number;
    };
    remaining_xml?: number;
    chain_scheduled?: boolean;
    error?: string;
  } | null;
  created_at: string;
};

export function Importacoes() {
  const { currentCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [creationHistory, setCreationHistory] = useState<CreationHistoryRow[]>([]);
  const [xmlLinkPendings, setXmlLinkPendings] = useState<XmlLinkPendingRow[]>([]);

  const load = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("import_job_batches")
      .select("id, source_file_name, status, total_files, processed_files, success_files, failed_files, pending_review_files, progress_percent, created_at")
      .eq("company_id", currentCompany.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as BatchRow[]);

    const { data: pendingXml, error: pendingXmlErr } = await supabase
      .from("import_review_pending")
      .select("id, title, detail, expense_id, created_at")
      .eq("company_id", currentCompany.id)
      .eq("status", "OPEN")
      .eq("kind", "missing_product_match")
      .order("created_at", { ascending: false })
      .limit(50);
    if (pendingXmlErr) {
      toast.error(pendingXmlErr.message);
    } else {
      setXmlLinkPendings((pendingXml ?? []) as XmlLinkPendingRow[]);
    }

    const { data: historyData, error: historyErr } = await supabase
      .from("import_job_timeline")
      .select("id, batch_id, stage, message, meta, created_at")
      .contains("meta", { source: "focus-create-expenses-from-received-nfe" })
      .in("stage", ["DONE", "ERROR"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (historyErr) {
      toast.error(historyErr.message);
      return;
    }
    setCreationHistory((historyData ?? []) as CreationHistoryRow[]);
  }, [currentCompany?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * O processor na Edge pode sofrer `EarlyDrop` após responder HTTP — o encadeamento
   * servidor não é confiável. Enquanto esta página estiver aberta, o navegador reinvoca
   * o lote ativo até concluir.
   */
  useEffect(() => {
    const companyId = currentCompany?.id;
    if (!companyId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const { data } = await supabase
        .from("import_job_batches")
        .select("id")
        .eq("company_id", companyId)
        .in("status", ["QUEUED", "PROCESSING"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!data?.id || cancelled) return;
      await drainProcessImportJobBatch(data.id, { maxRounds: 25, pauseMs: 400 });
      if (!cancelled) void load();
    };
    const interval = globalThis.setInterval(() => {
      void tick();
    }, 12_000);
    void tick();
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [currentCompany?.id, load]);

  const retryBatch = async (batchId: string) => {
    if (!currentCompany?.id) return;
    setRetrying(batchId);
    const { error: updErr } = await supabase
      .from("import_job_batches")
      .update({
        status: "QUEUED",
        processed_files: 0,
        success_files: 0,
        failed_files: 0,
        pending_review_files: 0,
        progress_percent: 0,
        retry_count: 1,
        last_error: null,
        started_at: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
    if (updErr) {
      setRetrying(null);
      toast.error(updErr.message);
      return;
    }
    const { error: fileUpdErr } = await supabase
      .from("import_job_files")
      .update({
        status: "QUEUED",
        last_error: null,
        started_at: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("batch_id", batchId);
    if (fileUpdErr) {
      setRetrying(null);
      toast.error(fileUpdErr.message);
      return;
    }
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      setRetrying(null);
      toast.error("Sessão inválida.");
      return;
    }
    const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    await fetch(`${baseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch_id: batchId }),
    }).catch(() => undefined);
    setRetrying(null);
    toast.success("Retry iniciado em segundo plano.");
    void load();
  };

  const cancelBatch = async (batchId: string) => {
    if (!currentCompany?.id) return;
    setCancelling(batchId);
    const cancelIso = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from("import_job_batches")
      .update({
        status: "CANCELLED",
        last_error: "Cancelado pelo usuário.",
        updated_at: cancelIso,
      })
      .eq("id", batchId)
      .eq("company_id", currentCompany.id)
      .in("status", ["QUEUED", "PROCESSING"])
      .select("id");
    if (updErr) {
      setCancelling(null);
      toast.error(updErr.message);
      return;
    }
    if (!updated?.length) {
      setCancelling(null);
      toast.message("Este lote já não está em processamento.");
      void load();
      return;
    }
    await supabase
      .from("import_job_files")
      .update({
        status: "CANCELLED",
        last_error: "Cancelado pelo usuário.",
        finished_at: cancelIso,
        updated_at: cancelIso,
      })
      .eq("batch_id", batchId)
      .eq("status", "QUEUED");
    setCancelling(null);
    toast.success("Cancelamento solicitado. Os arquivos em fila não serão processados.");
    void load();
  };

  return (
    <PageShell className="space-y-6" narrow>
      <PageHeader
        title="Central de importações"
        description="Acompanhe lotes XML em segundo plano, progresso e falhas parciais."
        action={(
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
        )}
      />
      <Card>
        <CardHeader>
          <CardTitle>Pendências de vínculo (NF-e / catálogo)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Linhas importadas que ainda precisam de confirmação ou vínculo manual com o estoque.
            Use a despesa para ajustar itens; o painel principal continua com a lista completa e
            ações em lote.
          </p>
          <p className="text-sm">
            <Link to="/app" className="text-primary underline-offset-4 hover:underline">
              Abrir alertas no painel
            </Link>
          </p>
          {xmlLinkPendings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência aberta deste tipo.</p>
          ) : (
            <ul className="space-y-2">
              {xmlLinkPendings.map((p) => (
                <li key={p.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium leading-snug">{p.title}</p>
                  {p.detail ? (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.detail}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{new Date(p.created_at).toLocaleString("pt-BR")}</span>
                    {p.expense_id ? (
                      <Link
                        to={`/app/despesas?expense=${encodeURIComponent(p.expense_id)}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Abrir despesa
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Histórico de lotes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem lotes de importação.</p>
          ) : rows.map((r) => (
            <div key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{r.source_file_name ?? "Lote sem nome"}</p>
                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Status: <strong>{importJobStatusLabel(r.status)}</strong> · Progresso:{" "}
                {Number(r.progress_percent ?? 0).toFixed(0)}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Arquivos: {r.processed_files}/{r.total_files} · sucesso {r.success_files} · falha {r.failed_files} · pendência {r.pending_review_files}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(r.status === "QUEUED" || r.status === "PROCESSING") ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void cancelBatch(r.id)}
                    disabled={cancelling === r.id}
                  >
                    {cancelling === r.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                    Cancelar importação
                  </Button>
                ) : null}
                {(r.status === "FAILED" || r.status === "PARTIAL_SUCCESS") ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void retryBatch(r.id)}
                    disabled={retrying === r.id}
                  >
                    {retrying === r.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Retry lote
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Histórico de criação de despesas (NF-e Focus)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {creationHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem histórico da nova função ainda.</p>
          ) : creationHistory.map((h) => {
            const s = h.meta?.summary ?? {};
            return (
              <div key={h.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {h.stage === "ERROR" ? "Execução com falha" : "Execução concluída"}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Batch: <strong>{h.batch_id}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Notas: processadas {Number(s.processed ?? 0)} · criadas {Number(s.created ?? 0)} ·
                  ignoradas {Number(s.skipped_existing_active ?? 0)} · fornecedores criados {Number(s.suppliers_created ?? 0)} ·
                  erros {Number(s.failed ?? 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pendentes: {Number(h.meta?.remaining_xml ?? 0)} · encadeada: {h.meta?.chain_scheduled ? "sim" : "não"}
                </p>
                {h.stage === "ERROR" && h.meta?.error ? (
                  <p className="mt-1 text-xs text-destructive">{String(h.meta.error)}</p>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </PageShell>
  );
}

import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { Loader2, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

export function Importacoes() {
  const { currentCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);

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
  }, [currentCompany?.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
                Status: <strong>{r.status}</strong> · Progresso: {Number(r.progress_percent ?? 0).toFixed(0)}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Arquivos: {r.processed_files}/{r.total_files} · sucesso {r.success_files} · falha {r.failed_files} · pendência {r.pending_review_files}
              </p>
              {(r.status === "FAILED" || r.status === "PARTIAL_SUCCESS") ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  onClick={() => void retryBatch(r.id)}
                  disabled={retrying === r.id}
                >
                  {retrying === r.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Retry lote
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}

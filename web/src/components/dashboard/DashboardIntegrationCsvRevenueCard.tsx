import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { ArrowRight, FileSpreadsheet, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

export type IntegrationCsvRevenueJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

type JobRow = {
  id: string;
  status: IntegrationCsvRevenueJobStatus;
  provider: string;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  csv_resume_row_index: number | null;
  metadata: Record<string, unknown> | null;
};

function statusLabel(s: IntegrationCsvRevenueJobStatus): string {
  switch (s) {
    case "PENDING":
      return "Na fila";
    case "PROCESSING":
      return "A processar";
    case "COMPLETED":
      return "Concluído";
    case "FAILED":
      return "Erro";
    default:
      return s;
  }
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

export function DashboardIntegrationCsvRevenueCard({
  companyId,
}: {
  companyId: string | undefined;
}) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);

  const load = useCallback(async () => {
    if (!companyId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("integration_csv_revenue_import_jobs")
      .select(
        "id, status, provider, created_at, updated_at, error_message, csv_resume_row_index, metadata",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) {
      console.error("[DashboardIntegrationCsvRevenueCard]", error);
      setJobs([]);
    } else {
      setJobs((data ?? []) as JobRow[]);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const hasActive = useMemo(
    () =>
      jobs.some(
        (j) => j.status === "PENDING" || j.status === "PROCESSING",
      ),
    [jobs],
  );

  useEffect(() => {
    if (!companyId || !hasActive) return;
    const id = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(id);
  }, [companyId, hasActive, load]);

  const primary = useMemo(() => {
    const active = jobs.find(
      (j) => j.status === "PENDING" || j.status === "PROCESSING",
    );
    if (active) return active;
    return jobs[0] ?? null;
  }, [jobs]);

  const progressPercent = useMemo(() => {
    if (!primary || primary.status === "FAILED") return 0;
    if (primary.status === "COMPLETED") return 100;
    const meta = primary.metadata ?? {};
    const total = Number(meta.csv_total_data_rows ?? 0);
    const cur = Math.max(0, Number(primary.csv_resume_row_index ?? 0));
    if (total <= 0) return primary.status === "PROCESSING" ? 8 : 0;
    return Math.min(100, Math.round((cur / total) * 100));
  }, [primary]);

  const subtitle = useMemo(() => {
    if (!primary) {
      return "Quando sincronizar o CSV da EPOC, o progresso do import de receitas aparece aqui.";
    }
    const meta = primary.metadata ?? {};
    const created = Number(meta.revenue_entries_created_total ?? 0) || 0;
    const skipped = Number(meta.rows_skipped_total ?? 0) || 0;
    const totalRows = Number(meta.csv_total_data_rows ?? 0) || null;
    if (primary.status === "COMPLETED") {
      return `${created} receita(s) criadas${skipped ? ` · ${skipped} linha(s) ignoradas` : ""}${totalRows ? ` · ${totalRows} linhas no CSV` : ""}.`;
    }
    if (primary.status === "FAILED") {
      return (
        primary.error_message?.slice(0, 220) ||
        "O processamento falhou; reveja a integração e os logs."
      );
    }
    if (primary.status === "PENDING") {
      return "Aguardando o processador (webhook ou fila). Pode levar alguns segundos.";
    }
    return `${created} receita(s) até agora · ${skipped} ignoradas${totalRows ? ` · linha ${Math.min(primary.csv_resume_row_index ?? 0, totalRows)}/${totalRows}` : ""}.`;
  }, [primary]);

  const percent = Math.max(0, Math.min(100, progressPercent));

  return (
    <Card className="border-2 border-sky-500/45 bg-linear-to-r from-sky-500/15 via-cyan-500/12 to-emerald-500/10 shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/30 text-sky-950 ring-1 ring-sky-700/20 dark:text-sky-100">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-sky-900/85 dark:text-sky-100/85">
                Integração EPOC · receitas (CSV)
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {hasActive
                  ? "Import de receitas em curso"
                  : primary
                    ? `Último job: ${statusLabel(primary.status)}`
                    : "Nenhum import de CSV recente"}
              </h3>
              <p className="mt-1 text-sm font-medium text-sky-950/90 dark:text-sky-100/90">
                {loading ? "A carregar…" : subtitle}
              </p>
              {primary ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatRelativeTime(primary.created_at)} ·{" "}
                  <span className="font-mono text-[11px]">{primary.id.slice(0, 8)}…</span>
                  {primary.provider ? ` · ${primary.provider}` : null}
                </p>
              ) : null}
            </div>
          </div>

          <Button size="sm" className="shrink-0" variant="secondary" asChild>
            <Link to="/app/integracoes">
              Abrir integrações
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-sky-950/15 dark:bg-sky-100/20">
          <div
            className="h-full rounded-full bg-linear-to-r from-sky-500 to-cyan-500 transition-all"
            style={{
              width: `${loading ? 12 : primary?.status === "FAILED" ? 0 : percent}%`,
            }}
            aria-hidden
          />
        </div>

        {jobs.length > 1 ? (
          <ul className="mt-4 space-y-1.5 border-t border-sky-900/10 pt-3 text-xs text-muted-foreground dark:border-sky-100/15">
            {jobs.slice(0, 5).map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium text-foreground">
                    {statusLabel(j.status)}
                  </span>{" "}
                  <span className="font-mono">{j.id.slice(0, 8)}</span>
                </span>
                <span>{formatRelativeTime(j.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

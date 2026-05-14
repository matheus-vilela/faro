import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Company } from "@/contexts/CompanyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { isOnboardingFiscalNfeRecebidasDashboardEnabled } from "@/lib/onboardingFiscalDashboard";
import { supabase } from "@/lib/supabase";
import { completeCompanyOnboardingFiscalStep } from "@/services/companyOnboardingFlagsService";
import { ArrowRight, FileBadge, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

function parseOnboardingFiscalMetrics(raw: unknown): {
  sync: boolean;
  max: number;
  synced: number;
  ignored: number;
} {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const n = (k: string) => {
    const v = o[k];
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
  };
  return {
    sync: isOnboardingFiscalNfeRecebidasDashboardEnabled(raw),
    max: n("max_nfes_sync"),
    synced: n("nfes_sync"),
    ignored: n("nfes_ignored"),
  };
}

function formatRelativeCompact(iso: string, refMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = refMs - t;
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) {
    const m = Math.floor(diffMs / 60_000);
    return m < 1 ? "agora há pouco" : `há ${m} min`;
  }
  if (h < 48) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} dias`;
}

function progressPercent(max: number, synced: number, ignored: number): number {
  if (max <= 0) return 0;
  const done = Math.max(0, synced + ignored);
  return Math.min(100, Math.max(0, Math.round((done / max) * 100)));
}

/**
 * Onboarding fiscal · NF-e recebidas (Focus / SEFAZ).
 * Visível com `onboarding_fiscal.sync` ativo; cópia e barra seguem `max_nfes_sync`.
 */
export function DashboardFocusNfeRecebidasSyncCard({
  company,
}: {
  company: Company | null;
}) {
  const { refetchCompanies } = useCompany();
  const companyId = company?.id;
  const [loading, setLoading] = useState(true);
  const [nfeLogCount, setNfeLogCount] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [fiscalAutoMarkFailed, setFiscalAutoMarkFailed] = useState(false);
  const autoFiscalSyncedRef = useRef(false);

  const obFiscal = parseOnboardingFiscalMetrics(company?.onboarding_fiscal);
  const fiscalOnboardingDone = company?.onboarding_fiscal_completed === true;
  const focusnfe = company?.focusnfe;

  const loadCount = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!companyId) {
        setNfeLogCount(null);
        if (!opts?.silent) setLoading(false);
        return;
      }
      if (!opts?.silent) setLoading(true);
      const { count, error } = await supabase
        .from("company_nfe_import_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (error) {
        console.error("DashboardFocusNfeRecebidasSyncCard", error);
        if (!opts?.silent) setNfeLogCount(0);
      } else {
        setNfeLogCount(count ?? 0);
      }
      if (!opts?.silent) setLoading(false);
    },
    [companyId],
  );

  useEffect(() => {
    autoFiscalSyncedRef.current = false;
    queueMicrotask(() => setFiscalAutoMarkFailed(false));
  }, [companyId]);

  useEffect(() => {
    if (
      !isOnboardingFiscalNfeRecebidasDashboardEnabled(
        company?.onboarding_fiscal,
      )
    ) {
      return;
    }
    queueMicrotask(() => void loadCount());
  }, [loadCount, company?.onboarding_fiscal]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (
      !isOnboardingFiscalNfeRecebidasDashboardEnabled(
        company?.onboarding_fiscal,
      ) ||
      fiscalOnboardingDone
    ) {
      return;
    }
    const id = window.setInterval(() => {
      void loadCount({ silent: true });
    }, 45_000);
    return () => window.clearInterval(id);
  }, [company?.onboarding_fiscal, fiscalOnboardingDone, loadCount]);

  /** Primeira NF-e na base: persistir conclusão fiscal sem obrigar clique extra. */
  useEffect(() => {
    if (
      !isOnboardingFiscalNfeRecebidasDashboardEnabled(
        company?.onboarding_fiscal,
      )
    ) {
      return;
    }
    if (
      !companyId ||
      nfeLogCount === null ||
      nfeLogCount === 0 ||
      autoFiscalSyncedRef.current
    ) {
      return;
    }
    autoFiscalSyncedRef.current = true;
    void (async () => {
      const res = await completeCompanyOnboardingFiscalStep(companyId);
      if (res.error) {
        autoFiscalSyncedRef.current = false;
        setFiscalAutoMarkFailed(true);
        console.error(
          "DashboardFocusNfeRecebidasSyncCard fiscal sync",
          res.error,
        );
        return;
      }
      await refetchCompanies();
    })();
  }, [companyId, company?.onboarding_fiscal, nfeLogCount, refetchCompanies]);

  if (
    !company ||
    !isOnboardingFiscalNfeRecebidasDashboardEnabled(company.onboarding_fiscal)
  ) {
    return null;
  }

  if (!obFiscal.sync) {
    return null;
  }

  const needsAutoCompleteFiscal =
    !loading &&
    nfeLogCount !== null &&
    nfeLogCount > 0 &&
    !fiscalOnboardingDone &&
    !fiscalAutoMarkFailed;

  if (
    !loading &&
    nfeLogCount !== null &&
    nfeLogCount > 0 &&
    !fiscalOnboardingDone &&
    fiscalAutoMarkFailed
  ) {
    return null;
  }

  const ultimaSyncAt =
    focusnfe && typeof focusnfe === "object" && !Array.isArray(focusnfe)
      ? (focusnfe as Record<string, unknown>).nfes_recebidas_ultima_sync_at
      : undefined;
  const ultimaSyncLabel =
    typeof ultimaSyncAt === "string" && ultimaSyncAt.trim()
      ? formatRelativeCompact(ultimaSyncAt, nowMs)
      : null;

  const max = obFiscal.max;
  const done = obFiscal.synced + obFiscal.ignored;
  const barPct = progressPercent(max, obFiscal.synced, obFiscal.ignored);
  const awaitingSefazEstimate = max === 0;

  return (
    <Card className="border-2 border-violet-500/40 bg-linear-to-r from-violet-500/12 via-indigo-500/10 to-sky-500/10 shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/30 text-violet-950 ring-1 ring-violet-700/20 dark:text-violet-100">
              {awaitingSefazEstimate || needsAutoCompleteFiscal ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileBadge className="h-5 w-5 opacity-95" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-violet-950/85 dark:text-violet-100/85">
                Onboarding fiscal · NF-e recebidas
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {awaitingSefazEstimate
                  ? "A obter dados na SEFAZ"
                  : "Sincronização das NF-e recebidas"}
              </h3>

              {awaitingSefazEstimate ? (
                <p className="mt-2 text-sm font-medium leading-relaxed text-violet-950/92 dark:text-violet-100/90 [&_strong]:font-semibold">
                  Estamos a consultar a SEFAZ pelos dados das{" "}
                  <strong>NF-e recebidas</strong> desta unidade. Assim que a
                  primeira listagem terminar, o total estimado aparece aqui e
                  acompanha o progresso de sincronização.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-violet-950/92 dark:text-violet-100/90 [&_strong]:font-semibold">
                    <strong>{done}</strong> de <strong>{max}</strong> notas
                    contabilizadas na estimativa da SEFAZ.
                  </p>
                  <div
                    className="mt-4 h-2.5 overflow-hidden rounded-full bg-violet-950/15 dark:bg-violet-100/18"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={barPct}
                    aria-label="Progresso da sincronização das NF-e na Focus"
                  >
                    <div
                      className="h-full rounded-full bg-linear-to-r from-violet-500 to-indigo-500 transition-all"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </>
              )}

              {ultimaSyncLabel &&
                !company?.onboarding_fiscal?.max_nfes_sync && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Última sincronização com a Focus registada{" "}
                    <span className="font-medium text-foreground/80">
                      {ultimaSyncLabel}
                    </span>
                    .
                  </p>
                )}

              {needsAutoCompleteFiscal ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  A atualizar o estado do onboarding na conta…
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Button size="sm" className="shrink-0" variant="outline" asChild>
              <Link to="/app/configuracoes/fiscal">
                Configurações fiscais
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Company } from "@/contexts/CompanyContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  isOnboardingFiscalFlowCompleted,
  isOnboardingFiscalInterpretConfirmPhase,
  isOnboardingFiscalNfeRecebidasDashboardEnabled,
  isOnboardingFiscalSefazUnavailable,
  onboardingFiscalSefazRetryAt,
} from "@/lib/onboardingFiscalDashboard";
import { confirmOnboardingFiscalInterpretPhase } from "@/services/companyOnboardingFlagsService";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileBadge,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

type FiscalCardTheme = {
  card: string;
  iconBox: string;
  eyebrow: string;
  subtitle: string;
  progressTrack: string;
  progressFill: string;
};

/** Cores por fase (diferencia do card EPOC em sky). Layout igual ao PDV. */
const FISCAL_CARD_THEMES = {
  confirm: {
    card: "border-2 border-emerald-500/40 bg-linear-to-r from-emerald-500/12 via-teal-500/10 to-sky-500/10 shadow-md",
    iconBox:
      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/30 text-emerald-950 ring-1 ring-emerald-700/20 dark:text-emerald-100",
    eyebrow:
      "text-xs font-bold uppercase tracking-wider text-emerald-950/85 dark:text-emerald-100/85",
    subtitle:
      "mt-1 text-sm font-medium leading-relaxed text-emerald-950/92 dark:text-emerald-100/90",
    progressTrack:
      "mt-4 h-2.5 overflow-hidden rounded-full bg-emerald-950/15 dark:bg-emerald-100/20",
    progressFill:
      "h-full rounded-full bg-linear-to-r from-emerald-500 to-teal-500 transition-all",
  },
  sefaz: {
    card: "border-2 border-amber-500/45 bg-linear-to-r from-amber-500/14 via-orange-500/10 to-amber-500/8 shadow-md",
    iconBox:
      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/35 text-amber-950 ring-1 ring-amber-700/25 dark:text-amber-100",
    eyebrow:
      "text-xs font-bold uppercase tracking-wider text-amber-950/85 dark:text-amber-100/85",
    subtitle:
      "mt-1 text-sm font-medium leading-relaxed text-amber-950/92 dark:text-amber-100/90",
    progressTrack:
      "mt-4 h-2.5 overflow-hidden rounded-full bg-amber-950/15 dark:bg-amber-100/20",
    progressFill:
      "h-full rounded-full bg-linear-to-r from-amber-500 to-orange-500 transition-all",
  },
  sync: {
    card: "border-2 border-violet-500/40 bg-linear-to-r from-violet-500/12 via-indigo-500/10 to-sky-500/10 shadow-md",
    iconBox:
      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/30 text-violet-950 ring-1 ring-violet-700/20 dark:text-violet-100",
    eyebrow:
      "text-xs font-bold uppercase tracking-wider text-violet-950/85 dark:text-violet-100/85",
    subtitle:
      "mt-1 text-sm font-medium leading-relaxed text-violet-950/92 dark:text-violet-100/90",
    progressTrack:
      "mt-4 h-2.5 overflow-hidden rounded-full bg-violet-950/15 dark:bg-violet-100/18",
    progressFill:
      "h-full rounded-full bg-linear-to-r from-violet-500 to-indigo-500 transition-all",
  },
} satisfies Record<string, FiscalCardTheme>;

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

function formatSefazRetryLabel(
  retryAtIso: string | null,
  nowMs: number,
): string {
  if (!retryAtIso) return "em breve";
  const t = new Date(retryAtIso).getTime();
  if (!Number.isFinite(t)) return "em breve";
  const diffMs = t - nowMs;
  if (diffMs <= 60_000) return "em breve";
  const m = Math.ceil(diffMs / 60_000);
  if (m < 60) return `em cerca de ${m} min`;
  const h = Math.ceil(m / 60);
  return `em cerca de ${h} h`;
}

/**
 * Onboarding fiscal · NF-e recebidas (Focus / SEFAZ).
 * Layout alinhado ao card EPOC; cores por fase (violeta / âmbar / verde).
 */
export function DashboardFocusNfeRecebidasSyncCard({
  company,
}: {
  company: Company | null;
}) {
  const { refetchCompanies } = useCompany();
  const companyId = company?.id;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [interpretClosing, setInterpretClosing] = useState(false);

  const obFiscal = parseOnboardingFiscalMetrics(company?.onboarding_fiscal);
  const fiscalOnboardingDone = isOnboardingFiscalFlowCompleted(
    company?.onboarding_fiscal,
  );
  const focusnfe = company?.focusnfe;
  const interpretConfirmPhase = isOnboardingFiscalInterpretConfirmPhase(
    company?.onboarding_fiscal,
  );
  const progressPhase = isOnboardingFiscalNfeRecebidasDashboardEnabled(
    company?.onboarding_fiscal,
  );
  const sefazUnavailable = isOnboardingFiscalSefazUnavailable(
    company?.onboarding_fiscal,
  );
  const sefazRetryAt = onboardingFiscalSefazRetryAt(company?.onboarding_fiscal);
  const sefazRetryLabel = formatSefazRetryLabel(sefazRetryAt, nowMs);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
  const awaitingSefazEstimate = max === 0 && !sefazUnavailable;

  const theme = useMemo((): FiscalCardTheme => {
    if (interpretConfirmPhase) return FISCAL_CARD_THEMES.confirm;
    if (sefazUnavailable) return FISCAL_CARD_THEMES.sefaz;
    return FISCAL_CARD_THEMES.sync;
  }, [interpretConfirmPhase, sefazUnavailable]);

  const { title, subtitle, showSpinner, percent, icon } = useMemo(() => {
    if (interpretConfirmPhase) {
      return {
        title: "Sincronização concluída",
        subtitle:
          "As notas deste lote foram processadas. Fornecedores, produtos, despesas e estoque foram criados automaticamente.",
        showSpinner: false,
        percent: 100,
        icon: "success" as const,
      };
    }
    if (sefazUnavailable) {
      return {
        title: "SEFAZ indisponível no momento",
        subtitle: `Não foi possível obter resposta da SEFAZ para listar as NF-e recebidas desta unidade. Vamos tentar novamente ${sefazRetryLabel} de forma automática. Não é necessário fazer nada agora — o painel atualiza assim que a sincronização retomar.`,
        showSpinner: false,
        percent: 12,
        icon: "warning" as const,
      };
    }
    if (awaitingSefazEstimate) {
      return {
        title: "A obter dados na SEFAZ",
        subtitle: `Este processo pode demorar um pouco. Assim que a sincronização terminar, o processamento das notas será iniciado automaticamente.
            <br /> 
          <strong>Fornecedores, produtos, despesas e estoque serão criados automaticamente.</strong>`,
        showSpinner: true,
        percent: 0,
        icon: "sync" as const,
      };
    }
    return {
      title: "Sincronização das NF-e recebidas",
      subtitle: `${done} de ${max} notas processadas${ultimaSyncLabel ? ` · Última sincronização ${ultimaSyncLabel}` : ""}.`,
      showSpinner: obFiscal.sync && done < max,
      percent: barPct,
      icon: "sync" as const,
    };
  }, [
    interpretConfirmPhase,
    sefazUnavailable,
    sefazRetryLabel,
    awaitingSefazEstimate,
    done,
    max,
    ultimaSyncLabel,
    obFiscal.sync,
    barPct,
  ]);

  if (!company || fiscalOnboardingDone) {
    return null;
  }

  if (!progressPhase && !interpretConfirmPhase) {
    return null;
  }

  const renderIcon = () => {
    if (showSpinner) {
      return <Loader2 className="h-5 w-5 animate-spin" />;
    }
    if (icon === "success") {
      return <CheckCircle2 className="h-5 w-5 opacity-95" />;
    }
    if (icon === "warning") {
      return <AlertTriangle className="h-5 w-5 opacity-95" />;
    }
    return <FileBadge className="h-5 w-5 opacity-95" />;
  };

  const barWidth = showSpinner
    ? Math.max(12, percent)
    : interpretConfirmPhase
      ? 100
      : sefazUnavailable
        ? 12
        : percent;

  return (
    <Card className={theme.card}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={theme.iconBox}>{renderIcon()}</div>
            <div className="min-w-0">
              <p className={theme.eyebrow}>
                Onboarding fiscal · NF-e recebidas
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {title}
              </h3>
              <p
                className={theme.subtitle}
                dangerouslySetInnerHTML={{ __html: subtitle as string }}
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-col sm:flex-wrap sm:items-end sm:justify-end">
            {interpretConfirmPhase ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                variant="default"
                disabled={interpretClosing}
                onClick={() => {
                  if (!companyId) return;
                  setInterpretClosing(true);
                  void (async () => {
                    const res =
                      await confirmOnboardingFiscalInterpretPhase(companyId);
                    if (res.error) {
                      setInterpretClosing(false);
                      console.error(
                        "confirmOnboardingFiscalInterpretPhase",
                        res.error,
                      );
                      return;
                    }
                    await refetchCompanies();
                  })();
                }}
              >
                {interpretClosing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirmar e fechar
              </Button>
            ) : null}
            <Button size="sm" className="shrink-0" variant="outline" asChild>
              <Link to="/app/integracoes">
                Integração Fiscal
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {!awaitingSefazEstimate && !interpretConfirmPhase && (
          <div className={theme.progressTrack}>
            <div
              className={theme.progressFill}
              style={{ width: `${barWidth}%` }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={barWidth}
              aria-label="Progresso do onboarding fiscal"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

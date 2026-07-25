import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany, type Company } from "@/contexts/CompanyContext";
import {
  isOnboardingPdvAwaitingEpocSync,
  isOnboardingPdvConfirmPhase,
  isOnboardingPdvJsonCompleted,
  isOnboardingPdvPortalFailure,
  isOnboardingPdvProcessingSales,
  onboardingPdvDashboardProgressPercent,
  parseOnboardingPdv,
  shouldShowOnboardingPdvResumeImportButton,
} from "@/lib/onboardingPdvDashboard";
import { completeCompanyOnboardingIntegrationPdvStep } from "@/services/companyOnboardingFlagsService";
import { invokeEpocCsvSync } from "@/services/epocSyncCsvService";
import { kickCsvRevenueImportJob } from "@/services/kickCsvRevenueImportService";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/**
 * Onboarding EPOC · vendas: lê apenas `companies.onboarding_pdv` atualizado pelo fluxo
 * `onboarding_initial` / `lockOnboardingPdv` (setup da unidade ou «Tentar novamente» aqui).
 * Syncs `full`, `previous_day` e rotina diária não alteram este JSON.
 */
export function DashboardIntegrationCsvRevenueCard({
  company,
}: {
  company: Company;
}) {
  const { refetchCompanies } = useCompany();
  const companyId = company.id;
  const onboardingPdv = company.onboarding_pdv;
  const ob = useMemo(() => parseOnboardingPdv(onboardingPdv), [onboardingPdv]);

  const [retryBusy, setRetryBusy] = useState(false);
  const [completeIntegrationBusy, setCompleteIntegrationBusy] = useState(false);
  const [kickBusy, setKickBusy] = useState(false);
  const [resumeImportClockMs, setResumeImportClockMs] = useState(() =>
    Date.now(),
  );

  const confirmPhase = isOnboardingPdvConfirmPhase(onboardingPdv);
  const portalFailure = isOnboardingPdvPortalFailure(onboardingPdv);
  const processingSales = isOnboardingPdvProcessingSales(onboardingPdv);
  const awaitingEpocSync = isOnboardingPdvAwaitingEpocSync(onboardingPdv);
  const importFailed = ob.import_status === "failed";

  const percent = onboardingPdvDashboardProgressPercent(onboardingPdv);

  const showResumeImportButton = useMemo(
    () =>
      shouldShowOnboardingPdvResumeImportButton(
        onboardingPdv,
        resumeImportClockMs,
      ),
    [onboardingPdv, resumeImportClockMs],
  );

  useEffect(() => {
    if (!processingSales || confirmPhase || showResumeImportButton) {
      return;
    }
    // Relógio para liberar «Retomar» (fila sem % ou progresso parcial travado).
    const timer = window.setInterval(() => {
      setResumeImportClockMs(Date.now());
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [processingSales, confirmPhase, showResumeImportButton]);

  const { title, subtitle, showSpinner, icon } = useMemo(() => {
    if (confirmPhase) {
      return {
        title: "Sincronização concluída",
        subtitle:
          ob.sales_total > 0
            ? `${ob.sales_total} vendas processadas. Foram cadastradas as movimentações de vendas, fichas técnicas, produtos e o estoque respectivo.`
            : "Não havia vendas no período consultado no portal EPOC. Pode confirmar e fechar esta etapa.",
        showSpinner: false,
        icon: "success" as const,
      };
    }
    if (importFailed) {
      return {
        title: "Falha no processamento da sincronização EPOC",
        subtitle:
          ob.import_error?.slice(0, 260) ||
          "O processamento da sincronização EPOC falhou; pode tentar de novo ou rever a integração.",
        showSpinner: false,
        icon: "error" as const,
      };
    }
    if (portalFailure) {
      return {
        title: "Não foram  encontrado dados válidos na integração EPOC",
        subtitle:
          "A exportação no portal não produziu dados utilizáveis nesta sincronização.",
        showSpinner: false,
        icon: "error" as const,
      };
    }
    if (ob.portal_busy && !processingSales) {
      return {
        title: "Sincronização com o portal EPOC",
        subtitle: "A função está a obter dados do portal EPOC. Aguarde...",
        showSpinner: true,
        icon: "sync" as const,
      };
    }
    if (processingSales) {
      const pct = percent;
      return {
        title: "Processando vendas do EPOC",
        subtitle:
          ob.sales_total > 0
            ? `${pct}% foram processadas (${ob.sales_sync}/${ob.sales_total})`
            : ob.sales_sync > 0
              ? "A importar vendas..."
              : ob.import_status === "pending"
                ? "A processar as receitas na integração. Pode demorar alguns segundos."
                : "A importar vendas...",
        showSpinner: true,
        icon: "sync" as const,
      };
    }
    if (awaitingEpocSync) {
      return {
        title: "À espera da sincronização EPOC",
        subtitle:
          "Quando a sincronização EPOC iniciar, todas as vendas serão processadas e o progresso aparecerá aqui.<br/><strong>Vendas, fichas técnicas, produtos e o estoque serão identificados e cadastrados automaticamente.</strong>",
        showSpinner: true,
        icon: "sync" as const,
      };
    }
    return {
      title: "À espera da sincronização EPOC",
      subtitle:
        "Inicie a sincronização em Integrações ou no assistente de configuração da unidade.",
      showSpinner: false,
      icon: "idle" as const,
    };
  }, [
    confirmPhase,
    importFailed,
    portalFailure,
    processingSales,
    awaitingEpocSync,
    ob,
    percent,
  ]);

  const completeIntegrationOnboarding = useCallback(async () => {
    if (!companyId) return;
    setCompleteIntegrationBusy(true);
    try {
      const res = await completeCompanyOnboardingIntegrationPdvStep(companyId);
      if (res.error) {
        toast.error(
          res.error.slice(0, 220) ||
            "Não foi possível concluir a etapa de integração.",
        );
        return;
      }
      toast.success("Integração PDV marcada como concluída.", {
        duration: 3500,
      });
      await refetchCompanies();
    } finally {
      setCompleteIntegrationBusy(false);
    }
  }, [companyId, refetchCompanies]);

  const retryOnboardingEpocImport = useCallback(async () => {
    if (!companyId) return;
    setRetryBusy(true);
    try {
      const res = await invokeEpocCsvSync(companyId, {
        sync_mode: "onboarding_initial",
        lockOnboardingPdv: true,
        resetPdvOnboardingCompleted: true,
      });
      if (!res.ok) {
        toast.error(
          res.error?.slice(0, 240) ??
            "Não foi possível repetir a sincronização com o portal EPOC.",
        );
      } else {
        toast.success(
          "Sincronização iniciada — o CSV será gerado e o import de receitas entrará na fila.",
          { duration: 5000 },
        );
      }
      await refetchCompanies();
    } finally {
      setRetryBusy(false);
    }
  }, [companyId, refetchCompanies]);

  const resumeCsvImport = useCallback(async () => {
    if (!companyId) return;
    setKickBusy(true);
    try {
      const res = await kickCsvRevenueImportJob(companyId);
      if (!res.ok) {
        toast.error(
          res.error?.slice(0, 240) ??
            "Não foi possível retomar a importação do CSV.",
        );
        return;
      }
      if (res.action === "reconciled") {
        toast.success(
          "Importação já tinha sido concluída — o dashboard foi atualizado.",
          { duration: 5000 },
        );
      } else if (res.action === "recreated") {
        toast.success(
          "Novo job de importação criado a partir do CSV exportado.",
          { duration: 5000 },
        );
      } else {
        toast.message("Importação do CSV retomada.", { duration: 4000 });
      }
      await refetchCompanies();
    } finally {
      setKickBusy(false);
    }
  }, [companyId, refetchCompanies]);

  if (isOnboardingPdvJsonCompleted(onboardingPdv)) {
    return null;
  }

  const barWidth = showSpinner
    ? Math.max(12, percent)
    : confirmPhase
      ? 100
      : portalFailure || importFailed
        ? 0
        : percent;

  const renderIcon = () => {
    if (showSpinner || retryBusy) {
      return <Loader2 className="h-5 w-5 animate-spin" />;
    }
    if (icon === "success") {
      return (
        <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
      );
    }
    if (icon === "error") {
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    }
    return <FileSpreadsheet className="h-5 w-5" />;
  };

  return (
    <Card className="border-2 border-sky-500/45 bg-linear-to-r from-sky-500/15 via-cyan-500/12 to-emerald-500/10 shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/30 text-sky-950 ring-1 ring-sky-700/20 dark:text-sky-100">
              {renderIcon()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-sky-900/85 dark:text-sky-100/85">
                Onboarding EPOC · Vendas realizadas
              </p>
              <h3 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
                {title}
              </h3>
              <p className="mt-1 text-sm font-medium text-sky-950/90 dark:text-sky-100/90">
                <span
                  dangerouslySetInnerHTML={{ __html: subtitle as string }}
                />
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-col sm:flex-wrap sm:items-end sm:justify-end">
            {(importFailed || portalFailure) && (
              <Button
                size="sm"
                type="button"
                disabled={retryBusy || ob.portal_busy || processingSales}
                onClick={() => void retryOnboardingEpocImport()}
              >
                {retryBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Tentar novamente
              </Button>
            )}
            {showResumeImportButton && (
              <Button
                size="sm"
                type="button"
                variant="secondary"
                disabled={kickBusy || ob.portal_busy}
                onClick={() => void resumeCsvImport()}
              >
                {kickBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Retomar importação
              </Button>
            )}
            {confirmPhase ? (
              <Button
                size="sm"
                type="button"
                className="shrink-0"
                variant="default"
                disabled={completeIntegrationBusy}
                onClick={() => void completeIntegrationOnboarding()}
              >
                {completeIntegrationBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirmar e fechar
              </Button>
            ) : null}
            <Button size="sm" className="shrink-0" variant="outline" asChild>
              <Link to="/app/integracoes">
                Integrações EPOC
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {processingSales && (
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-sky-950/15 dark:bg-sky-100/20">
            <div
              className="h-full rounded-full bg-linear-to-r from-sky-500 to-cyan-500 transition-all"
              style={{ width: `${barWidth}%` }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={barWidth}
              aria-label="Progresso do onboarding EPOC"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

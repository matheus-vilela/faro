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
} from "@/lib/onboardingPdvDashboard";
import { completeCompanyOnboardingIntegrationPdvStep } from "@/services/companyOnboardingFlagsService";
import { invokeEpocCsvSync } from "@/services/epocSyncCsvService";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/**
 * Onboarding EPOC · vendas: estado só em `companies.onboarding_pdv` (Realtime).
 */
export function DashboardIntegrationCsvRevenueCard({
  company,
}: {
  company: Company;
}) {
  const { refetchCompanies } = useCompany();
  const companyId = company.id;
  const ob = useMemo(
    () => parseOnboardingPdv(company.onboarding_pdv),
    [company.onboarding_pdv],
  );

  const [retryBusy, setRetryBusy] = useState(false);
  const [completeIntegrationBusy, setCompleteIntegrationBusy] = useState(false);

  const confirmPhase = isOnboardingPdvConfirmPhase(company.onboarding_pdv);
  const portalFailure = isOnboardingPdvPortalFailure(company.onboarding_pdv);
  const processingSales = isOnboardingPdvProcessingSales(
    company.onboarding_pdv,
  );
  const awaitingEpocSync = isOnboardingPdvAwaitingEpocSync(
    company.onboarding_pdv,
  );
  const importFailed = ob.import_status === "failed";

  const percent = onboardingPdvDashboardProgressPercent(company.onboarding_pdv);

  const { title, subtitle, showSpinner, icon } = useMemo(() => {
    if (confirmPhase) {
      return {
        title: "Sincronização concluída",
        subtitle: `${ob.sales_total > 0 ? ob.sales_total : ob.sales_sync} vendas processadas. Foram cadastradas as movimentações de vendas, fichas técnicas, produtos e o estoque respectivo.`,
        showSpinner: false,
        icon: "success" as const,
      };
    }
    if (importFailed) {
      return {
        title: "Falha no processamento do CSV",
        subtitle:
          ob.import_error?.slice(0, 260) ||
          "O processamento do CSV falhou; pode tentar de novo ou rever a integração.",
        showSpinner: false,
        icon: "error" as const,
      };
    }
    if (portalFailure) {
      return {
        title: "Sincronização sem CSV utilizável",
        subtitle:
          ob.portal_message?.slice(0, 260) ||
          "A exportação no portal não produziu tabela utilizável nesta sincronização.",
        showSpinner: false,
        icon: "error" as const,
      };
    }
    if (ob.portal_busy && !processingSales) {
      return {
        title: "Sincronização com o portal EPOC",
        subtitle:
          "A função está a obter dados do portal EPOC. Depois disto o CSV entra na fila de receitas.",
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
          "Quando a sincronização EPOC correr, o progresso aparece aqui até à primeira importação estar concluída.",
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

  if (isOnboardingPdvJsonCompleted(company.onboarding_pdv)) {
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
                {subtitle}
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
      </CardContent>
    </Card>
  );
}

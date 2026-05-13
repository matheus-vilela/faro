import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { invokeEpocCsvSync } from "@/services/epocSyncCsvService";
import { patchCompanyMaps } from "@/services/unitSetupService";
import { parseEpocSettings } from "@/types/companyIntegration";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/** Sem registo recente de tentativa diária (~40 h). */
const STALE_MS = 40 * 60 * 60 * 1000;

const DISMISS_LS_PREFIX = "faro:epocDailySyncAlertDismissed:";

function readDismissedAttemptAt(companyId: string): string | null {
  try {
    return window.localStorage.getItem(`${DISMISS_LS_PREFIX}${companyId}`);
  } catch {
    return null;
  }
}

function writeDismissedAttemptAt(companyId: string, attemptAtIso: string) {
  try {
    window.localStorage.setItem(
      `${DISMISS_LS_PREFIX}${companyId}`,
      attemptAtIso,
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function DashboardEpocDailySyncAlertCard({
  companyId,
}: {
  companyId: string | undefined;
}) {
  const { currentCompany, refetchCompanies } = useCompany();
  const pdvOnboardingPending =
    !!companyId &&
    currentCompany?.id === companyId &&
    currentCompany.onboarding_integration_pdv_completed !== true;
  const pdvSyncLocked =
    !!companyId &&
    currentCompany?.id === companyId &&
    currentCompany.syncing_pdv === true;
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown>>({});
  /** Alinhado ao localStorage após dismiss ou quando muda `epoc_daily_sync_last_attempt_at`. */
  const [dismissedLocal, setDismissedLocal] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      setEnabled(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("company_integrations")
      .select("enabled, settings")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();
    setLoading(false);
    if (error || !data) {
      setEnabled(false);
      return;
    }
    setEnabled(!!data.enabled);
    setSettingsRaw((data.settings ?? {}) as Record<string, unknown>);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!companyId) return;
    const id = window.setInterval(() => void load(), 120_000);
    return () => window.clearInterval(id);
  }, [companyId, load]);

  const s = useMemo(() => parseEpocSettings(settingsRaw), [settingsRaw]);

  const attemptAtIso = s.epoc_daily_sync_last_attempt_at?.trim() ?? "";

  useEffect(() => {
    if (!companyId || !attemptAtIso) {
      setDismissedLocal(false);
      return;
    }
    setDismissedLocal(readDismissedAttemptAt(companyId) === attemptAtIso);
  }, [companyId, attemptAtIso]);

  const { show, variant, title, description } = useMemo(() => {
    if (!enabled || loading) {
      return {
        show: false,
        variant: "stale" as const,
        title: "",
        description: "",
      };
    }
    const atRaw = s.epoc_daily_sync_last_attempt_at?.trim() ?? "";
    const atMs = atRaw ? Date.parse(atRaw) : NaN;
    const stale = Number.isFinite(atMs) && Date.now() - atMs > STALE_MS;
    const failed = s.epoc_daily_sync_last_attempt_ok === false;

    if (failed) {
      return {
        show: true,
        variant: "failed" as const,
        title: "Falha na sincronização automática (EPOC)",
        description:
          (s.epoc_daily_sync_last_attempt_error?.trim() ||
            "A rotina diária não concluiu a exportação. Pode repetir agora ou ver detalhes nas integrações.") +
          (atRaw
            ? ` Última tentativa: ${new Date(atRaw).toLocaleString("pt-BR")}.`
            : ""),
      };
    }
    if (stale) {
      return {
        show: true,
        variant: "stale" as const,
        title: "Possível atraso na sincronização automática",
        description: atRaw
          ? `Último registo da rotina: ${new Date(atRaw).toLocaleString("pt-BR")}. Verifique se o Cron do Supabase está ativo ou atualize manualmente.`
          : "Sem registo recente da rotina diária. Confirme o agendamento ou sincronize agora.",
      };
    }
    return {
      show: false,
      variant: "stale" as const,
      title: "",
      description: "",
    };
  }, [enabled, loading, s]);

  const dismissedForThisAttempt =
    !!companyId && attemptAtIso.length > 0 && dismissedLocal;

  const handleDismissAlert = () => {
    if (!companyId || !attemptAtIso) return;
    writeDismissedAttemptAt(companyId, attemptAtIso);
    setDismissedLocal(true);
  };

  const handleRetryDaily = async () => {
    if (!companyId) return;
    const { error: lockErr } = await patchCompanyMaps(companyId, {
      syncing_pdv: true,
      onboarding_integration_pdv_completed: false,
    });
    if (lockErr) {
      toast.error(
        lockErr.slice(0, 220) ??
          "Não foi possível iniciar a sincronização (trava PDV).",
      );
      return;
    }
    await refetchCompanies();
    setRetrying(true);
    const data = await invokeEpocCsvSync(companyId, {
      sync_mode: "previous_day",
      lockOnboardingPdv: pdvOnboardingPending,
    });
    setRetrying(false);
    if (!data.ok) {
      toast.error(data.error ?? "Não foi possível sincronizar.");
      await load();
      await refetchCompanies();
      return;
    }
    toast.success(
      "Sincronização do dia anterior iniciada. O import de receitas pode demorar alguns minutos.",
    );
    await load();
    await refetchCompanies();
  };

  if (!show || dismissedForThisAttempt) return null;

  return (
    <Card
      className={
        variant === "failed"
          ? "border-destructive/50 bg-destructive/10"
          : "border-amber-600/45 bg-amber-500/10"
      }
    >
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <div
            className={
              variant === "failed"
                ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/25 text-destructive"
                : "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-600/25 text-amber-900 dark:text-amber-200"
            }
          >
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              EPOC · rotina diária
            </p>
            <h3 className="text-base font-semibold text-foreground sm:text-lg">
              {title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Button
            type="button"
            disabled={retrying || pdvSyncLocked}
            className="w-full sm:w-auto"
            onClick={() => void handleRetryDaily()}
          >
            {retrying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />A atualizar…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sincronizar dia anterior agora
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            asChild
          >
            <Link to="/app/integracoes">Abrir integrações</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground sm:w-auto"
            onClick={handleDismissAlert}
          >
            <X className="mr-2 h-4 w-4" aria-hidden />
            Ocultar este aviso
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

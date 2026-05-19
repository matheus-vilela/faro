import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { isEpocCsvSyncUiBusy } from "@/lib/epocCsvSyncProgress";
import {
  epocDailySyncConsultedDayLabel,
  formatEpocDailySyncAttemptAtPtBr,
  isEpocDailySyncBenignNoSales,
} from "@/lib/epocDailySyncAlert";
import { supabase } from "@/lib/supabase";
import { invokeEpocCsvSync } from "@/services/epocSyncCsvService";
import { parseEpocSettings } from "@/types/companyIntegration";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

/** Sem registo recente de tentativa diária (~40 h). */
const STALE_MS = 40 * 60 * 60 * 1000;

const DISMISS_LS_PREFIX = "faro:epocDailySyncAlertDismissed:";

type AlertVariant = "failed" | "stale" | "no_sales";

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
  const { refetchCompanies } = useCompany();
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const epocSyncUiBusy =
    !!companyId &&
    isEpocCsvSyncUiBusy(companyId, {
      localSyncing: retrying,
    });
  const [enabled, setEnabled] = useState(false);
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown>>({});
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

  const alertContent = useMemo(() => {
    if (!enabled || loading) {
      return {
        show: false,
        variant: "stale" as AlertVariant,
        title: "",
        body: null as ReactNode,
      };
    }
    const atRaw = s.epoc_daily_sync_last_attempt_at?.trim() ?? "";
    const atMs = atRaw ? Date.parse(atRaw) : NaN;
    const recent = Number.isFinite(atMs) && nowMs - atMs <= STALE_MS;
    const stale = Number.isFinite(atMs) && nowMs - atMs > STALE_MS;
    const benignNoSales = isEpocDailySyncBenignNoSales(s);
    const failed =
      s.epoc_daily_sync_last_attempt_ok === false && !benignNoSales;
    const verificationLabel = formatEpocDailySyncAttemptAtPtBr(atRaw);

    if (benignNoSales && recent) {
      const consultedDayBr = epocDailySyncConsultedDayLabel(s, atRaw);
      return {
        show: true,
        variant: "no_sales" as const,
        title: "Nenhuma venda encontrada no EPOC",
        body: (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              A rotina diária consultou o portal para o dia{" "}
              <span className="font-semibold text-foreground">
                {consultedDayBr}
              </span>{" "}
              (fuso America/Sao_Paulo) e não houve movimentação de vendas.
              <br />
              <strong>Nada foi importado, comum em dias sem operação.</strong>
            </p>
            {atRaw ? (
              <p>
                <span className="font-medium text-foreground">
                  Verificação da rotina:
                </span>{" "}
                {verificationLabel}{" "}
                <span className="text-xs">(horário de Brasília)</span>
              </p>
            ) : null}
          </div>
        ),
      };
    }

    if (failed) {
      return {
        show: true,
        variant: "failed" as const,
        title: "Falha na sincronização automática (EPOC)",
        body: (
          <p className="text-sm text-muted-foreground">
            {s.epoc_daily_sync_last_attempt_error?.trim() ||
              "A rotina diária não concluiu a exportação. Pode repetir agora ou ver detalhes nas integrações."}
            {atRaw ? (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  Última tentativa:
                </span>{" "}
                {verificationLabel} (horário de Brasília).
              </>
            ) : null}
          </p>
        ),
      };
    }
    if (stale) {
      return {
        show: true,
        variant: "stale" as const,
        title: "Possível atraso na sincronização automática",
        body: (
          <p className="text-sm text-muted-foreground">
            {atRaw ? (
              <>
                <span className="font-medium text-foreground">
                  Último registo:
                </span>{" "}
                {verificationLabel} (horário de Brasília). Verifique se o cron
                do Supabase está ativo ou sincronize manualmente.
              </>
            ) : (
              "Sem registo recente da rotina diária. Confirme o agendamento ou sincronize agora."
            )}
          </p>
        ),
      };
    }
    return {
      show: false,
      variant: "stale" as AlertVariant,
      title: "",
      body: null,
    };
  }, [enabled, loading, nowMs, s]);

  const { show, variant, title, body } = alertContent;

  const dismissedForThisAttempt =
    !!companyId && attemptAtIso.length > 0 && dismissedLocal;

  const handleDismissAlert = () => {
    if (!companyId || !attemptAtIso) return;
    writeDismissedAttemptAt(companyId, attemptAtIso);
    setDismissedLocal(true);
  };

  const handleRetryDaily = async () => {
    if (!companyId) return;
    setRetrying(true);
    const data = await invokeEpocCsvSync(companyId, {
      sync_mode: "previous_day",
    });
    setRetrying(false);
    if (!data.ok) {
      toast.error(data.error ?? "Não foi possível sincronizar.");
      await load();
      await refetchCompanies();
      return;
    }
    toast.success(
      "Sincronização do dia anterior concluída. Se houver vendas, o import de receitas seguirá em segundo plano.",
    );
    await load();
    await refetchCompanies();
  };

  if (!show || dismissedForThisAttempt) return null;

  const isWarning = variant === "no_sales" || variant === "stale";
  const cardClass = isWarning
    ? "border-amber-600/50 bg-amber-500/12"
    : "border-destructive/50 bg-destructive/10";
  const iconWrapClass = isWarning
    ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-600/30 text-amber-950 dark:text-amber-100"
    : "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/25 text-destructive";

  return (
    <Card className={cardClass}>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <div className={iconWrapClass}>
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80 dark:text-amber-100/80">
              EPOC · rotina diária
            </p>
            <h3 className="text-base font-semibold text-foreground sm:text-lg">
              {title}
            </h3>
            <div className="mt-1">{body}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Button
            type="button"
            disabled={epocSyncUiBusy}
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
                Tentar novamente
              </>
            )}
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

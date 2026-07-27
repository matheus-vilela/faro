import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { retryEpocDailyExtras } from "@/services/epocRetryDailyExtrasService";
import { parseEpocSettings } from "@/types/companyIntegration";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export function DashboardEpocPartialSyncCard({
  companyId,
}: {
  companyId: string | undefined;
}) {
  const { refetchCompanies } = useCompany();
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown>>({});
  const [enabled, setEnabled] = useState(false);

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

  const s = useMemo(() => parseEpocSettings(settingsRaw), [settingsRaw]);
  const summary = s.epoc_partial_sync_summary?.trim() ?? "";
  const missingServices = s.epoc_partial_sync_missing_services_days?.length ?? 0;
  const missingFat = s.epoc_partial_sync_missing_faturamento_days?.length ?? 0;
  const hasGaps = !!summary && (missingServices > 0 || missingFat > 0);

  const onRetry = async () => {
    if (!companyId) return;
    setRetrying(true);
    try {
      const result = await retryEpocDailyExtras({ companyId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.partial_sync_summary) {
        toast.message(result.partial_sync_summary);
      } else {
        toast.success(
          result.message ?? "Dados em falta rebuscados com sucesso.",
        );
      }
      await load();
      await refetchCompanies();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erro ao rebuscar dados EPOC.",
      );
    } finally {
      setRetrying(false);
    }
  };

  if (!companyId || loading || !enabled || !hasGaps) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">
            Sincronização EPOC parcial
          </p>
          <p className="text-muted-foreground">{summary}</p>
          <p className="text-muted-foreground text-xs">
            Serviços em falta: {missingServices} dia(s) · Faturamento em falta:{" "}
            {missingFat} dia(s)
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={retrying}
          onClick={() => void onRetry()}
          className="shrink-0"
        >
          {retrying ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Rebuscando…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              Buscar o que faltou
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

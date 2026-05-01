import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { hasFocusNfeEmpresaId } from "@/services/focusAtualizarCertificadoService";
import type { Company } from "@/contexts/CompanyContext";
import {
  ArrowRight,
  CheckCircle2,
  FileBadge,
  Loader2,
  Landmark,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

const HOURS_UNTIL_CONSIDER_EMPTY = 4;
/** Após onboarding, não manter este aviso indefinidamente quando continua sem NF-e na base. */
const MAX_DAYS_SINCE_ONBOARDING = 30;

function parseCompletedAtIso(setup: Record<string, unknown> | null | undefined): string | null {
  const raw = setup?.completed_at;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function isSetupCompleted(setup: Record<string, unknown> | null | undefined): boolean {
  return setup?.status === "completed";
}

function hoursBetween(startMs: number, endMs: number): number {
  return (endMs - startMs) / 3_600_000;
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

/**
 * Aviso no primeiro ciclo sem NF-e importada na base (fonte típica: sincronização
 * NF-e **recebidas** na SEFAZ via Focus — pode demorar várias horas).
 */
export function DashboardFocusNfeRecebidasSyncCard({
  company,
}: {
  company: Company | null;
}) {
  const companyId = company?.id;
  const [loading, setLoading] = useState(true);
  const [nfeLogCount, setNfeLogCount] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadCount = useCallback(async () => {
    if (!companyId) {
      setNfeLogCount(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { count, error } = await supabase
      .from("company_nfe_import_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (error) {
      console.error("DashboardFocusNfeRecebidasSyncCard", error);
      setNfeLogCount(null);
    } else {
      setNfeLogCount(count ?? 0);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void loadCount());
  }, [loadCount]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const focusnfe = company?.focusnfe;
  const setup = company?.setup as Record<string, unknown> | undefined;
  const completedAtIso = parseCompletedAtIso(setup ?? null);
  const anchorSetupMs = completedAtIso ? new Date(completedAtIso).getTime() : NaN;
  const anchorCreatedMs = company?.created_at
    ? new Date(company.created_at).getTime()
    : NaN;
  const anchorMs = Number.isFinite(anchorSetupMs)
    ? anchorSetupMs
    : Number.isFinite(anchorCreatedMs)
      ? anchorCreatedMs
      : NaN;

  const hoursSinceOnboarding = Number.isFinite(anchorMs)
    ? hoursBetween(anchorMs, nowMs)
    : 0;
  const daysSinceOnboarding = hoursSinceOnboarding / 24;
  const withinExpectationWindow = hoursSinceOnboarding < HOURS_UNTIL_CONSIDER_EMPTY;

  const ultimaSyncAt =
    focusnfe && typeof focusnfe === "object" && !Array.isArray(focusnfe)
      ? (focusnfe as Record<string, unknown>).nfes_recebidas_ultima_sync_at
      : undefined;
  const ultimaSyncLabel =
    typeof ultimaSyncAt === "string" && ultimaSyncAt.trim()
      ? formatRelativeCompact(ultimaSyncAt, nowMs)
      : null;

  const eligibleBase =
    !!companyId &&
    Number.isFinite(anchorMs) &&
    hasFocusNfeEmpresaId(focusnfe) &&
    isSetupCompleted(setup) &&
    daysSinceOnboarding <= MAX_DAYS_SINCE_ONBOARDING;

  const showCard =
    eligibleBase && !loading && nfeLogCount !== null && nfeLogCount === 0;

  useEffect(() => {
    if (!showCard) return;
    const id = window.setInterval(() => {
      void loadCount();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [showCard, loadCount]);

  if (!showCard) {
    return null;
  }

  const title = withinExpectationWindow
    ? "A sincronizar NF-e recebidas (SEFAZ)"
    : "Ainda sem NF-e recebidas na conta";

  const body = withinExpectationWindow ? (
    <>
      O sistema está a consultar e a importar as notas fiscais de{" "}
      <strong>compra</strong> disponíveis na SEFAZ para o CNPJ desta unidade. Esse
      primeiro ciclo costuma levar entre <strong>2 e 4 horas</strong>; quando houver notas
      e a importação concluir, os dados passam a aparecer na aplicação (compras, produtos,
      etc.).
    </>
  ) : (
    <>
      Já passou o tempo habitual de espera e{" "}
      <strong>ainda não há nenhuma NF-e importada</strong> para esta unidade. Nesse caso
      assumimos que <strong>pode não existir histórico de NF-e de entrada associado a este
      CNPJ</strong> na SEFAZ — ou o certificado / ambiente ainda não permitem essa
      consulta. Se a unidade compra com nota fiscal, confira as configurações fiscais e o
      certificado A1; caso contrário pode continuar a usar o Faro sem esse histórico.
    </>
  );

  return (
    <Card className="border-2 border-violet-500/40 bg-linear-to-r from-violet-500/12 via-indigo-500/10 to-sky-500/10 shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/30 text-violet-950 ring-1 ring-violet-700/20 dark:text-violet-100">
              {withinExpectationWindow ? (
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
                {title}
              </h3>
              <div className="mt-2 text-sm font-medium text-violet-950/92 dark:text-violet-100/90 [&_strong]:font-semibold">
                <p className="leading-relaxed">{body}</p>
              </div>
              {ultimaSyncLabel ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Última sincronização com a Focus registada{" "}
                  <span className="font-medium text-foreground/80">{ultimaSyncLabel}</span>
                  .
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  A primeira sincronização automática pode começar minutos após concluir o
                  onboarding com certificado válido na Focus.
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {!withinExpectationWindow ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Quando aparecerem importações na base, este aviso some automaticamente.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/55 px-3 py-2 text-xs text-muted-foreground">
                <Landmark className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <span>Consulta SEFAZ mediada pela Focus · até ~4 h é normal</span>
              </div>
            )}
            <Button size="sm" className="shrink-0" variant="outline" asChild>
              <Link to="/app/configuracoes/fiscal">
                Configurações fiscais
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {withinExpectationWindow ? (
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-violet-950/15 dark:bg-violet-100/18">
            <div
              className="h-full rounded-full bg-linear-to-r from-violet-500 to-indigo-500 transition-all motion-safe:animate-pulse"
              style={{
                width: `${Math.min(96, Math.max(28, Math.round((hoursSinceOnboarding / HOURS_UNTIL_CONSIDER_EMPTY) * 92)))}%`,
              }}
              aria-hidden
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

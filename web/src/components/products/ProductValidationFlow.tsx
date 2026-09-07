import { CorrelationCaseWorkbench } from "@/components/products/correlacao2/CorrelationCaseWorkbench";
import { ProductCorrelationKpis } from "@/components/products/ProductCorrelationKpis";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/contexts/CompanyContext";
import {
  correlationFiscalStepStatus,
  correlationOnboardingCanStart,
  correlationPdvStepStatus,
  type CorrelationOnboardingStepStatus,
} from "@/lib/correlationOnboardingPrereqs";
import {
  fetchProductSetupQueue,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import {
  filterValidationToQueue,
  itemsPendingAiCorrelation,
} from "@/lib/productValidation/invokeCorrelateSoldPurchased";
import {
  patchProductValidationSession,
  startProductValidationSession,
  useProductValidationSession,
} from "@/lib/productValidation/session";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

function PrerequisiteStatusIcon({
  status,
}: {
  status: CorrelationOnboardingStepStatus;
}) {
  if (status === "success") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
  }
  if (status === "processing") {
    return (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
    );
  }
  if (status === "alert") {
    return (
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
    );
  }
  if (status === "error") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function PrerequisiteRow({
  status,
  label,
}: {
  status: CorrelationOnboardingStepStatus;
  label: string;
}) {
  const done = status === "success";
  return (
    <li className="flex items-center gap-2">
      <PrerequisiteStatusIcon status={status} />
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </li>
  );
}

function correlationGateHeaderIcon(
  fiscal: CorrelationOnboardingStepStatus,
  pdv: CorrelationOnboardingStepStatus,
) {
  const worst: CorrelationOnboardingStepStatus[] = [fiscal, pdv];
  if (worst.includes("error")) {
    return <AlertCircle className="h-8 w-8 text-destructive" />;
  }
  if (worst.includes("alert")) {
    return (
      <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
    );
  }
  if (worst.includes("processing")) {
    return <Loader2 className="h-8 w-8 animate-spin text-violet-600" />;
  }
  return <Sparkles className="h-8 w-8 text-muted-foreground" />;
}

function CorrelationQueueSkeleton() {
  return (
    <div
      className="correlation-queue-skeleton space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Carregando itens para classificar.</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/80 bg-card px-3 py-3 sm:px-4"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-12" />
          </div>
        ))}
      </div>
      <Skeleton className="h-18 w-full rounded-xl" />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 min-w-48 flex-1 md:max-w-xs" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="overflow-hidden rounded-md border">
        <div className="flex gap-4 border-b bg-muted/40 px-3 py-2.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-12" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b px-3 py-3 last:border-0"
          >
            <div className="w-[25%] space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-9 w-[20%]" />
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CorrelationAiTableLoading() {
  return (
    <div
      className="absolute inset-0 z-10 flex min-h-[22rem] items-center justify-center rounded-md bg-background/80 px-6 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-sky-500/25" />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10">
            <Sparkles className="h-6 w-6 animate-pulse text-sky-600 dark:text-sky-400" />
          </span>
        </span>
        <p className="mt-4 text-base font-semibold">Verificando com a IA</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Cruzando o PDV com as notas fiscais. Aguarde alguns instantes.
        </p>
        <p className="mt-3 flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Isso pode levar um instante
        </p>
      </div>
    </div>
  );
}

function CorrelationIdleCard({
  tone,
  icon,
  title,
  description,
  children,
}: {
  tone: "amber" | "muted" | "ok";
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-xl rounded-xl border px-6 py-10",
        tone === "amber" && "border-amber-500/35 bg-amber-500/[0.07]",
        tone === "muted" && "border-border/80 bg-card",
        tone === "ok" && "border-border/80 bg-card",
      )}
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="mb-3">{icon}</div>
        <p className="text-base font-semibold">{title}</p>
        <p
          className="mt-2 text-sm text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: description }}
        />
        {children}
      </div>
    </div>
  );
}

export function ProductValidationFlow({ companyId }: { companyId: string }) {
  const { currentCompany, refetchCompanies } = useCompany();
  const { running, result, aiSeenProductIds } =
    useProductValidationSession(companyId);
  const [queue, setQueue] = useState<ProductSetupQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [configuredIds, setConfiguredIds] = useState<string[]>([]);

  const rememberConfiguredIds = useCallback((ids: string[]) => {
    setConfiguredIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids,
    );
  }, []);

  const loadQueue = useCallback(async () => {
    const next = await fetchProductSetupQueue(supabase, companyId);
    setQueue(next);
    setLoading(false);
    return next;
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    setQueue(null);
    void loadQueue();
  }, [loadQueue]);

  const startValidation = async () => {
    if (
      !correlationOnboardingCanStart(
        currentCompany?.onboarding_fiscal,
        currentCompany?.onboarding_pdv,
      )
    ) {
      toast.error(
        "Finalize o onboarding fiscal e o do PDV para começar a classificar.",
      );
      return;
    }
    const outcome = await startProductValidationSession({
      companyId,
      loadQueue,
      excludeProductIds: configuredIds,
    });
    if (!outcome.ok) {
      toast.error(outcome.error);
    }
  };

  const reloadAfterConfirm = async () => {
    const next = await loadQueue();
    patchProductValidationSession(companyId, (current) => ({
      result: current.result
        ? filterValidationToQueue(current.result, next.items)
        : current.result,
    }));
  };

  const inboxItemCount = queue?.items.length ?? 0;
  const pendingAiCount = queue
    ? itemsPendingAiCorrelation(
        queue.items,
        new Set(aiSeenProductIds),
        new Set(configuredIds),
      ).length
    : 0;

  const fiscalStatus = correlationFiscalStepStatus(
    currentCompany?.onboarding_fiscal,
  );

  const pdvStatus = correlationPdvStepStatus(currentCompany?.onboarding_pdv);

  const canStart = correlationOnboardingCanStart(
    currentCompany?.onboarding_fiscal,
    currentCompany?.onboarding_pdv,
  );

  useEffect(() => {
    if (canStart) return;
    const poll = window.setInterval(() => {
      void refetchCompanies();
    }, 8_000);
    return () => window.clearInterval(poll);
  }, [canStart, refetchCompanies]);

  const pending = queue?.counts.total ?? 0;
  const showKpis = Boolean(canStart && queue && !queue.error);
  const wrap = (node: ReactNode) => (
    <div className="space-y-6">
      {showKpis && queue ? (
        <ProductCorrelationKpis counts={queue.counts} />
      ) : null}
      {node}
    </div>
  );

  if (queue?.error && !result && !running && !loading) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os produtos. {queue.error}
      </p>
    );
  }

  if (!canStart) {
    return (
      <CorrelationIdleCard
        tone={
          fiscalStatus === "error" || pdvStatus === "error" ? "amber" : "muted"
        }
        icon={correlationGateHeaderIcon(fiscalStatus, pdvStatus)}
        title="Classificar ainda não disponível"
        description="Essa etapa cruza produtos da nota fiscal com os vendidos no PDV. Libera quando o onboarding fiscal e o do PDV estiverem concluídos."
      >
        <ul className="mt-5 w-full space-y-2 text-left text-sm">
          <PrerequisiteRow
            status={fiscalStatus}
            label="Onboarding fiscal concluído"
          />
          <PrerequisiteRow
            status={pdvStatus}
            label="Onboarding do PDV concluído"
          />
        </ul>
        <Button variant="outline" className="mt-6" asChild>
          <Link to="/app">Ir ao dashboard</Link>
        </Button>
      </CorrelationIdleCard>
    );
  }

  if (loading || !queue) {
    return <CorrelationQueueSkeleton />;
  }

  if (pending === 0 && !running) {
    return wrap(
      <CorrelationIdleCard
        tone="ok"
        icon={<CheckCircle2 className="h-8 w-8 text-emerald-600" />}
        title="Cadastro alinhado"
        description="Novos itens da nota ou do PDV aparecem aqui para correlacionar comprados e vendidos."
      />,
    );
  }

  const canVerify = canStart && pendingAiCount > 0 && !running;

  return wrap(
    <div className="space-y-6">
      {!result && (
        <div className="rounded-xl border border-sky-500/80 bg-sky-500/[0.07] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Verificar com a IA</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A tabela já sugere ficha, unificar ou insumo pelo cadastro. A IA
                cruza PDV × nota só nos itens ainda sem leitura.
                {pendingAiCount > 0
                  ? ` ${pendingAiCount.toLocaleString("pt-BR")} ${
                      pendingAiCount === 1
                        ? "item ainda sem verificação"
                        : "itens ainda sem verificação"
                    }.`
                  : result
                    ? " A IA já leu os itens desta fila."
                    : ""}
              </p>
            </div>
            <Button
              type="button"
              variant={result ? "outline" : "sky"}
              size="sm"
              disabled={!canVerify}
              onClick={() => void startValidation()}
            >
              {running ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {running
                ? "Verificando…"
                : result
                  ? "Verificar restantes"
                  : "Verificar com a IA"}
            </Button>
          </div>
        </div>
      )}

      {inboxItemCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nada pendente nesta fila.
        </p>
      ) : (
        <div className="relative min-h-[22rem]">
          <div
            className={cn(
              running && "pointer-events-none select-none opacity-30",
            )}
            aria-hidden={running}
          >
            <CorrelationCaseWorkbench
              companyId={companyId}
              queue={queue}
              result={result}
              onResolved={() => void reloadAfterConfirm()}
              onConfiguredProductIdsChange={rememberConfiguredIds}
            />
          </div>
          {running ? <CorrelationAiTableLoading /> : null}
        </div>
      )}
    </div>,
  );
}

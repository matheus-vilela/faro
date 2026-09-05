import { CorrelationV2Inspector } from "@/components/products/correlacao2/CorrelationV2Inspector";
import { CorrelationV2Queue } from "@/components/products/correlacao2/CorrelationV2Queue";
import { ProductCorrelationKpis } from "@/components/products/ProductCorrelationKpis";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import {
  correlationFiscalStepStatus,
  correlationOnboardingCanStart,
  correlationPdvStepStatus,
} from "@/lib/correlationOnboardingPrereqs";
import { fetchProductSetupQueue } from "@/lib/productSetupQueue";
import {
  casesFromQueue,
  excludeResolvedCases,
  type CorrelationIntent,
} from "@/lib/productValidation/correlationCase";
import { filterValidationToQueue } from "@/lib/productValidation/invokeCorrelateSoldPurchased";
import {
  patchProductValidationSession,
  startProductValidationSession,
  useProductValidationSession,
} from "@/lib/productValidation/session";
import { supabase } from "@/lib/supabase";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export function CorrelationV2Flow({ companyId }: { companyId: string }) {
  const { currentCompany, refetchCompanies } = useCompany();
  const isMobile = useIsMobile();
  const { running, result } = useProductValidationSession(companyId);
  const [queue, setQueue] = useState<
    Awaited<ReturnType<typeof fetchProductSetupQueue>> | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [intents, setIntents] = useState<Record<string, CorrelationIntent>>({});
  const [hiddenProductIds, setHiddenProductIds] = useState<Set<string>>(
    () => new Set(),
  );

  const loadQueue = useCallback(async () => {
    const next = await fetchProductSetupQueue(supabase, companyId);
    setQueue(next);
    setLoading(false);
    return next;
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    setHiddenProductIds(new Set());
    setActiveId(null);
    setIntents({});
    void loadQueue();
  }, [loadQueue]);

  const canStart = correlationOnboardingCanStart(
    currentCompany?.onboarding_fiscal,
    currentCompany?.onboarding_pdv,
  );
  const fiscalStatus = correlationFiscalStepStatus(
    currentCompany?.onboarding_fiscal,
  );
  const pdvStatus = correlationPdvStepStatus(currentCompany?.onboarding_pdv);

  useEffect(() => {
    if (canStart) return;
    const poll = window.setInterval(() => {
      void refetchCompanies();
    }, 8_000);
    return () => window.clearInterval(poll);
  }, [canStart, refetchCompanies]);

  const cases = useMemo(
    () =>
      excludeResolvedCases(
        queue ? casesFromQueue(queue, result) : [],
        hiddenProductIds,
      ),
    [queue, result, hiddenProductIds],
  );

  useEffect(() => {
    if (activeId && cases.some((row) => row.id === activeId)) return;
    setActiveId(cases[0]?.id ?? null);
  }, [cases, activeId]);

  const active = cases.find((row) => row.id === activeId) ?? null;

  const intentFor = (row: (typeof cases)[number]): CorrelationIntent =>
    intents[row.id] ?? row.suggestedIntent;

  const hideResolved = (productIds: string[]) => {
    setHiddenProductIds((current) => {
      const next = new Set(current);
      for (const id of productIds) {
        if (id) next.add(id);
      }
      return next;
    });
    setActiveId(null);
  };

  const reloadAfterConfirm = async (productId: string) => {
    hideResolved(productId ? [productId] : []);
    const next = await loadQueue();
    patchProductValidationSession(companyId, (current) => ({
      result: current.result
        ? filterValidationToQueue(current.result, next.items)
        : current.result,
    }));
  };

  const startValidation = async () => {
    if (!canStart) {
      toast.error(
        "Finalize o onboarding fiscal e o do PDV para rodar o agente.",
      );
      return;
    }
    const outcome = await startProductValidationSession({
      companyId,
      loadQueue,
    });
    if (!outcome.ok) toast.error(outcome.error);
  };

  const pending = cases.length;

  if (loading && !queue) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center rounded-xl border border-border/80 bg-card px-6 py-10 text-center">
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-base font-semibold">Carregando itens</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Buscando produtos da nota e do PDV.
        </p>
      </div>
    );
  }

  if (queue?.error && !result) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os produtos. {queue.error}
      </p>
    );
  }

  if (pending === 0 && !running) {
    if (!canStart) {
      return (
        <div className="mx-auto w-full max-w-xl rounded-xl border border-amber-500/35 bg-amber-500/[0.07] px-6 py-10 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-700" />
          <p className="text-base font-semibold">
            Correlação ainda não disponível
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Libera quando o onboarding fiscal e o do PDV estiverem concluídos.
          </p>
          <ul className="mt-5 space-y-1 text-left text-sm">
            <li>
              Fiscal: {fiscalStatus === "success" ? "pronto" : "pendente"}
            </li>
            <li>PDV: {pdvStatus === "success" ? "pronto" : "pendente"}</li>
          </ul>
          <Button variant="outline" className="mt-6" asChild>
            <Link to="/app">Ir ao dashboard</Link>
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {queue ? <ProductCorrelationKpis counts={queue.counts} /> : null}
        <div className="mx-auto flex w-full max-w-xl flex-col items-center rounded-xl border border-border/80 bg-card px-6 py-10 text-center">
          <CheckCircle2 className="mb-3 h-8 w-8 text-emerald-600" />
          <p className="text-base font-semibold">Cadastro alinhado</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Novos itens da nota ou do PDV aparecem aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {queue ? <ProductCorrelationKpis counts={queue.counts} /> : null}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">
            {pending.toLocaleString("pt-BR")}{" "}
            {pending === 1 ? "caso na fila" : "casos na fila"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Uma lista. O agente só sugere o par e a ordem. Nada grava até
            confirmar no inspector.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={running || !canStart}
          onClick={() => void startValidation()}
        >
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {running ? "Interpretando…" : result ? "Rodar de novo" : "Rodar agente"}
        </Button>
      </div>

      <div
        className={cn(
          "grid items-start gap-4",
          !isMobile && "lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]",
        )}
      >
        <CorrelationV2Queue
          cases={cases}
          intentFor={intentFor}
          activeId={activeId}
          onSelect={(row) => setActiveId(row.id)}
        />
        {queue ? (
          <CorrelationV2Inspector
            companyId={companyId}
            queue={queue}
            selected={active}
            intent={active ? intentFor(active) : null}
            onIntentChange={(intent) => {
              if (!active) return;
              setIntents((current) => ({ ...current, [active.id]: intent }));
            }}
            onResolved={(productId) => void reloadAfterConfirm(productId)}
          />
        ) : null}
      </div>
    </div>
  );
}

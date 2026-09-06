import { CorrelationCaseWorkbench } from "@/components/products/correlacao2/CorrelationCaseWorkbench";
import { ProductCorrelationKpis } from "@/components/products/ProductCorrelationKpis";
import { Button } from "@/components/ui/button";
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
import { filterValidationToQueue } from "@/lib/productValidation/invokeCorrelateSoldPurchased";
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
  const { running, result } = useProductValidationSession(companyId);
  const [queue, setQueue] = useState<ProductSetupQueue | null>(null);
  const [loading, setLoading] = useState(true);

  const loadQueue = useCallback(async () => {
    const next = await fetchProductSetupQueue(supabase, companyId);
    setQueue(next);
    setLoading(false);
    return next;
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
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
        "Finalize o onboarding fiscal e o do PDV para iniciar a correlação.",
      );
      return;
    }
    const outcome = await startProductValidationSession({
      companyId,
      loadQueue,
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

  if (loading && !queue && !result && !running) {
    return (
      <CorrelationIdleCard
        tone="muted"
        icon={
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        }
        title="Carregando itens"
        description="Buscando produtos da nota e do PDV para a correlação."
      />
    );
  }

  if (queue?.error && !result && !running) {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar os produtos. {queue.error}
      </p>
    );
  }

  if (!result && !running) {
    if (!canStart) {
      return (
        <CorrelationIdleCard
          tone={
            fiscalStatus === "error" || pdvStatus === "error"
              ? "amber"
              : "muted"
          }
          icon={correlationGateHeaderIcon(fiscalStatus, pdvStatus)}
          title="Correlação ainda não disponível"
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

    if (pending === 0) {
      return wrap(
        <CorrelationIdleCard
          tone="ok"
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-600" />}
          title="Cadastro alinhado"
          description="Novos itens da nota ou do PDV aparecem aqui para correlacionar comprados e vendidos."
        />,
      );
    }

    return wrap(
      <CorrelationIdleCard
        tone="amber"
        icon={
          <Sparkles className="h-8 w-8 text-amber-800 dark:text-amber-400" />
        }
        title={`${pending.toLocaleString("pt-BR")} ${
          pending === 1 ? "item pendente" : "itens pendentes"
        } de correlação`}
        description="Nosso agente cruza os dados do PDV com os produtos das notas fiscais para correlacionar itens comprados e vendidos e atualizar corretamente o estoque e as movimentações. Nada é gravado até você confirmar."
      >
        <Button
          type="button"
          className="mt-6"
          onClick={() => void startValidation()}
        >
          Iniciar validação
        </Button>
      </CorrelationIdleCard>,
    );
  }

  if (running) {
    return wrap(
      <CorrelationIdleCard
        tone="muted"
        icon={
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        }
        title="Interpretando vendidos e comprados"
        description="Nosso agente está cruzando os dados do PDV com os produtos das notas fiscais para correlacionar itens comprados e vendidos. Isso pode levar um instante."
      />,
    );
  }

  if (!result) return null;

  const hasInbox = inboxItemCount > 0;

  return wrap(
    <div className="space-y-6">
      <div className="rounded-xl border border-border/80 bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              {inboxItemCount.toLocaleString("pt-BR")}{" "}
              {inboxItemCount === 1 ? "item na fila" : "itens na fila"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Diga o que é cada item. Pares iguais já vêm como unificar. Nada é
              gravado até você confirmar a ação.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void startValidation()}
          >
            Rodar de novo
          </Button>
        </div>
      </div>

      {!hasInbox ? (
        <p className="text-sm text-muted-foreground">
          Nada pendente depois desta leitura.
        </p>
      ) : queue ? (
        <CorrelationCaseWorkbench
          companyId={companyId}
          queue={queue}
          result={result}
          onResolved={() => void reloadAfterConfirm()}
        />
      ) : null}
    </div>,
  );
}

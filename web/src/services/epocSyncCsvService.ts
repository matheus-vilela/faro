import {
  clearEpocCsvSyncPending,
  markEpocCsvSyncPending,
} from "@/lib/epocCsvSyncProgress";
import { supabase } from "@/lib/supabase";
import { patchCompanyOnboardingPdv } from "@/lib/onboardingPdvPatch";
import { toast } from "sonner";

function coerceInvokeResponse(
  response: Response | undefined,
  error: unknown,
): Response | undefined {
  if (response instanceof Response) return response;
  const ctx = (error as { context?: unknown })?.context;
  return ctx instanceof Response ? ctx : undefined;
}

/** Prefer JSON `{ error }` / `{ message }` from the edge on non-2xx. */
async function messageFromInvokeFailure(
  error: unknown,
  response: Response | undefined,
): Promise<string> {
  const res = coerceInvokeResponse(response, error);
  if (res) {
    try {
      const raw = (await res.clone().text()).trim();
      if (raw) {
        try {
          const j = JSON.parse(raw) as Record<string, unknown>;
          const msg =
            (typeof j.error === "string" && j.error.trim()) ||
            (typeof j.message === "string" && j.message.trim());
          if (msg) return msg.slice(0, 2000);
        } catch {
          /* not JSON */
        }
        return raw.slice(0, 2000);
      }
    } catch {
      /* ignore */
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Falha ao executar sincronização.";
}

/**
 * Chama a edge `epoc-sync-csv`: cada etapa (login, index, validadorOz/acoes nas duas fases) é
 * gravada como um `step` no Storage com URL assinada, e o JSON traz `steps[]` para inspeção
 * e download. Sucesso só quando a fase 2 contém `id=tblExport` e o CSV é gerado.
 */
export type EpocSyncStepStatus = "ok" | "fail" | "warn";
export type EpocSyncStep = {
  index: number;
  name: string;
  label: string;
  status: EpocSyncStepStatus;
  http_status?: number | null;
  content_type?: string | null;
  bytes?: number;
  message?: string;
  storage_path?: string | null;
  file_name?: string | null;
  download_url?: string | null;
  detalhes?: Record<string, unknown>;
};

export type InvokeEpocCsvSyncOptions = {
  /**
   * - full: últimos 10 dias
   * - previous_day: dia civil anterior em America/Sao_Paulo
   * - onboarding_initial: do 1.º dia do mês anterior até ontem em SP; usado no setup da unidade
   */
  sync_mode?: "full" | "previous_day" | "onboarding_initial";
  /** Datas no formato EPOC dd/MM/aaaa (repetição a partir do histórico). */
  consulta_dias_br?: string[];
  /**
   * Se true: em sucesso mantém `onboarding_pdv.sync` até
   * `completeCompanyOnboardingIntegrationPdvStep`. Se false: em sucesso repõe `sync`
   * logo após a edge concluir (sync manual pós-onboarding).
   * Qualquer invocação define `onboarding_pdv.sync` a true no arranque e repõe false em falha.
   */
  lockOnboardingPdv?: boolean;
  /**
   * Sync disparado explicitamente na UI: volta a marcar a etapa PDV como em aberto até
   * «Concluir integração» (não usar em sync em segundo plano do assistente).
   */
  resetPdvOnboardingCompleted?: boolean;
};

export type EpocSyncCsvResponse = {
  ok: boolean;
  error?: string;
  /** Trace de cada etapa (login → index → validador/acoes 1/2 → tblExport). */
  steps?: EpocSyncStep[];
  steps_prefix?: string;
  /** Falso quando a resposta fase2 não trouxe `id=tblExport`. */
  tblExport_found?: boolean;
  /** CSV consolidado dos últimos 60 dias. */
  csv_uploaded?: boolean;
  storage_path?: string | null;
  file_name?: string | null;
  size_bytes?: number;
  download_url?: string | null;
  signed_url_expires_in?: number | null;
  /** Fila criada para import de receitas (webhook → `process-integration-csv-revenue-job`). */
  csv_revenue_import_job_id?: string | null;
};

/** Invoca a edge e devolve a resposta (URLs assinadas após sucesso). */
export async function invokeEpocCsvSync(
  companyId: string,
  options?: InvokeEpocCsvSyncOptions,
): Promise<EpocSyncCsvResponse> {
  const lockOnboardingPdv = options?.lockOnboardingPdv === true;
  const resetPdvOnboarding =
    options?.resetPdvOnboardingCompleted === true;

  const { error: syncStartErr } = await patchCompanyOnboardingPdv(companyId, {
    sync: true,
    ...(resetPdvOnboarding ? { completed: false } : {}),
  });
  if (syncStartErr) {
    return {
      ok: false,
      error: syncStartErr.slice(0, 500),
    };
  }

  markEpocCsvSyncPending(companyId);
  const body: Record<string, unknown> = { company_id: companyId };
  if (options?.sync_mode === "previous_day") {
    body.sync_mode = "previous_day";
  } else if (options?.sync_mode === "onboarding_initial") {
    body.sync_mode = "onboarding_initial";
  } else if (options?.sync_mode === "full") {
    body.sync_mode = "full";
  }
  if (options?.consulta_dias_br?.length) {
    body.consulta_dias_br = options.consulta_dias_br.slice(0, 10);
  }
  try {
    const { data, error, response } =
      await supabase.functions.invoke<EpocSyncCsvResponse>("epoc-sync-csv", {
        body,
      });
    if (error) {
      clearEpocCsvSyncPending(companyId);
      await patchCompanyOnboardingPdv(companyId, { sync: false });
      return {
        ok: false,
        error: await messageFromInvokeFailure(error, response),
      };
    }
    if (!data) {
      clearEpocCsvSyncPending(companyId);
      await patchCompanyOnboardingPdv(companyId, { sync: false });
      return { ok: false, error: "Resposta vazia da função" };
    }
    if (!data.ok) {
      clearEpocCsvSyncPending(companyId);
      await patchCompanyOnboardingPdv(companyId, { sync: false });
      return data;
    }
    // Mantém o card do dashboard visível durante a janela de transição
    // entre o fim da sync EPOC e a criação do job de importação CSV.
    window.setTimeout(() => clearEpocCsvSyncPending(companyId), 120_000);
    // Com onboarding PDV concluído, o lock já não aplica — repõe para o dash/UI refletirem o fim da sync.
    if (!lockOnboardingPdv) {
      await patchCompanyOnboardingPdv(companyId, { sync: false });
    }
    return data;
  } catch (e) {
    clearEpocCsvSyncPending(companyId);
    await patchCompanyOnboardingPdv(companyId, { sync: false });
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao executar sincronização.",
    };
  }
}

/** Repõe `onboarding_pdv.sync` quando a trava ficou órfã (sync já terminou, sem job ativo). */
export async function releaseStalePdvSyncLockIfIdle(
  companyId: string,
): Promise<boolean> {
  if (readEpocCsvSyncPending(companyId)) return false;
  const { data: activeJobs } = await supabase
    .from("integration_csv_revenue_import_jobs")
    .select("id")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .in("status", ["PENDING", "PROCESSING"])
    .limit(1);
  if (activeJobs?.length) return false;
  const { error } = await patchCompanyOnboardingPdv(companyId, { sync: false });
  return !error;
}

export function triggerEpocCsvSyncInBackground(
  companyId: string,
  options?: InvokeEpocCsvSyncOptions,
): void {
  void (async () => {
    const data = await invokeEpocCsvSync(companyId, options);
    if (!data.ok && data.error) {
      console.warn("[epoc-sync-csv]", data.error);
      toast.error(
        `Sincronização EPOC em segundo plano falhou: ${data.error}`,
        { duration: 10_000 },
      );
      return;
    }
    if (data.ok) {
      console.info(
        "[epoc-sync-csv] concluído (CSV no Storage, em segundo plano).",
      );
    } else {
      console.warn("[epoc-sync-csv]", data.error ?? "ok false");
    }
  })();
}

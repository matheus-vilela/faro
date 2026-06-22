import { isOnboardingPdvSyncInProgress } from "@/lib/onboardingPdvDefaults";
import { humanizeEpocRemoteError } from "@/lib/epocRemoteErrorMessage";
import { patchCompanyOnboardingPdv } from "@/lib/onboardingPdvPatch";
import { supabase } from "@/lib/supabase";
import { shouldKeepOnboardingPdvSync } from "@/lib/onboardingPdvDefaults";
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
          if (msg) return humanizeEpocRemoteError(msg).slice(0, 2000);
        } catch {
          /* not JSON */
        }
        return humanizeEpocRemoteError(raw).slice(0, 2000);
      }
    } catch {
      /* ignore */
    }
  }
  if (error instanceof Error && error.message) {
    return humanizeEpocRemoteError(error.message);
  }
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
   * Se true: mantém `onboarding_pdv.sync` até o import CSV terminar
   * (`process-integration-csv-revenue-job` grava `sync: false` ao concluir).
   */
  lockOnboardingPdv?: boolean;
  /** Volta a marcar a etapa PDV como em aberto até «Concluir integração». */
  resetPdvOnboardingCompleted?: boolean;
};

export type EpocSyncCsvResponse = {
  ok: boolean;
  error?: string;
  steps?: EpocSyncStep[];
  steps_prefix?: string;
  tblExport_found?: boolean;
  csv_uploaded?: boolean;
  storage_path?: string | null;
  file_name?: string | null;
  size_bytes?: number;
  download_url?: string | null;
  signed_url_expires_in?: number | null;
  csv_revenue_import_job_id?: string | null;
};

/** Invoca a edge e devolve a resposta (URLs assinadas após sucesso). */
export async function invokeEpocCsvSync(
  companyId: string,
  options?: InvokeEpocCsvSyncOptions,
): Promise<EpocSyncCsvResponse> {
  const isDailySync = options?.sync_mode === "previous_day";
  if (isDailySync) {
    const { data: row, error: readErr } = await supabase
      .from("companies")
      .select("onboarding_pdv")
      .eq("id", companyId)
      .maybeSingle();
    if (readErr) {
      return { ok: false, error: readErr.message };
    }
    if (isOnboardingPdvSyncInProgress(row?.onboarding_pdv)) {
      return {
        ok: false,
        error:
          "Sincronização PDV do onboarding em curso. A rotina diária EPOC não pode executar agora.",
      };
    }
  }

  const lockOnboardingPdv = options?.lockOnboardingPdv === true;
  const isOnboardingFlow =
    lockOnboardingPdv || options?.sync_mode === "onboarding_initial";
  const resetPdvOnboarding =
    options?.resetPdvOnboardingCompleted === true;
  const resetOnboardingMetrics =
    isOnboardingFlow ||
    resetPdvOnboarding;

  if (isOnboardingFlow) {
    const { error: syncStartErr } = await patchCompanyOnboardingPdv(companyId, {
      sync: true,
      ...(resetPdvOnboarding ? { completed: false } : {}),
      ...(resetOnboardingMetrics
        ? {
            sales_total: 0,
            sales_sync: 0,
            portal_busy: true,
            portal_outcome: null,
            portal_message: null,
            import_status: null,
            import_error: null,
          }
        : { portal_busy: true }),
    });
    if (syncStartErr) {
      return {
        ok: false,
        error: syncStartErr.slice(0, 500),
      };
    }
  }

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
      if (isOnboardingFlow) {
        await patchCompanyOnboardingPdv(companyId, {
          sync: false,
          portal_busy: false,
          portal_outcome: "failed",
          portal_message: (await messageFromInvokeFailure(error, response)).slice(
            0,
            500,
          ),
        });
      }
      return {
        ok: false,
        error: await messageFromInvokeFailure(error, response),
      };
    }
    if (!data) {
      if (isOnboardingFlow) {
        await patchCompanyOnboardingPdv(companyId, {
          sync: false,
          portal_busy: false,
          portal_outcome: "failed",
          portal_message: "Resposta vazia da função",
        });
      }
      return { ok: false, error: "Resposta vazia da função" };
    }
    if (!data.ok) {
      const syncError = humanizeEpocRemoteError(
        data.error ?? "Falha na sincronização",
      );
      if (isOnboardingFlow) {
        await patchCompanyOnboardingPdv(companyId, {
          sync: false,
          portal_busy: false,
          portal_outcome: "failed",
          portal_message: syncError.slice(0, 500),
        });
      }
      return { ...data, error: syncError };
    }
    return data;
  } catch (e) {
    const msg = humanizeEpocRemoteError(
      e instanceof Error ? e.message : "Falha ao executar sincronização.",
    );
    if (isOnboardingFlow) {
      await patchCompanyOnboardingPdv(companyId, {
        sync: false,
        portal_busy: false,
        portal_outcome: "failed",
        portal_message: msg.slice(0, 500),
      });
    }
    return { ok: false, error: msg };
  }
}

/** Repõe `onboarding_pdv.sync` quando não há portal nem import ativos. */
export async function releaseStalePdvSyncLockIfIdle(
  companyId: string,
): Promise<boolean> {
  const { data: row, error: readErr } = await supabase
    .from("companies")
    .select("onboarding_pdv")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr || !row) return false;

  const ob = row.onboarding_pdv;
  if (!ob || typeof ob !== "object" || Array.isArray(ob)) return false;
  const o = ob as Record<string, unknown>;
  if (o.completed === true || o.sync !== true) return false;
  if (o.portal_busy === true) return false;
  if (shouldKeepOnboardingPdvSync(ob)) return false;

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

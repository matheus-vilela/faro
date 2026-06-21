import { defaultOnboardingFiscalRecord } from "@/lib/onboardingFiscalDefaults";
import {
  defaultOnboardingPdvRecord,
  mergeOnboardingPdv,
} from "@/lib/onboardingPdvDefaults";
import { triggerEpocCsvSyncInBackground } from "@/services/epocSyncCsvService";
import { supabase } from "@/lib/supabase";

export type DevOnboardingResetTarget = "fiscal" | "pdv" | "both";


/** Remove cursor de listagem NF-e recebidas em `companies.focusnfe` (re-sync do zero). */
async function focusnfeClearedOfRecebidasSyncCursor(
  companyId: string,
): Promise<{ focusnfe?: Record<string, unknown>; error?: string }> {
  const { data, error } = await supabase
    .from("companies")
    .select("focusnfe")
    .eq("id", companyId)
    .maybeSingle();
  if (error) return { error: error.message };

  const raw = data?.focusnfe;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const current = { ...(raw as Record<string, unknown>) };
  const hadVersao = "nfes_recebidas_ultima_versao" in current;
  const hadSyncAt = "nfes_recebidas_ultima_sync_at" in current;
  if (!hadVersao && !hadSyncAt) return {};

  current.nfes_recebidas_ultima_versao = 0;
  current.nfes_recebidas_ultima_sync_at = null;
  return { focusnfe: current };
}

/** Repõe PDV para reexibir cards e fluxo EPOC no dashboard (`sync: true`, contadores zerados). */
export function onboardingPdvRecordForDevReset(): Record<string, unknown> {
  return mergeOnboardingPdv(defaultOnboardingPdvRecord(), {
    completed: false,
    sync: true,
    sales_total: 0,
    sales_sync: 0,
    portal_busy: false,
    portal_outcome: null,
    portal_message: null,
    import_status: null,
    import_error: null,
  });
}

/**
 * Repõe `onboarding_fiscal` e/ou `onboarding_pdv` para testes no dashboard.
 * Não altera `companies.setup` — em especial preserva `setup.epoc` (passo PDV do wizard).
 */
export async function resetCompanyOnboardingForDev(
  companyId: string,
  target: DevOnboardingResetTarget,
): Promise<{ error?: string }> {
  const touchesPdv = target === "pdv" || target === "both";

  const patch: Record<string, unknown> = {};
  if (target === "fiscal" || target === "both") {
    patch.onboarding_fiscal = defaultOnboardingFiscalRecord();
    const clearedFocus = await focusnfeClearedOfRecebidasSyncCursor(companyId);
    if (clearedFocus.error) return { error: clearedFocus.error };
    if (clearedFocus.focusnfe) {
      patch.focusnfe = clearedFocus.focusnfe;
    }
  }
  if (touchesPdv) {
    patch.onboarding_pdv = onboardingPdvRecordForDevReset();
  }
  delete patch.setup;

  const { error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId);
  if (error) return { error: error.message };

  return {};
}

/**
 * Dispara `onboarding_initial` após repor PDV (mesmo gatilho do passo 3 do wizard).
 * Exige integração EPOC ativa com URL base.
 */
export async function triggerPdvOnboardingInitialSyncAfterDevReset(
  companyId: string,
): Promise<{ started: boolean; error?: string }> {
  const { data: integ, error: integErr } = await supabase
    .from("company_integrations")
    .select("enabled, settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();
  if (integErr) return { started: false, error: integErr.message };
  if (!integ?.enabled) {
    return {
      started: false,
      error:
        "Integração EPOC inativa. Configure e ative em Integrações (ou no assistente da unidade).",
    };
  }
  const settings =
    integ.settings && typeof integ.settings === "object" && !Array.isArray(integ.settings)
      ? (integ.settings as Record<string, unknown>)
      : {};
  if (!String(settings.base_url ?? "").trim()) {
    return {
      started: false,
      error: "URL base do portal EPOC não configurada na integração.",
    };
  }

  triggerEpocCsvSyncInBackground(companyId, {
    sync_mode: "onboarding_initial",
    lockOnboardingPdv: true,
    resetPdvOnboardingCompleted: true,
  });
  return { started: true };
}

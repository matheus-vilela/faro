/**
 * Dispara a própria `epoc-sync-csv` em background para o próximo lote de dias
 * (evita idle timeout ~150s no download longo do CSV de produtos).
 */

function scheduleWaitUntil(p: Promise<unknown>): void {
  try {
    // @ts-ignore EdgeRuntime
    const ER = globalThis.EdgeRuntime;
    if (ER && typeof ER.waitUntil === "function") {
      // @ts-ignore
      ER.waitUntil(p);
      return;
    }
  } catch {
    /* ignore */
  }
  void p.catch(() => undefined);
}

export type EpocSyncCsvContinuePayload = {
  company_id: string;
  sync_mode: "full" | "previous_day" | "onboarding_initial";
  continue_chain: true;
  chain_attempt: number;
  max_days: number;
  product_sync_run_id: string;
  steps_prefix: string;
  dias_planned_br: string[];
  dias_done_br: string[];
  part_paths: string[];
  header_base: string[];
  total_dias_com_tabela: number;
  total_linhas_dados: number;
  requested_by: string;
  /** Datas manuais (replay); opcional. */
  consulta_dias_br?: string[];
};

export function triggerEpocSyncCsvContinueInBackground(opts: {
  supabaseUrl: string;
  serviceKey: string;
  payload: EpocSyncCsvContinuePayload;
  logTag?: string;
}): void {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/epoc-sync-csv`;
  const logTag = opts.logTag ?? "[epoc-sync-csv]";

  const run = (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.serviceKey}`,
          apikey: opts.serviceKey,
        },
        body: JSON.stringify(opts.payload),
      });
      const text = await res.text().catch(() => "");
      console.log(
        logTag,
        JSON.stringify({
          fase: "product_chain_trigger_result",
          company_id: opts.payload.company_id,
          chain_attempt: opts.payload.chain_attempt,
          product_sync_run_id: opts.payload.product_sync_run_id,
          status: res.status,
          previa: text.slice(0, 400),
        }),
      );
    } catch (e) {
      console.warn(
        logTag,
        JSON.stringify({
          fase: "product_chain_trigger_fail",
          company_id: opts.payload.company_id,
          chain_attempt: opts.payload.chain_attempt,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  })();

  scheduleWaitUntil(run);
}

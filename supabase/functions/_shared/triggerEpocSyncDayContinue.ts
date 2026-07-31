/**
 * Dispara a própria `epoc-sync-day` em background para o próximo lote de dias
 * (evita idle timeout ~150s em janelas longas).
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

export type EpocSyncDayContinuePayload = {
  company_id: string;
  continue_chain: true;
  chain_attempt: number;
  max_days: number;
  sync_run_id: string;
  steps_prefix: string;
  dias_planned_br: string[];
  dias_done_br: string[];
  part_paths_produtos: string[];
  part_paths_servicos: string[];
  part_paths_faturamento: string[];
  requested_by: string;
  /** Acumuladores leves (stats); day_results detalhados ficam no settings. */
  totals?: Record<string, number>;
};

export function triggerEpocSyncDayContinueInBackground(opts: {
  supabaseUrl: string;
  serviceKey: string;
  payload: EpocSyncDayContinuePayload;
  logTag?: string;
}): void {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/epoc-sync-day`;
  const logTag = opts.logTag ?? "[epoc-sync-day]";

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
          fase: "day_chain_trigger_result",
          company_id: opts.payload.company_id,
          chain_attempt: opts.payload.chain_attempt,
          sync_run_id: opts.payload.sync_run_id,
          status: res.status,
          previa: text.slice(0, 400),
        }),
      );
    } catch (e) {
      console.warn(
        logTag,
        JSON.stringify({
          fase: "day_chain_trigger_fail",
          company_id: opts.payload.company_id,
          chain_attempt: opts.payload.chain_attempt,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  })();

  scheduleWaitUntil(run);
}

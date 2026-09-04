/**
 * Dispara `epoc-retry-daily-extras` em background (após resposta do sync de produtos).
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

export function triggerEpocDailyExtrasInBackground(opts: {
  supabaseUrl: string;
  serviceKey: string;
  companyId: string;
  /** Se true, o worker encadeia a si próprio enquanto houver gaps. */
  continueChain?: boolean;
  maxDays?: number;
  /** Tentativa de cadeia (0 = primeira); limita retries em falha total. */
  chainAttempt?: number;
  logTag?: string;
}): void {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/epoc-retry-daily-extras`;
  const logTag = opts.logTag ?? "[epoc-daily-extras]";

  const run = (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.serviceKey}`,
          apikey: opts.serviceKey,
        },
        body: JSON.stringify({
          company_id: opts.companyId,
          kinds: ["services", "faturamento", "estoque"],
          max_days: opts.maxDays ?? 3,
          continue_chain: opts.continueChain !== false,
          chain_attempt: opts.chainAttempt ?? 0,
          // service role: o handler aceita JWT de serviço
          invoked_by: "service",
        }),
      });
      const text = await res.text().catch(() => "");
      console.log(
        logTag,
        JSON.stringify({
          fase: "trigger_result",
          company_id: opts.companyId,
          chain_attempt: opts.chainAttempt ?? 0,
          status: res.status,
          previa: text.slice(0, 300),
        }),
      );
    } catch (e) {
      console.warn(
        logTag,
        JSON.stringify({
          fase: "trigger_fail",
          company_id: opts.companyId,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  })();

  scheduleWaitUntil(run);
}

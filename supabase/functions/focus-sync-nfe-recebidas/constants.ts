export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export const LOG = "[focus-sync-nfe-recebidas]";

/** Teto histórico de itens por resposta na lista NF-e recebidas (Focus). */
export const FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY = 100;

export const QUEUE_MAX_ATTEMPTS_FAIL = 8;

export function isVerboseLogs(): boolean {
  return String(Deno.env.get("FOCUS_SYNC_VERBOSE_LOGS") ?? "").trim() === "true";
}

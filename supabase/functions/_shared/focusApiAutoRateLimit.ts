import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { focusAutoMaxPerMinute } from "./nfePipeline/env.ts";

/** Código estável quando o teto automático (80/min) recusa a chamada. */
export const FOCUS_AUTO_RATE_LIMITED = "focus_auto_rate_limited";

const WINDOW_SECONDS = 60;

let cachedAdmin: SupabaseClient | null = null;

function serviceAdmin(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  cachedAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

export type FocusAutoAcquireResult =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; used: number; limit: number; waitMs: number };

function parseAcquireRow(
  data: unknown,
  limit: number,
): FocusAutoAcquireResult {
  const row = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const used = Number.isFinite(Number(row.used)) ? Math.floor(Number(row.used)) : 0;
  if (row.allowed === true) {
    return { allowed: true, used, limit };
  }
  const waitMs = Math.max(250, Math.floor(Number(row.wait_ms) || 15_000));
  return { allowed: false, used, limit, waitMs };
}

async function callAcquire(
  admin: SupabaseClient | null,
  consume: boolean,
  source?: string,
): Promise<FocusAutoAcquireResult> {
  const limit = focusAutoMaxPerMinute();
  const client = admin ?? serviceAdmin();
  if (!client) {
    console.warn("[focus-auto-rpm] sem client service_role; fail-open");
    return { allowed: true, used: 0, limit };
  }

  const { data, error } = await client.rpc("focus_api_auto_acquire", {
    p_limit: limit,
    p_window_seconds: WINDOW_SECONDS,
    p_consume: consume,
    p_source: source ?? null,
  });

  if (error) {
    console.warn("[focus-auto-rpm] rpc_error fail-open", error.message);
    return { allowed: true, used: 0, limit };
  }

  return parseAcquireRow(data, limit);
}

/** Reserva um slot antes de GET de lista/XML automático. */
export async function acquireFocusAutoCall(
  opts?: { admin?: SupabaseClient; source?: string },
): Promise<FocusAutoAcquireResult> {
  return await callAcquire(opts?.admin ?? null, true, opts?.source);
}

/** Consulta o teto sem consumir slot (para não iniciar um run sem folga). */
export async function peekFocusAutoCall(
  opts?: { admin?: SupabaseClient },
): Promise<FocusAutoAcquireResult> {
  return await callAcquire(opts?.admin ?? null, false);
}

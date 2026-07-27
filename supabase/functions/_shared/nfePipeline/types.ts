export type NfeJobType =
  | "sync_company"
  | "fetch_page"
  | "download_xml"
  | "close_cycle"
  | "process_nfe";

export type NfeJobRow = {
  id: string;
  type: NfeJobType;
  company_id: string;
  payload: Record<string, unknown>;
  priority: number;
  run_after: string;
  status: string;
  leased_until: string | null;
  leased_by: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
};

export type NfeSyncStateRow = {
  company_id: string;
  mode: "onboarding" | "steady";
  status: "idle" | "running" | "backoff" | "needs_attention";
  priority: number;
  cursor_versao: number;
  pending_cursor_versao: number | null;
  window_start_date: string;
  cycle_id: string | null;
  next_sync_at: string;
  empty_poll_count: number;
  listed_count: number;
  downloaded_count: number;
  ignored_count: number;
  failed_count: number;
};

export type JobResult =
  | { ok: true; detail?: Record<string, unknown> }
  | {
    ok: false;
    error: string;
    retryAfterMs?: number;
    fatal?: boolean;
    /** Reagenda sem consumir attempts (ex.: close_cycle aguardando downloads). */
    softRequeue?: boolean;
  };

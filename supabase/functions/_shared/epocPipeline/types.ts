export type EpocJobType = "sync_company" | "fetch_window" | "close_cycle";

export type EpocJobRow = {
  id: string;
  type: EpocJobType;
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

export type EpocSyncStateRow = {
  company_id: string;
  mode: "onboarding" | "steady";
  status: "idle" | "running" | "backoff" | "needs_attention";
  priority: number;
  window_start_date: string;
  cycle_id: string | null;
  last_csv_sync_run_id: string | null;
  last_import_job_id: string | null;
  next_sync_at: string;
  empty_poll_count: number;
  last_outcome: string | null;
  last_error: string | null;
};

export type JobResult =
  | { ok: true; detail?: Record<string, unknown> }
  | {
    ok: false;
    error: string;
    retryAfterMs?: number;
    fatal?: boolean;
    /** Reagenda sem consumir attempts (ex.: close_cycle aguardando import). */
    softRequeue?: boolean;
  };

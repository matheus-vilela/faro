export type IntegrationProvider = "epoc";

export type EpocAmbiente = "producao" | "homologacao";

/** Campos usados no Faro (UI + `epoc-sync-csv`); o merge no upsert preserva chaves legadas no JSON. */
export type EpocIntegrationSettings = {
  username: string;
  /** Senha da conta EPOC (armazenada no JSONB; tráfego HTTPS) */
  password?: string;
  base_url?: string;
  codigo_filial?: string;
  ambiente?: EpocAmbiente;
  /** Preenchido pela edge `epoc-sync-csv` após sucesso. */
  last_epoc_csv_sync_at?: string;
  last_epoc_csv_storage_path?: string;
  /** Reserva do rodízio cron (`epoc-daily-sync`); mesma unidade só reprocessa após 12 h. */
  epoc_daily_sync_rotacao_at?: string;
  /** Última tentativa da rotina diária (`epoc-daily-sync`); uso no dashboard. */
  epoc_daily_sync_last_attempt_at?: string;
  epoc_daily_sync_last_attempt_ok?: boolean;
  /** `no_tbl_export` = dia sem vendas no portal (rotina diária OK). */
  epoc_daily_sync_last_attempt_outcome?:
    | "success"
    | "no_tbl_export"
    | "failed"
    | null;
  /** Dia consultado na rotina diária (dd/MM/aaaa), quando não há vendas. */
  epoc_daily_sync_last_consulted_day_br?: string | null;
  epoc_daily_sync_last_attempt_error?: string | null;
  /**
   * Legado: ignorado pelo import; a edge escolhe automaticamente a primeira folha de
   * receita operacional (excl. dedução DRE).
   */
  epoc_csv_revenue_subcategory_id?: string;
};

export type CompanyIntegrationRow = {
  id: string;
  company_id: string;
  provider: IntegrationProvider;
  enabled: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function parseEpocSettings(
  raw: Record<string, unknown>,
): EpocIntegrationSettings {
  return {
    username: typeof raw.username === "string" ? raw.username : "",
    password: typeof raw.password === "string" ? raw.password : undefined,
    base_url: typeof raw.base_url === "string" ? raw.base_url : "",
    codigo_filial: typeof raw.codigo_filial === "string" ? raw.codigo_filial : "",
    ambiente:
      raw.ambiente === "producao" || raw.ambiente === "homologacao"
        ? raw.ambiente
        : "producao",
    last_epoc_csv_sync_at:
      typeof raw.last_epoc_csv_sync_at === "string"
        ? raw.last_epoc_csv_sync_at
        : "",
    last_epoc_csv_storage_path:
      typeof raw.last_epoc_csv_storage_path === "string"
        ? raw.last_epoc_csv_storage_path
        : "",
    epoc_daily_sync_rotacao_at:
      typeof raw.epoc_daily_sync_rotacao_at === "string"
        ? raw.epoc_daily_sync_rotacao_at
        : "",
    epoc_daily_sync_last_attempt_at:
      typeof raw.epoc_daily_sync_last_attempt_at === "string"
        ? raw.epoc_daily_sync_last_attempt_at
        : "",
    epoc_daily_sync_last_attempt_ok:
      typeof raw.epoc_daily_sync_last_attempt_ok === "boolean"
        ? raw.epoc_daily_sync_last_attempt_ok
        : undefined,
    epoc_daily_sync_last_attempt_outcome:
      raw.epoc_daily_sync_last_attempt_outcome === "success" ||
      raw.epoc_daily_sync_last_attempt_outcome === "no_tbl_export" ||
      raw.epoc_daily_sync_last_attempt_outcome === "failed"
        ? raw.epoc_daily_sync_last_attempt_outcome
        : undefined,
    epoc_daily_sync_last_consulted_day_br:
      raw.epoc_daily_sync_last_consulted_day_br === null
        ? null
        : typeof raw.epoc_daily_sync_last_consulted_day_br === "string"
          ? raw.epoc_daily_sync_last_consulted_day_br
          : undefined,
    epoc_daily_sync_last_attempt_error:
      raw.epoc_daily_sync_last_attempt_error === null
        ? null
        : typeof raw.epoc_daily_sync_last_attempt_error === "string"
          ? raw.epoc_daily_sync_last_attempt_error
          : undefined,
    epoc_csv_revenue_subcategory_id:
      typeof raw.epoc_csv_revenue_subcategory_id === "string"
        ? raw.epoc_csv_revenue_subcategory_id
        : "",
  };
}

/**
 * Preserva chaves no JSON (ex.: `last_epoc_csv_*`, campos legados) e aplica o patch
 * vindo do formulário.
 */
export function mergeEpocSettingsForUpsert(
  previousRaw: Record<string, unknown> | null | undefined,
  patch: EpocIntegrationSettings,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(previousRaw ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

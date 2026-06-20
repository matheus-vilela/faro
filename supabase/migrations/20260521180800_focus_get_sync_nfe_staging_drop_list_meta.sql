-- Metadados de paginação da listagem Focus (não usados no fluxo atual).

ALTER TABLE public.focus_get_sync_nfe_staging
  DROP COLUMN IF EXISTS page_index,
  DROP COLUMN IF EXISTS versao_query_used,
  DROP COLUMN IF EXISTS x_total_count_snapshot,
  DROP COLUMN IF EXISTS x_max_version_snapshot;

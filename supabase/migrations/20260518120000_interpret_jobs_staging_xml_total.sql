-- Total de XMLs em staging a interpretar neste job (par com staging_process_offset).

alter table public.focus_get_sync_nfe_interpret_jobs
  add column if not exists staging_xml_total int not null default 0;

comment on column public.focus_get_sync_nfe_interpret_jobs.staging_xml_total is
  'Quantidade de linhas em focus_get_sync_nfe_staging (exec_id + company_id) com xml_content preenchido; total a processar neste job.';

-- Permite processar staging em várias invocações da Edge (evita timeout com muitos XMLs + LLM).
alter table public.focus_get_sync_nfe_interpret_jobs
  add column if not exists staging_process_offset int not null default 0;

comment on column public.focus_get_sync_nfe_interpret_jobs.staging_process_offset is
  'Índice base-0 na ordenação created_at,id das linhas de focus_get_sync_nfe_staging já processadas neste job; re-enfileira como pending até concluir.';

-- Só incrementa `attempts` na primeira fatia (offset = 0); retomadas do mesmo job não contam como nova tentativa.
create or replace function public.focus_get_sync_nfe_interpret_claim_job()
returns setof public.focus_get_sync_nfe_interpret_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select id
    from public.focus_get_sync_nfe_interpret_jobs
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1
  ),
  updated as (
    update public.focus_get_sync_nfe_interpret_jobs j
    set
      status = 'processing',
      started_at = coalesce(j.started_at, now()),
      attempts = case
        when coalesce(j.staging_process_offset, 0) = 0 then j.attempts + 1
        else j.attempts
      end
    from picked
    where j.id = picked.id
    returning j.*
  )
  select * from updated;
end;
$$;

comment on function public.focus_get_sync_nfe_interpret_claim_job() is
  'Reserva job pendente para interpretação staging; attempts +1 só na primeira fatia (staging_process_offset = 0).';

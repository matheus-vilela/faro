-- Fila pgmq para continuação de chunks do interpret staging (substitui auto-invocação HTTP).

create extension if not exists pgmq;

select pgmq.create('focus_interpret_staging_continue');

create or replace function public.focus_interpret_staging_queue_send(p_job_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  new_msg_id bigint;
begin
  if p_job_id is null then
    raise exception 'p_job_id obrigatório';
  end if;

  new_msg_id := (
    select s
    from pgmq.send(
      queue_name => 'focus_interpret_staging_continue',
      msg => jsonb_build_object(
        'job_id', p_job_id::text,
        'action', 'continue'
      )
    ) as s
    limit 1
  );

  return new_msg_id;
end;
$$;

comment on function public.focus_interpret_staging_queue_send(uuid) is
  'Enfileira continuação de chunk para focus_get_sync_nfe_interpret_jobs (service_role).';

create or replace function public.focus_interpret_staging_queue_read(
  p_n int default 5,
  p_vt int default 300
)
returns table (
  msg_id bigint,
  read_ct int,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  return query
  select
    r.msg_id,
    r.read_ct,
    r.enqueued_at,
    r.vt,
    r.message
  from pgmq.read(
    queue_name => 'focus_interpret_staging_continue',
    vt => greatest(coalesce(p_vt, 300), 30),
    qty => greatest(coalesce(p_n, 1), 1)
  ) as r;
end;
$$;

comment on function public.focus_interpret_staging_queue_read(int, int) is
  'Lê mensagens da fila de continuação do interpret staging (visibility timeout em segundos).';

create or replace function public.focus_interpret_staging_queue_delete(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  if p_msg_id is null then
    return false;
  end if;

  return pgmq.delete(
    queue_name => 'focus_interpret_staging_continue',
    msg_id => p_msg_id
  );
end;
$$;

comment on function public.focus_interpret_staging_queue_delete(bigint) is
  'Remove mensagem processada da fila de continuação do interpret staging.';

grant execute on function public.focus_interpret_staging_queue_send(uuid) to service_role;
grant execute on function public.focus_interpret_staging_queue_read(int, int) to service_role;
grant execute on function public.focus_interpret_staging_queue_delete(bigint) to service_role;

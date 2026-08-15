-- Teto global de chamadas automáticas à Focus (lista + XML).
-- A API aceita 100 req/min; os fluxos de volume usam no máximo 80/min
-- (janela deslizante) para reservar 20 a consultas manuais pontuais
-- (CNPJ, certificado, criar/apagar empresa).

create table if not exists public.focus_api_auto_calls (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now(),
  source text
);

create index if not exists focus_api_auto_calls_called_at_idx
  on public.focus_api_auto_calls (called_at);

comment on table public.focus_api_auto_calls is
  'Log de chamadas automáticas à Focus (lista/XML) para teto de 80/min.';

alter table public.focus_api_auto_calls enable row level security;

revoke all on table public.focus_api_auto_calls from public, anon, authenticated;
grant all on table public.focus_api_auto_calls to service_role;

create or replace function public.focus_api_auto_acquire(
  p_limit int default 80,
  p_window_seconds int default 60,
  p_consume boolean default true,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 80), 80));
  v_window int := greatest(10, least(coalesce(p_window_seconds, 60), 300));
  v_used int;
  v_oldest timestamptz;
  v_wait_ms int;
begin
  perform pg_advisory_xact_lock(87214501);

  delete from public.focus_api_auto_calls
  where called_at < clock_timestamp() - make_interval(secs => v_window);

  select count(*)::int, min(called_at)
    into v_used, v_oldest
  from public.focus_api_auto_calls;

  if v_used >= v_limit then
    v_wait_ms := greatest(
      250,
      ceil(
        extract(
          epoch from (
            v_oldest + make_interval(secs => v_window) - clock_timestamp()
          )
        ) * 1000
      )::int
    );
    return jsonb_build_object(
      'allowed', false,
      'used', v_used,
      'limit', v_limit,
      'wait_ms', v_wait_ms
    );
  end if;

  if coalesce(p_consume, true) then
    insert into public.focus_api_auto_calls (source)
    values (nullif(btrim(coalesce(p_source, '')), ''));
    v_used := v_used + 1;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'limit', v_limit,
    'wait_ms', 0
  );
end;
$$;

comment on function public.focus_api_auto_acquire(int, int, boolean, text) is
  'Reserva (ou consulta) um slot no teto de 80 chamadas automáticas/min à Focus.';

revoke all on function public.focus_api_auto_acquire(int, int, boolean, text)
  from public, anon, authenticated;
grant execute on function public.focus_api_auto_acquire(int, int, boolean, text)
  to service_role;

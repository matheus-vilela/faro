-- 1) nfe_sync_ensure_company: se o onboarding fiscal ainda está aberto, volta
--    mode=onboarding mesmo quando p_mode é null (purge deixa mode=steady).
--    Transição steady → onboarding zera o cursor para relistar do zero.
-- 2) nfe_sync_reset_onboarding: reset explícito (Ferramentas) — cursor, ciclo, jobs.

create or replace function public.nfe_sync_ensure_company(
  p_company_id uuid,
  p_window_start_date date default null,
  p_mode text default null,
  p_wake boolean default true
)
returns public.nfe_sync_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.nfe_sync_state%rowtype;
  v_focus jsonb;
  v_ob jsonb;
  v_mode text;
  v_window date;
  v_priority int;
  v_completed boolean;
  v_capture boolean;
  v_fiscal_open boolean;
begin
  select c.focusnfe, c.onboarding_fiscal
  into v_focus, v_ob
  from public.companies c
  where c.id = p_company_id;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  if coalesce(nullif(trim(v_focus->>'id_empresa'), ''), '') = '' then
    raise exception 'company sem focusnfe.id_empresa: %', p_company_id;
  end if;

  v_completed := coalesce((v_ob->>'completed')::boolean, false);
  v_capture := coalesce((v_ob->>'capture_completed')::boolean, false);
  v_fiscal_open := not v_completed and not v_capture;

  if p_mode in ('onboarding', 'steady') then
    v_mode := p_mode;
  elsif v_completed or v_capture then
    v_mode := 'steady';
  else
    v_mode := 'onboarding';
  end if;

  v_window := coalesce(p_window_start_date, public.nfe_default_window_start_date());
  v_priority := case when v_mode = 'onboarding' then 100 else 0 end;

  insert into public.nfe_sync_state (
    company_id,
    mode,
    status,
    priority,
    window_start_date,
    next_sync_at
  )
  values (
    p_company_id,
    v_mode,
    'idle',
    v_priority,
    v_window,
    case when coalesce(p_wake, true) then now() else now() + interval '2 hours' end
  )
  on conflict (company_id) do update set
    mode = case
      when p_mode in ('onboarding', 'steady') then p_mode
      when v_fiscal_open then 'onboarding'
      else public.nfe_sync_state.mode
    end,
    cursor_versao = case
      when public.nfe_sync_state.mode = 'steady'
        and (
          p_mode = 'onboarding'
          or (p_mode is distinct from 'steady' and v_fiscal_open)
        )
      then 0
      else public.nfe_sync_state.cursor_versao
    end,
    pending_cursor_versao = case
      when public.nfe_sync_state.mode = 'steady'
        and (
          p_mode = 'onboarding'
          or (p_mode is distinct from 'steady' and v_fiscal_open)
        )
      then null
      else public.nfe_sync_state.pending_cursor_versao
    end,
    window_start_date = coalesce(p_window_start_date, public.nfe_sync_state.window_start_date),
    priority = case
      when p_mode = 'onboarding' or (p_mode is distinct from 'steady' and v_fiscal_open)
        then 100
      else public.nfe_sync_state.priority
    end,
    next_sync_at = case
      when coalesce(p_wake, true) then least(public.nfe_sync_state.next_sync_at, now())
      else public.nfe_sync_state.next_sync_at
    end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.nfe_sync_ensure_company(uuid, date, text, boolean) is
  'Garante nfe_sync_state para empresa com Focus; se onboarding fiscal aberto, mode=onboarding. Transição steady→onboarding zera o cursor.';

grant execute on function public.nfe_sync_ensure_company(uuid, date, text, boolean) to service_role;

create or replace function public.nfe_sync_reset_onboarding(p_company_id uuid)
returns public.nfe_sync_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_focus jsonb;
  v_row public.nfe_sync_state%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (
    public.is_platform_admin()
    or exists (
      select 1
      from public.user_companies uc
      where uc.user_id = auth.uid()
        and uc.company_id = p_company_id
    )
  ) then
    raise exception 'forbidden';
  end if;

  if p_company_id is null then
    raise exception 'company_id obrigatório';
  end if;

  select c.focusnfe
  into v_focus
  from public.companies c
  where c.id = p_company_id;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  if coalesce(nullif(trim(v_focus->>'id_empresa'), ''), '') = '' then
    raise exception 'company sem focusnfe.id_empresa: %', p_company_id;
  end if;

  delete from public.nfe_jobs
  where company_id = p_company_id;

  insert into public.nfe_sync_state (
    company_id,
    mode,
    status,
    priority,
    cursor_versao,
    window_start_date,
    next_sync_at
  )
  values (
    p_company_id,
    'onboarding',
    'idle',
    100,
    0,
    public.nfe_default_window_start_date(),
    now()
  )
  on conflict (company_id) do update set
    mode = 'onboarding',
    status = 'idle',
    priority = 100,
    cursor_versao = 0,
    pending_cursor_versao = null,
    cycle_id = null,
    running_since = null,
    empty_poll_count = 0,
    listed_count = 0,
    downloaded_count = 0,
    ignored_count = 0,
    failed_count = 0,
    last_error = null,
    next_sync_at = now(),
    window_start_date = public.nfe_default_window_start_date(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.nfe_sync_reset_onboarding(uuid) is
  'Repõe nfe_sync_state para onboarding do zero (cursor 0, ciclo novo) e apaga nfe_jobs da unidade. Membro ou platform admin.';

revoke all on function public.nfe_sync_reset_onboarding(uuid) from public;
grant execute on function public.nfe_sync_reset_onboarding(uuid) to authenticated;

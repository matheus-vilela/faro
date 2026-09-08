-- Lista única some das Listas após commit. Histórico conserva o nome (não DELETE).

ALTER TABLE public.inventory_count_listings
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.inventory_count_listings.archived_at IS
  'Preenchido no commit de lista única (sem grupo). Some da aba Listas; sessão permanece.';

CREATE INDEX IF NOT EXISTS idx_inventory_count_listings_company_active
  ON public.inventory_count_listings(company_id)
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.commit_inventory_count_session(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_line RECORD;
  v_delta NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_count_sessions s
    JOIN public.user_companies uc ON uc.company_id = s.company_id
    WHERE s.id = p_session_id AND uc.user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT s.* INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('pending_approval', 'approved') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id AND l.counted_qty IS NULL
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'incomplete');
  END IF;

  FOR v_line IN
    SELECT * FROM public.inventory_count_lines
    WHERE session_id = v_sess.id
  LOOP
    v_delta := v_line.counted_qty - v_line.expected_qty;
    IF v_delta <> 0 THEN
      PERFORM public.adjust_product_stock(
        v_line.product_id,
        v_delta,
        CASE WHEN v_delta >= 0 THEN 'in' ELSE 'out' END,
        'inventory_count',
        v_sess.id,
        NULL
      );
    END IF;
    UPDATE public.inventory_count_lines
    SET approved_at = NOW(), updated_at = NOW()
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.inventory_count_sessions
  SET
    status = 'committed',
    approved_at = NOW(),
    committed_at = NOW()
  WHERE id = v_sess.id;

  IF COALESCE(v_sess.kind, 'regular') = 'onboarding' THEN
    UPDATE public.companies
    SET onboarding_stock_unlocked = true
    WHERE id = v_sess.company_id;
  END IF;

  DELETE FROM public.inventory_count_short_links WHERE session_id = v_sess.id;

  IF v_sess.inventory_count_listing_id IS NOT NULL THEN
    UPDATE public.inventory_count_listings
    SET archived_at = NOW()
    WHERE id = v_sess.inventory_count_listing_id
      AND inventory_count_group_id IS NULL
      AND archived_at IS NULL;

    IF FOUND THEN
      UPDATE public.inventory_count_schedules
      SET active = false, updated_at = NOW()
      WHERE inventory_count_listing_id = v_sess.inventory_count_listing_id
        AND active;
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'status', 'committed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_inventory_count_session(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_due_inventory_count_schedules()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched RECORD;
  v_listing RECORD;
  v_res JSON;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_sid UUID;
  v_next TIMESTAMPTZ;
  v_archived TIMESTAMPTZ;
BEGIN
  FOR v_sched IN
    SELECT *
    FROM public.inventory_count_schedules
    WHERE active
      AND next_run_at <= NOW()
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_sched.inventory_count_listing_id IS NOT NULL THEN
      SELECT archived_at INTO v_archived
      FROM public.inventory_count_listings
      WHERE id = v_sched.inventory_count_listing_id;

      IF v_archived IS NOT NULL THEN
        UPDATE public.inventory_count_schedules
        SET active = false, updated_at = NOW()
        WHERE id = v_sched.id;
        CONTINUE;
      END IF;

      v_res := public.open_inventory_count_session_internal(
        v_sched.company_id,
        v_sched.inventory_count_listing_id,
        'regular',
        v_sched.assigned_company_member_id,
        NULL
      );
      IF COALESCE(v_res->>'ok', 'false') = 'true' THEN
        v_sid := (v_res->>'session_id')::uuid;
        v_ids := array_append(v_ids, v_sid);
      END IF;
    ELSE
      FOR v_listing IN
        SELECT l.id, l.assigned_company_member_id
        FROM public.inventory_count_listings l
        WHERE l.inventory_count_group_id = v_sched.inventory_count_group_id
          AND l.archived_at IS NULL
          AND EXISTS (
            SELECT 1 FROM public.inventory_count_listing_products lp
            WHERE lp.listing_id = l.id
          )
      LOOP
        v_res := public.open_inventory_count_session_internal(
          v_sched.company_id,
          v_listing.id,
          'regular',
          COALESCE(v_sched.assigned_company_member_id, v_listing.assigned_company_member_id),
          NULL
        );
        IF COALESCE(v_res->>'ok', 'false') = 'true' THEN
          v_sid := (v_res->>'session_id')::uuid;
          v_ids := array_append(v_ids, v_sid);
        END IF;
      END LOOP;
    END IF;

    v_next := public.inventory_count_advance_schedule(
      v_sched.recurrence_kind, v_sched.next_run_at, v_sched.interval_days
    );

    UPDATE public.inventory_count_schedules
    SET
      last_run_at = NOW(),
      next_run_at = COALESCE(v_next, next_run_at),
      active = CASE WHEN v_sched.recurrence_kind = 'once' THEN false ELSE true END,
      updated_at = NOW()
    WHERE id = v_sched.id;
  END LOOP;

  RETURN json_build_object('ok', true, 'session_ids', to_json(v_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_due_inventory_count_schedules()
  TO authenticated, service_role;


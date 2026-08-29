-- Refazer o checklist reabre o mesmo /k/:slug (não cria outro run).
-- O short link deixa de ser apagado no submit; o RPC do slug só resolve
-- open e needs_rework, então o URL fica “morto” durante a conferência.

CREATE OR REPLACE FUNCTION public.ensure_checklist_run_short_link(p_run_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_slug TEXT;
  i INT;
BEGIN
  SELECT r.id, r.token, r.company_id
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.id = p_run_id;

  IF v_run.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.slug INTO v_slug
  FROM public.checklist_run_short_links l
  WHERE l.run_id = p_run_id;

  IF v_slug IS NOT NULL THEN
    RETURN v_slug;
  END IF;

  FOR i IN 1..12 LOOP
    v_slug := substr(md5(p_run_id::text || clock_timestamp()::text || i::text), 1, 8);
    BEGIN
      INSERT INTO public.checklist_run_short_links (slug, run_id, token, company_id)
      VALUES (v_slug, v_run.id, v_run.token, v_run.company_id);
      RETURN v_slug;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  SELECT l.slug INTO v_slug
  FROM public.checklist_run_short_links l
  WHERE l.run_id = p_run_id;
  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_checklist_run_short_link(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_checklist_run_short_link(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_checklist_run_token_by_short_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.token
  FROM public.checklist_run_short_links l
  INNER JOIN public.checklist_runs r ON r.id = l.run_id
  WHERE l.slug = lower(trim(p_slug))
    AND r.status IN ('open', 'needs_rework');
$$;

GRANT EXECUTE ON FUNCTION public.get_checklist_run_token_by_short_slug(text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_checklist_run_public(
  p_token UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_checklist RECORD;
  v_total INT;
  v_done INT;
  v_now_time TIME;
  v_dist DOUBLE PRECISION;
  v_on_time BOOLEAN := true;
  v_geo_ok BOOLEAN := true;
BEGIN
  SELECT r.id, r.checklist_id, r.status, r.company_id
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.token = p_token
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_run.status NOT IN ('open', 'needs_rework') THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  SELECT * INTO v_checklist
  FROM public.checklists c
  WHERE c.id = v_run.checklist_id;

  v_now_time := (NOW() AT TIME ZONE 'America/Sao_Paulo')::time;

  IF v_checklist.window_start IS NOT NULL AND v_checklist.window_end IS NOT NULL THEN
    IF v_now_time < v_checklist.window_start OR v_now_time > v_checklist.window_end THEN
      RETURN json_build_object('ok', false, 'error', 'outside_window');
    END IF;
  END IF;

  IF v_checklist.deadline_time IS NOT NULL AND v_now_time > v_checklist.deadline_time THEN
    v_on_time := false;
    RETURN json_build_object('ok', false, 'error', 'outside_window');
  END IF;

  IF COALESCE(v_checklist.require_geofence, false) THEN
    IF p_lat IS NULL OR p_lng IS NULL
       OR v_checklist.geofence_lat IS NULL OR v_checklist.geofence_lng IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'geolocation_required');
    END IF;
    IF p_accuracy_m IS NOT NULL AND p_accuracy_m > 100 THEN
      RETURN json_build_object('ok', false, 'error', 'geolocation_inaccurate');
    END IF;
    v_dist := public.geo_distance_meters(
      p_lat, p_lng, v_checklist.geofence_lat, v_checklist.geofence_lng
    );
    IF v_dist IS NULL OR v_dist > COALESCE(v_checklist.geofence_radius_m, 120) THEN
      RETURN json_build_object('ok', false, 'error', 'outside_geofence');
    END IF;
    v_geo_ok := true;
  END IF;

  SELECT COUNT(*)::int INTO v_total
  FROM public.checklist_items
  WHERE checklist_id = v_run.checklist_id;

  IF v_total = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_items');
  END IF;

  SELECT COUNT(*)::int INTO v_done
  FROM public.checklist_run_items cri
  JOIN public.checklist_items ci ON ci.id = cri.checklist_item_id
  WHERE cri.run_id = v_run.id AND cri.completed_at IS NOT NULL;

  IF v_done < v_total THEN
    RETURN json_build_object('ok', false, 'error', 'incomplete', 'missing', v_total - v_done);
  END IF;

  UPDATE public.checklist_runs
  SET
    status = 'submitted',
    submitted_at = NOW(),
    submitted_lat = p_lat,
    submitted_lng = p_lng,
    submitted_accuracy_m = p_accuracy_m,
    geofence_ok = CASE WHEN COALESCE(v_checklist.require_geofence, false) THEN v_geo_ok ELSE NULL END,
    on_time = v_on_time
  WHERE id = v_run.id;

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_checklist_run_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.submit_checklist_run_public(
    p_token, NULL::double precision, NULL::double precision, NULL::double precision
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_checklist_run_public(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checklist_run_public(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_checklist_run(
  p_run_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug TEXT;
BEGIN
  IF p_status NOT IN ('in_review', 'approved', 'needs_rework') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.checklist_runs r
    WHERE r.id = p_run_id
      AND public.user_has_company_access(r.company_id)
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.checklist_runs
  SET
    status = p_status,
    reviewed_at = NOW(),
    review_notes = p_notes
  WHERE id = p_run_id
    AND status IN ('submitted', 'in_review', 'needs_rework', 'approved');

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF p_status = 'needs_rework' THEN
    v_slug := public.ensure_checklist_run_short_link(p_run_id);
  ELSE
    SELECT l.slug INTO v_slug
    FROM public.checklist_run_short_links l
    WHERE l.run_id = p_run_id;
  END IF;

  RETURN json_build_object('ok', true, 'status', p_status, 'slug', v_slug);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_checklist_run(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_checklist_run_for_member(
  p_checklist_id UUID,
  p_company_member_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cl RECORD;
  v_run_id UUID;
  v_token UUID;
  v_slug TEXT;
  v_item RECORD;
BEGIN
  SELECT c.id, c.company_id INTO v_cl
  FROM public.checklists c
  WHERE c.id = p_checklist_id;

  IF v_cl.id IS NULL OR NOT public.user_has_company_access(v_cl.company_id) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.id = p_company_member_id AND m.company_id = v_cl.company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_member');
  END IF;

  SELECT r.id, r.token
  INTO v_run_id, v_token
  FROM public.checklist_runs r
  WHERE r.checklist_id = p_checklist_id
    AND r.company_member_id = p_company_member_id
    AND r.status IN ('open', 'needs_rework')
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_run_id IS NOT NULL THEN
    v_slug := public.ensure_checklist_run_short_link(v_run_id);
    RETURN json_build_object(
      'ok', true,
      'run_id', v_run_id,
      'token', v_token,
      'slug', v_slug,
      'reused', true
    );
  END IF;

  INSERT INTO public.checklist_runs (
    checklist_id, company_member_id, company_id, status
  ) VALUES (
    p_checklist_id, p_company_member_id, v_cl.company_id, 'open'
  )
  RETURNING id, token INTO v_run_id, v_token;

  FOR v_item IN
    SELECT id FROM public.checklist_items WHERE checklist_id = p_checklist_id
  LOOP
    INSERT INTO public.checklist_run_items (run_id, checklist_item_id, company_id)
    VALUES (v_run_id, v_item.id, v_cl.company_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  v_slug := public.ensure_checklist_run_short_link(v_run_id);

  RETURN json_build_object(
    'ok', true,
    'run_id', v_run_id,
    'token', v_token,
    'slug', v_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checklist_run_for_member(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_checklist_run_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_checklist RECORD;
  v_items JSON;
  v_completed JSON;
BEGIN
  SELECT r.id, r.checklist_id, r.status, r.submitted_at, r.company_id, r.review_notes
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.token = p_token;

  IF v_run.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_run.status NOT IN ('open', 'needs_rework') THEN
    RETURN json_build_object(
      'ok', true,
      'run', json_build_object(
        'status', v_run.status,
        'submitted_at', v_run.submitted_at
      ),
      'error', 'already_submitted'
    );
  END IF;

  SELECT c.id, c.title, c.description, c.enforce_item_order,
         c.window_start, c.window_end, c.deadline_time,
         c.require_geofence, c.geofence_radius_m
  INTO v_checklist
  FROM public.checklists c
  WHERE c.id = v_run.checklist_id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', ci.id,
      'title', ci.title,
      'sort_order', ci.sort_order,
      'item_type', ci.item_type,
      'config', ci.config,
      'requires_evidence', ci.requires_evidence
    ) ORDER BY ci.sort_order
  ), '[]'::json)
  INTO v_items
  FROM public.checklist_items ci
  WHERE ci.checklist_id = v_run.checklist_id;

  SELECT COALESCE(json_object_agg(
    cri.checklist_item_id::text,
    json_build_object(
      'completed_at', cri.completed_at,
      'value', cri.value,
      'evidence_paths', cri.evidence_paths,
      'is_ok', cri.is_ok,
      'review_flag', cri.review_flag
    )
  ), '{}'::json)
  INTO v_completed
  FROM public.checklist_run_items cri
  WHERE cri.run_id = v_run.id;

  RETURN json_build_object(
    'ok', true,
    'run', json_build_object(
      'status', v_run.status,
      'submitted_at', v_run.submitted_at,
      'review_notes', v_run.review_notes
    ),
    'checklist', json_build_object(
      'id', v_checklist.id,
      'title', v_checklist.title,
      'description', v_checklist.description,
      'enforce_item_order', v_checklist.enforce_item_order,
      'window_start', v_checklist.window_start,
      'window_end', v_checklist.window_end,
      'deadline_time', v_checklist.deadline_time,
      'require_geofence', v_checklist.require_geofence,
      'geofence_radius_m', v_checklist.geofence_radius_m
    ),
    'items', v_items,
    'item_state', v_completed,
    'item_completed', (
      SELECT COALESCE(json_object_agg(
        cri.checklist_item_id::text,
        cri.completed_at
      ), '{}'::json)
      FROM public.checklist_run_items cri
      WHERE cri.run_id = v_run.id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_checklist_run_public(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Company users read checklist run short links"
  ON public.checklist_run_short_links;
CREATE POLICY "Company users read checklist run short links"
  ON public.checklist_run_short_links FOR SELECT
  USING (public.user_has_company_access(company_id));

COMMENT ON TABLE public.checklist_run_short_links IS
  'Slug curto /k/:slug → token do run. A linha permanece após o envio; o RPC público só resolve open e needs_rework.';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.checklist_runs WHERE status = 'needs_rework'
  LOOP
    PERFORM public.ensure_checklist_run_short_link(r.id);
  END LOOP;
END $$;

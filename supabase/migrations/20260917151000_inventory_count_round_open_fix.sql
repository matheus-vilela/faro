-- open_inventory_count_session_internal: não ler RECORD não atribuído no RETURN.

CREATE OR REPLACE FUNCTION public.open_inventory_count_session_internal(
  p_company_id UUID,
  p_listing_id UUID,
  p_kind TEXT,
  p_assigned_company_member_id UUID,
  p_created_by_user_id UUID,
  p_group_ids UUID[] DEFAULT NULL,
  p_origin_group_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing RECORD;
  v_origin RECORD;
  v_sess_id UUID;
  v_token UUID;
  v_slug TEXT;
  v_seed JSON;
  v_kind TEXT := COALESCE(NULLIF(trim(p_kind), ''), 'regular');
  v_group_ids UUID[];
  v_gid UUID;
  v_origin_id UUID;
  v_assigned UUID;
  v_group_names TEXT;
  v_out_listing_name TEXT;
  v_out_group_name TEXT;
BEGIN
  IF v_kind NOT IN ('regular', 'onboarding') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_kind');
  END IF;

  IF v_kind = 'onboarding' THEN
    INSERT INTO public.inventory_count_sessions (
      company_id, status, created_by_user_id,
      validate_live, kind, assigned_company_member_id
    ) VALUES (
      p_company_id, 'open', p_created_by_user_id,
      false, 'onboarding', p_assigned_company_member_id
    )
    RETURNING id, token INTO v_sess_id, v_token;
    v_out_listing_name := 'Contagem geral';
    v_out_group_name := 'Onboarding';
  ELSIF p_group_ids IS NOT NULL AND cardinality(p_group_ids) > 0 THEN
    v_origin_id := COALESCE(p_origin_group_id, p_group_ids[1]);
    SELECT g.id, g.name INTO v_origin
    FROM public.inventory_count_groups g
    WHERE g.id = v_origin_id AND g.company_id = p_company_id;
    IF v_origin.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'group_not_found');
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT x
      FROM unnest(p_group_ids || ARRAY[v_origin_id]) AS x
      WHERE x IS NOT NULL
    ) INTO v_group_ids;

    IF EXISTS (
      SELECT 1 FROM unnest(v_group_ids) AS gid
      WHERE NOT EXISTS (
        SELECT 1 FROM public.inventory_count_groups g
        WHERE g.id = gid AND g.company_id = p_company_id
      )
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_group');
    END IF;

    SELECT l.assigned_company_member_id INTO v_assigned
    FROM public.inventory_count_listings l
    WHERE l.inventory_count_group_id = v_origin_id
      AND l.company_id = p_company_id
      AND l.archived_at IS NULL
    ORDER BY l.sort_order, l.name
    LIMIT 1;

    INSERT INTO public.inventory_count_sessions (
      company_id, status, created_by_user_id,
      inventory_count_group_id, inventory_count_listing_id,
      assigned_company_member_id, validate_live, kind
    ) VALUES (
      p_company_id, 'open', p_created_by_user_id,
      v_origin_id, NULL,
      COALESCE(p_assigned_company_member_id, v_assigned),
      false, 'regular'
    )
    RETURNING id, token INTO v_sess_id, v_token;

    FOREACH v_gid IN ARRAY v_group_ids LOOP
      INSERT INTO public.inventory_count_session_groups (session_id, group_id)
      VALUES (v_sess_id, v_gid)
      ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT string_agg(g.name, ', ' ORDER BY g.sort_order, g.name)
    INTO v_group_names
    FROM public.inventory_count_session_groups sg
    JOIN public.inventory_count_groups g ON g.id = sg.group_id
    WHERE sg.session_id = v_sess_id;

    v_out_group_name := COALESCE(v_group_names, v_origin.name);
  ELSE
    IF p_listing_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'listing_required');
    END IF;

    SELECT l.id, l.name, l.inventory_count_group_id, l.assigned_company_member_id,
           g.name AS group_name
    INTO v_listing
    FROM public.inventory_count_listings l
    LEFT JOIN public.inventory_count_groups g ON g.id = l.inventory_count_group_id
    WHERE l.id = p_listing_id AND l.company_id = p_company_id;

    IF v_listing.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'listing_not_found');
    END IF;

    INSERT INTO public.inventory_count_sessions (
      company_id, status, created_by_user_id,
      inventory_count_group_id, inventory_count_listing_id,
      assigned_company_member_id, validate_live, kind
    ) VALUES (
      p_company_id, 'open', p_created_by_user_id,
      v_listing.inventory_count_group_id, v_listing.id,
      COALESCE(p_assigned_company_member_id, v_listing.assigned_company_member_id),
      false, 'regular'
    )
    RETURNING id, token INTO v_sess_id, v_token;

    v_out_listing_name := v_listing.name;
    v_out_group_name := v_listing.group_name;
  END IF;

  v_seed := public.seed_inventory_count_lines(v_sess_id);
  IF COALESCE(v_seed->>'ok', 'false') <> 'true' THEN
    DELETE FROM public.inventory_count_sessions WHERE id = v_sess_id;
    RETURN json_build_object('ok', false, 'error', COALESCE(v_seed->>'error', 'seed_failed'));
  END IF;

  v_slug := public.ensure_inventory_count_short_link(v_sess_id);

  RETURN json_build_object(
    'ok', true,
    'session_id', v_sess_id,
    'token', v_token,
    'slug', v_slug,
    'listing_name', v_out_listing_name,
    'group_name', v_out_group_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID, UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID, UUID[], UUID)
  TO authenticated, service_role;

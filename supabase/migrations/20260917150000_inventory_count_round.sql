-- Rodada de contagem: um link, N setores. Linha por (listagem, produto).
-- Commit soma o SKU e só ajusta estoque se todos os pontos ativos foram contados.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_count_lines
  ADD COLUMN IF NOT EXISTS listing_id UUID
  REFERENCES public.inventory_count_listings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_count_lines.listing_id IS
  'Ponto (listagem) desta linha. NULL no onboarding.';

UPDATE public.inventory_count_lines l
SET listing_id = s.inventory_count_listing_id
FROM public.inventory_count_sessions s
WHERE l.session_id = s.id
  AND l.listing_id IS NULL
  AND s.inventory_count_listing_id IS NOT NULL;

ALTER TABLE public.inventory_count_lines
  DROP CONSTRAINT IF EXISTS inventory_count_lines_session_product;

DROP INDEX IF EXISTS public.inventory_count_lines_session_listing_product;
CREATE UNIQUE INDEX inventory_count_lines_session_listing_product
  ON public.inventory_count_lines (session_id, listing_id, product_id)
  WHERE listing_id IS NOT NULL;

DROP INDEX IF EXISTS public.inventory_count_lines_session_product_nolisting;
CREATE UNIQUE INDEX inventory_count_lines_session_product_nolisting
  ON public.inventory_count_lines (session_id, product_id)
  WHERE listing_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_listing
  ON public.inventory_count_lines (listing_id)
  WHERE listing_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_count_session_groups (
  session_id UUID NOT NULL REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.inventory_count_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_session_groups_group
  ON public.inventory_count_session_groups (group_id);

COMMENT ON TABLE public.inventory_count_session_groups IS
  'Setores incluídos na rodada (um link).';

ALTER TABLE public.inventory_count_session_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users manage inventory count session groups"
  ON public.inventory_count_session_groups;
CREATE POLICY "Company users manage inventory count session groups"
  ON public.inventory_count_session_groups FOR ALL
  USING (
    session_id IN (
      SELECT s.id FROM public.inventory_count_sessions s
      JOIN public.user_companies uc ON uc.company_id = s.company_id
      WHERE uc.user_id = auth.uid()
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM public.inventory_count_sessions s
      JOIN public.user_companies uc ON uc.company_id = s.company_id
      WHERE uc.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_session_groups TO authenticated;
GRANT ALL ON public.inventory_count_session_groups TO service_role;

INSERT INTO public.inventory_count_session_groups (session_id, group_id)
SELECT s.id, s.inventory_count_group_id
FROM public.inventory_count_sessions s
WHERE s.inventory_count_group_id IS NOT NULL
  AND s.inventory_count_listing_id IS NULL
  AND COALESCE(s.kind, 'regular') = 'regular'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_count_expand_group_ids(
  p_company_id UUID,
  p_origin_group_id UUID
)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT array_agg(DISTINCT l.inventory_count_group_id)
      FROM public.inventory_count_listing_products lp
      JOIN public.inventory_count_listings l ON l.id = lp.listing_id
      WHERE l.company_id = p_company_id
        AND l.archived_at IS NULL
        AND l.inventory_count_group_id IS NOT NULL
        AND lp.product_id IN (
          SELECT lp2.product_id
          FROM public.inventory_count_listing_products lp2
          JOIN public.inventory_count_listings l2 ON l2.id = lp2.listing_id
          WHERE l2.company_id = p_company_id
            AND l2.inventory_count_group_id = p_origin_group_id
            AND l2.archived_at IS NULL
        )
    ),
    ARRAY[p_origin_group_id]
  );
$$;

REVOKE ALL ON FUNCTION public.inventory_count_expand_group_ids(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_count_expand_group_ids(UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventory_count_groups_sharing_sku(
  p_company_id UUID,
  p_group_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_groups JSON;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH origin_products AS (
    SELECT DISTINCT lp.product_id
    FROM public.inventory_count_listing_products lp
    JOIN public.inventory_count_listings l ON l.id = lp.listing_id
    WHERE l.company_id = p_company_id
      AND l.inventory_count_group_id = p_group_id
      AND l.archived_at IS NULL
  ),
  shared AS (
    SELECT
      g.id,
      g.name,
      g.sort_order,
      COUNT(DISTINCT lp.product_id)::INT AS shared_count,
      MIN(p.name) AS sample_name
    FROM public.inventory_count_listing_products lp
    JOIN public.inventory_count_listings l ON l.id = lp.listing_id
    JOIN public.inventory_count_groups g ON g.id = l.inventory_count_group_id
    JOIN public.products p ON p.id = lp.product_id
    JOIN origin_products op ON op.product_id = lp.product_id
    WHERE l.company_id = p_company_id
      AND l.archived_at IS NULL
      AND l.inventory_count_group_id IS NOT NULL
      AND l.inventory_count_group_id <> p_group_id
    GROUP BY g.id, g.name, g.sort_order
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', s.id,
        'name', s.name,
        'shared_count', s.shared_count,
        'sample_name', s.sample_name
      )
      ORDER BY s.sort_order, s.name
    ),
    '[]'::json
  )
  INTO v_groups
  FROM shared s;

  RETURN json_build_object('ok', true, 'groups', v_groups);
END;
$$;

GRANT EXECUTE ON FUNCTION public.inventory_count_groups_sharing_sku(UUID, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_inventory_count_lines(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_tol NUMERIC;
  v_product RECORD;
  v_sort INT := 0;
  v_count INT := 0;
  v_listing_id UUID;
  v_has_listing_products BOOLEAN;
  v_kind TEXT;
  v_is_round BOOLEAN;
BEGIN
  SELECT s.id, s.company_id, s.status, s.default_tolerance_pct,
         s.inventory_count_listing_id, COALESCE(s.kind, 'regular') AS kind
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_count_lines l WHERE l.session_id = v_sess.id) THEN
    SELECT COUNT(*)::INT INTO v_count
    FROM public.inventory_count_lines l WHERE l.session_id = v_sess.id;
    RETURN json_build_object('ok', true, 'seeded', false, 'count', v_count);
  END IF;

  v_tol := COALESCE(v_sess.default_tolerance_pct, 5);
  v_listing_id := v_sess.inventory_count_listing_id;
  v_kind := v_sess.kind;
  SELECT EXISTS (
    SELECT 1 FROM public.inventory_count_session_groups sg
    WHERE sg.session_id = v_sess.id
  ) INTO v_is_round;

  IF v_kind = 'onboarding' THEN
    FOR v_product IN
      SELECT p.id, p.current_quantity
      FROM public.products p
      WHERE p.company_id = v_sess.company_id
        AND (p.is_active IS NULL OR p.is_active = true)
      ORDER BY p.name
    LOOP
      INSERT INTO public.inventory_count_lines (
        session_id, company_id, product_id, expected_qty, tolerance_pct, sort_order
      ) VALUES (
        v_sess.id, v_sess.company_id, v_product.id,
        COALESCE(v_product.current_quantity, 0), v_tol, v_sort
      );
      v_sort := v_sort + 1;
      v_count := v_count + 1;
    END LOOP;
    RETURN json_build_object('ok', true, 'seeded', true, 'count', v_count);
  END IF;

  IF v_is_round THEN
    FOR v_product IN
      SELECT p.id, p.current_quantity, l.id AS listing_id
      FROM public.inventory_count_session_groups sg
      JOIN public.inventory_count_listings l
        ON l.inventory_count_group_id = sg.group_id
       AND l.company_id = v_sess.company_id
       AND l.archived_at IS NULL
      JOIN public.inventory_count_groups g ON g.id = l.inventory_count_group_id
      JOIN public.inventory_count_listing_products lp ON lp.listing_id = l.id
      JOIN public.products p ON p.id = lp.product_id
      WHERE sg.session_id = v_sess.id
        AND p.company_id = v_sess.company_id
        AND (p.is_active IS NULL OR p.is_active = true)
      ORDER BY g.sort_order, g.name, l.sort_order, l.name, p.name
    LOOP
      INSERT INTO public.inventory_count_lines (
        session_id, company_id, product_id, listing_id, expected_qty, tolerance_pct, sort_order
      ) VALUES (
        v_sess.id, v_sess.company_id, v_product.id, v_product.listing_id,
        COALESCE(v_product.current_quantity, 0), v_tol, v_sort
      );
      v_sort := v_sort + 1;
      v_count := v_count + 1;
    END LOOP;
    IF v_count = 0 THEN
      RETURN json_build_object('ok', false, 'error', 'no_products');
    END IF;
    RETURN json_build_object('ok', true, 'seeded', true, 'count', v_count);
  END IF;

  IF v_listing_id IS NOT NULL THEN
    FOR v_product IN
      SELECT p.id, p.current_quantity
      FROM public.inventory_count_listing_products lp
      JOIN public.products p ON p.id = lp.product_id
      WHERE lp.listing_id = v_listing_id
        AND p.company_id = v_sess.company_id
        AND (p.is_active IS NULL OR p.is_active = true)
      ORDER BY p.name
    LOOP
      INSERT INTO public.inventory_count_lines (
        session_id, company_id, product_id, listing_id, expected_qty, tolerance_pct, sort_order
      ) VALUES (
        v_sess.id, v_sess.company_id, v_product.id, v_listing_id,
        COALESCE(v_product.current_quantity, 0), v_tol, v_sort
      );
      v_sort := v_sort + 1;
      v_count := v_count + 1;
    END LOOP;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.inventory_count_listing_products lp
      JOIN public.inventory_count_listings l ON l.id = lp.listing_id
      JOIN public.products p ON p.id = lp.product_id
      WHERE l.company_id = v_sess.company_id
        AND (p.is_active IS NULL OR p.is_active = true)
    ) INTO v_has_listing_products;

    IF v_has_listing_products THEN
      RETURN json_build_object('ok', false, 'error', 'listing_required');
    END IF;

    FOR v_product IN
      SELECT p.id, p.current_quantity
      FROM public.products p
      WHERE p.company_id = v_sess.company_id
        AND (p.is_active IS NULL OR p.is_active = true)
      ORDER BY p.name
      LIMIT 500
    LOOP
      INSERT INTO public.inventory_count_lines (
        session_id, company_id, product_id, expected_qty, tolerance_pct, sort_order
      ) VALUES (
        v_sess.id, v_sess.company_id, v_product.id,
        COALESCE(v_product.current_quantity, 0), v_tol, v_sort
      );
      v_sort := v_sort + 1;
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN json_build_object('ok', true, 'seeded', true, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_inventory_count_lines(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Open session / round
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID);

CREATE FUNCTION public.open_inventory_count_session_internal(
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
    'listing_name', COALESCE(v_listing.name, CASE WHEN v_kind = 'onboarding' THEN 'Contagem geral' ELSE NULL END),
    'group_name', COALESCE(
      v_group_names,
      v_origin.name,
      v_listing.group_name,
      CASE WHEN v_kind = 'onboarding' THEN 'Onboarding' ELSE NULL END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID, UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID, UUID[], UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_inventory_count_session(
  p_company_id UUID,
  p_listing_id UUID DEFAULT NULL,
  p_kind TEXT DEFAULT 'regular',
  p_assigned_company_member_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  RETURN public.open_inventory_count_session_internal(
    p_company_id,
    p_listing_id,
    p_kind,
    p_assigned_company_member_id,
    auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_inventory_count_session(UUID, UUID, TEXT, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.open_inventory_count_round(
  p_company_id UUID,
  p_origin_group_id UUID,
  p_group_ids UUID[],
  p_assigned_company_member_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.company_id = p_company_id AND uc.user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_origin_group_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'group_required');
  END IF;

  RETURN public.open_inventory_count_session_internal(
    p_company_id,
    NULL,
    'regular',
    p_assigned_company_member_id,
    auth.uid(),
    COALESCE(p_group_ids, ARRAY[p_origin_group_id]),
    p_origin_group_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_inventory_count_round(UUID, UUID, UUID[], UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Public get / set / submit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inventory_count_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_company_name TEXT;
  v_products JSON;
  v_group_name TEXT;
  v_listing_name TEXT;
  v_assigned_name TEXT;
  v_group_id UUID;
  v_listing_id UUID;
  v_groups JSON;
  v_points JSON;
  v_seed JSON;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id,
         s.inventory_count_listing_id, s.validate_live, s.default_tolerance_pct,
         COALESCE(s.kind, 'regular') AS kind
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'closed');
  END IF;

  v_seed := public.seed_inventory_count_lines(v_sess.id);
  IF COALESCE(v_seed->>'ok', 'false') <> 'true' THEN
    RETURN json_build_object(
      'ok', false,
      'error', COALESCE(v_seed->>'error', 'seed_failed')
    );
  END IF;

  v_group_id := v_sess.inventory_count_group_id;
  v_listing_id := v_sess.inventory_count_listing_id;

  SELECT c.name INTO v_company_name
  FROM public.companies c
  WHERE c.id = v_sess.company_id;

  SELECT COALESCE(ig.name, ''), COALESCE(il.name, ''), COALESCE(am.name, '')
  INTO v_group_name, v_listing_name, v_assigned_name
  FROM public.inventory_count_sessions s
  LEFT JOIN public.inventory_count_groups ig ON ig.id = s.inventory_count_group_id
  LEFT JOIN public.inventory_count_listings il ON il.id = s.inventory_count_listing_id
  LEFT JOIN public.company_members am ON am.id = s.assigned_company_member_id
  WHERE s.id = v_sess.id;

  SELECT COALESCE(json_agg(
    json_build_object('id', g.id, 'name', g.name)
    ORDER BY g.sort_order, g.name
  ), '[]'::json)
  INTO v_groups
  FROM public.inventory_count_groups g
  WHERE g.company_id = v_sess.company_id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', p.id,
      'line_id', l.id,
      'name', p.name,
      'sku', p.sku,
      'unit', p.unit,
      'barcode', p.ean,
      'counted_qty', COALESCE(l.counted_qty_input, l.counted_qty),
      'counted_unit_code', COALESCE(l.counted_unit_code, p.unit),
      'allowed_units', public.inventory_count_public_allowed_units(p.unit, p.unit_conversions),
      'recount_required', l.recount_required,
      'sort_order', l.sort_order,
      'listing_id', l.listing_id,
      'listing_name', COALESCE(il.name, ''),
      'group_id', il.inventory_count_group_id,
      'group_name', COALESCE(ig.name, '')
    ) ORDER BY l.sort_order, p.name
  ), '[]'::json)
  INTO v_products
  FROM public.inventory_count_lines l
  JOIN public.products p ON p.id = l.product_id
  LEFT JOIN public.inventory_count_listings il ON il.id = l.listing_id
  LEFT JOIN public.inventory_count_groups ig ON ig.id = il.inventory_count_group_id
  WHERE l.session_id = v_sess.id;

  SELECT COALESCE(json_agg(point ORDER BY point->>'group_name', point->>'listing_name'), '[]'::json)
  INTO v_points
  FROM (
    SELECT json_build_object(
      'listing_id', l.listing_id,
      'listing_name', COALESCE(MAX(il.name), ''),
      'group_id', (array_agg(il.inventory_count_group_id))[1],
      'group_name', COALESCE(MAX(ig.name), ''),
      'total', COUNT(*)::INT,
      'counted', COUNT(*) FILTER (
        WHERE CASE
          WHEN v_sess.status = 'returned' THEN NOT COALESCE(l.recount_required, false) OR l.counted_qty IS NOT NULL
          ELSE l.counted_qty IS NOT NULL
        END
      )::INT
    ) AS point
    FROM public.inventory_count_lines l
    LEFT JOIN public.inventory_count_listings il ON il.id = l.listing_id
    LEFT JOIN public.inventory_count_groups ig ON ig.id = il.inventory_count_group_id
    WHERE l.session_id = v_sess.id
      AND l.listing_id IS NOT NULL
    GROUP BY l.listing_id
  ) pts;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_sess.id,
    'status', v_sess.status,
    'kind', v_sess.kind,
    'company_name', COALESCE(v_company_name, ''),
    'inventory_count_group_id', v_group_id,
    'inventory_count_listing_id', v_listing_id,
    'group_name', COALESCE(v_group_name, ''),
    'listing_name', COALESCE(v_listing_name, ''),
    'assigned_to_name', COALESCE(v_assigned_name, ''),
    'group_locked', (v_group_id IS NOT NULL OR v_sess.kind = 'onboarding'),
    'requires_group_selection', false,
    'needs_panel_group_setup', false,
    'groups', v_groups,
    'points', v_points,
    'validate_live', false,
    'products', v_products
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_public(UUID) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.set_inventory_count_line_public(UUID, UUID, NUMERIC, TEXT);

CREATE FUNCTION public.set_inventory_count_line_public(
  p_token UUID,
  p_product_id UUID,
  p_counted_qty NUMERIC,
  p_counted_unit_code TEXT DEFAULT NULL,
  p_line_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_line RECORD;
  v_product RECORD;
  v_hub_qty NUMERIC;
  v_unit TEXT;
  v_in_band BOOLEAN;
  v_match_count INT;
BEGIN
  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_qty');
  END IF;

  SELECT s.id, s.company_id, s.status, s.validate_live
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'closed');
  END IF;

  IF p_line_id IS NOT NULL THEN
    SELECT l.* INTO v_line
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id AND l.id = p_line_id
    FOR UPDATE;
  ELSE
    SELECT COUNT(*)::INT INTO v_match_count
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id AND l.product_id = p_product_id;
    IF v_match_count > 1 THEN
      RETURN json_build_object('ok', false, 'error', 'line_required');
    END IF;
    SELECT l.* INTO v_line
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id AND l.product_id = p_product_id
    FOR UPDATE;
  END IF;

  IF v_line.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'line_not_found');
  END IF;

  IF v_sess.status = 'returned' AND NOT COALESCE(v_line.recount_required, false) THEN
    RETURN json_build_object('ok', false, 'error', 'not_returned_item');
  END IF;

  SELECT p.unit, p.unit_conversions INTO v_product
  FROM public.products p
  WHERE p.id = v_line.product_id AND p.company_id = v_sess.company_id;

  IF v_product.unit IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  v_unit := lower(trim(COALESCE(NULLIF(p_counted_unit_code, ''), v_product.unit)));
  v_hub_qty := public.inventory_count_qty_to_hub(
    p_counted_qty, v_unit, v_product.unit, v_product.unit_conversions
  );
  IF v_hub_qty IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_unit');
  END IF;

  v_in_band := public.inventory_count_qty_in_band(
    v_line.expected_qty, v_hub_qty, v_line.tolerance_pct
  );

  UPDATE public.inventory_count_lines
  SET
    counted_qty = v_hub_qty,
    counted_qty_input = p_counted_qty,
    counted_unit_code = v_unit,
    in_band = v_in_band,
    recount_required = false,
    updated_at = NOW()
  WHERE id = v_line.id;

  RETURN json_build_object(
    'ok', true,
    'counted_qty', v_hub_qty,
    'line_id', v_line.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_inventory_count_line_public(UUID, UUID, NUMERIC, TEXT, UUID)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_inventory_count_for_approval(
  p_token UUID,
  p_inventory_count_group_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_group_catalog_count INT;
  v_line_count INT;
  v_pending INT;
  v_pending_points JSON;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id,
         s.inventory_count_listing_id, s.validate_live,
         COALESCE(s.kind, 'regular') AS kind
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  IF v_sess.kind <> 'onboarding'
     AND v_sess.inventory_count_group_id IS NULL
     AND v_sess.inventory_count_listing_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory_count_session_groups sg
       WHERE sg.session_id = v_sess.id
     ) THEN
    SELECT COUNT(*)::INT INTO v_group_catalog_count
    FROM public.inventory_count_groups g
    WHERE g.company_id = v_sess.company_id;

    IF v_group_catalog_count > 0 THEN
      IF p_inventory_count_group_id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'group_required');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.inventory_count_groups g
        WHERE g.id = p_inventory_count_group_id AND g.company_id = v_sess.company_id
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_group');
      END IF;
      UPDATE public.inventory_count_sessions
      SET inventory_count_group_id = p_inventory_count_group_id
      WHERE id = v_sess.id;
    END IF;
  END IF;

  SELECT COUNT(*)::INT INTO v_line_count
  FROM public.inventory_count_lines l
  WHERE l.session_id = v_sess.id;

  IF v_line_count = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'incomplete', 'missing', 0);
  END IF;

  SELECT COUNT(*)::INT INTO v_pending
  FROM public.inventory_count_lines l
  WHERE l.session_id = v_sess.id
    AND l.counted_qty IS NULL;

  IF v_sess.status = 'returned' THEN
    SELECT COUNT(*)::INT INTO v_pending
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id
      AND l.recount_required
      AND l.counted_qty IS NULL;
  END IF;

  IF v_pending > 0 THEN
    SELECT COALESCE(json_agg(
      json_build_object(
        'listing_id', l.listing_id,
        'listing_name', COALESCE(il.name, ''),
        'group_name', COALESCE(ig.name, ''),
        'missing', COUNT(*)::INT
      )
    ), '[]'::json)
    INTO v_pending_points
    FROM public.inventory_count_lines l
    LEFT JOIN public.inventory_count_listings il ON il.id = l.listing_id
    LEFT JOIN public.inventory_count_groups ig ON ig.id = il.inventory_count_group_id
    WHERE l.session_id = v_sess.id
      AND l.counted_qty IS NULL
      AND (
        v_sess.status <> 'returned'
        OR COALESCE(l.recount_required, false)
      )
    GROUP BY l.listing_id, il.name, ig.name;

    RETURN json_build_object(
      'ok', false,
      'error', 'incomplete',
      'missing', v_pending,
      'pending_points', v_pending_points
    );
  END IF;

  UPDATE public.inventory_count_lines
  SET recount_required = false, returned_at = NULL, updated_at = NOW()
  WHERE session_id = v_sess.id AND recount_required;

  UPDATE public.inventory_count_sessions
  SET
    status = 'pending_approval',
    submitted_at = NOW(),
    returned_at = NULL
  WHERE id = v_sess.id;

  DELETE FROM public.inventory_count_short_links WHERE session_id = v_sess.id;

  RETURN json_build_object('ok', true, 'status', 'pending_approval');
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_inventory_count_for_approval(UUID, UUID)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Commit: soma por SKU; gate de todos os pontos ativos agrupados
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_inventory_count_session(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_agg RECORD;
  v_delta NUMERIC;
  v_missing INT;
  v_skipped INT := 0;
  v_adjusted INT := 0;
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

  FOR v_agg IN
    SELECT
      l.product_id,
      MAX(l.expected_qty) AS expected_qty,
      SUM(l.counted_qty) AS counted_qty
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id
    GROUP BY l.product_id
  LOOP
    v_missing := 0;
    IF COALESCE(v_sess.kind, 'regular') <> 'onboarding' THEN
      SELECT COUNT(*)::INT INTO v_missing
      FROM public.inventory_count_listing_products lp
      JOIN public.inventory_count_listings lst ON lst.id = lp.listing_id
      WHERE lp.product_id = v_agg.product_id
        AND lst.company_id = v_sess.company_id
        AND lst.archived_at IS NULL
        AND lst.inventory_count_group_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.inventory_count_lines sl
          WHERE sl.session_id = v_sess.id
            AND sl.product_id = v_agg.product_id
            AND sl.listing_id = lst.id
            AND sl.counted_qty IS NOT NULL
        );
    END IF;

    IF v_missing > 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_delta := COALESCE(v_agg.counted_qty, 0) - COALESCE(v_agg.expected_qty, 0);
    IF v_delta <> 0 THEN
      PERFORM public.adjust_product_stock(
        v_agg.product_id,
        v_delta,
        CASE WHEN v_delta >= 0 THEN 'in' ELSE 'out' END,
        'inventory_count',
        v_sess.id,
        NULL
      );
    END IF;
    UPDATE public.inventory_count_lines
    SET approved_at = NOW(), updated_at = NOW()
    WHERE session_id = v_sess.id AND product_id = v_agg.product_id;
    v_adjusted := v_adjusted + 1;
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

  RETURN json_build_object(
    'ok', true,
    'status', 'committed',
    'adjusted', v_adjusted,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_inventory_count_session(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Agenda: grupo abre uma rodada expandida
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_due_inventory_count_schedules()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sched RECORD;
  v_res JSON;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_sid UUID;
  v_next TIMESTAMPTZ;
  v_archived TIMESTAMPTZ;
  v_group_ids UUID[];
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
    ELSIF v_sched.inventory_count_group_id IS NOT NULL THEN
      v_group_ids := public.inventory_count_expand_group_ids(
        v_sched.company_id,
        v_sched.inventory_count_group_id
      );
      IF v_group_ids IS NULL OR cardinality(v_group_ids) = 0 THEN
        v_group_ids := ARRAY[v_sched.inventory_count_group_id];
      END IF;
      v_res := public.open_inventory_count_session_internal(
        v_sched.company_id,
        NULL,
        'regular',
        v_sched.assigned_company_member_id,
        NULL,
        v_group_ids,
        v_sched.inventory_count_group_id
      );
      IF COALESCE(v_res->>'ok', 'false') = 'true' THEN
        v_sid := (v_res->>'session_id')::uuid;
        v_ids := array_append(v_ids, v_sid);
      END IF;
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

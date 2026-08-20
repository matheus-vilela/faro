-- Sessão sem listagem não semeia o catálogo inteiro quando a empresa já
-- tem listagens com produtos. A página pública volta a expor listing_name.

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
BEGIN
  SELECT s.id, s.company_id, s.status, s.default_tolerance_pct,
         s.inventory_count_listing_id
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

  -- Já tem linhas: não reseeda (preserva counted)
  IF EXISTS (SELECT 1 FROM public.inventory_count_lines l WHERE l.session_id = v_sess.id) THEN
    SELECT COUNT(*)::INT INTO v_count
    FROM public.inventory_count_lines l WHERE l.session_id = v_sess.id;
    RETURN json_build_object('ok', true, 'seeded', false, 'count', v_count);
  END IF;

  v_tol := COALESCE(v_sess.default_tolerance_pct, 5);
  v_listing_id := v_sess.inventory_count_listing_id;

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
        session_id, company_id, product_id, expected_qty, tolerance_pct, sort_order
      ) VALUES (
        v_sess.id, v_sess.company_id, v_product.id,
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

GRANT EXECUTE ON FUNCTION public.seed_inventory_count_lines(UUID) TO authenticated;

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
  v_group_catalog_count INT;
  v_seed JSON;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id,
         s.inventory_count_listing_id, s.validate_live, s.default_tolerance_pct
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

  SELECT COUNT(*)::INT INTO v_group_catalog_count
  FROM public.inventory_count_groups g
  WHERE g.company_id = v_sess.company_id;

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
      'counted_qty', l.counted_qty,
      'in_band', l.in_band,
      'recount_required', l.recount_required,
      'sort_order', l.sort_order
    ) ORDER BY l.sort_order, p.name
  ), '[]'::json)
  INTO v_products
  FROM public.inventory_count_lines l
  JOIN public.products p ON p.id = l.product_id
  WHERE l.session_id = v_sess.id;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_sess.id,
    'status', v_sess.status,
    'company_name', COALESCE(v_company_name, ''),
    'inventory_count_group_id', v_group_id,
    'inventory_count_listing_id', v_listing_id,
    'group_name', COALESCE(v_group_name, ''),
    'listing_name', COALESCE(v_listing_name, ''),
    'assigned_to_name', COALESCE(v_assigned_name, ''),
    'group_locked', (v_group_id IS NOT NULL),
    'requires_group_selection', (v_group_id IS NULL AND v_group_catalog_count > 0),
    'needs_panel_group_setup', (v_group_id IS NULL AND v_group_catalog_count = 0),
    'groups', v_groups,
    'validate_live', v_sess.validate_live,
    'products', v_products
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_public(UUID) TO anon, authenticated;

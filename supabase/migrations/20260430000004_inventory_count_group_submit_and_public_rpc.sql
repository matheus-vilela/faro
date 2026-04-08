-- Contagem: grupo obrigatório na submissão quando existem grupos e a sessão ainda não tem;
-- RPC pública retorna lista de grupos e flags para o link.

DROP POLICY IF EXISTS "Company users read inventory short links" ON public.inventory_count_short_links;
CREATE POLICY "Company users read inventory short links"
  ON public.inventory_count_short_links FOR SELECT
  USING (
    session_id IN (
      SELECT s.id FROM public.inventory_count_sessions s
      WHERE s.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  );

DROP FUNCTION IF EXISTS public.submit_inventory_count_public(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.get_inventory_count_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_company_name TEXT;
  v_products JSON;
  v_group_name TEXT;
  v_assigned_name TEXT;
  v_group_id UUID;
  v_groups JSON;
  v_group_catalog_count INT;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'closed');
  END IF;

  v_group_id := v_sess.inventory_count_group_id;

  SELECT c.name INTO v_company_name
  FROM public.companies c
  WHERE c.id = v_sess.company_id;

  SELECT COALESCE(ig.name, ''), COALESCE(am.name, '')
  INTO v_group_name, v_assigned_name
  FROM public.inventory_count_sessions s
  LEFT JOIN public.inventory_count_groups ig ON ig.id = s.inventory_count_group_id
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
      'name', p.name,
      'sku', p.sku,
      'unit', p.unit,
      'current_quantity', p.current_quantity
    ) ORDER BY p.name
  ), '[]'::json)
  INTO v_products
  FROM (
    SELECT p.id, p.name, p.sku, p.unit, p.current_quantity
    FROM public.products p
    WHERE p.company_id = v_sess.company_id
      AND (p.is_active IS NULL OR p.is_active = true)
    ORDER BY p.name
    LIMIT 500
  ) p;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_sess.id,
    'company_name', COALESCE(v_company_name, ''),
    'inventory_count_group_id', v_group_id,
    'group_name', COALESCE(v_group_name, ''),
    'assigned_to_name', COALESCE(v_assigned_name, ''),
    'group_locked', (v_group_id IS NOT NULL),
    'requires_group_selection', (v_group_id IS NULL AND v_group_catalog_count > 0),
    'needs_panel_group_setup', (v_group_id IS NULL AND v_group_catalog_count = 0),
    'groups', v_groups,
    'products', v_products
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_inventory_count_public(
  p_token UUID,
  p_lines JSONB,
  p_inventory_count_group_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_line JSONB;
  v_pid UUID;
  v_counted DECIMAL;
  v_curr DECIMAL;
  v_delta DECIMAL;
  v_group_catalog_count INT;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_payload');
  END IF;

  IF v_sess.inventory_count_group_id IS NULL THEN
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

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_pid := (v_line->>'product_id')::uuid;
    v_counted := COALESCE((v_line->>'counted_qty')::decimal, 0);
    IF v_counted < 0 THEN
      RETURN json_build_object('ok', false, 'error', 'negative_qty');
    END IF;

    SELECT p.current_quantity INTO v_curr
    FROM public.products p
    WHERE p.id = v_pid AND p.company_id = v_sess.company_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_delta := v_counted - v_curr;
    IF v_delta <> 0 THEN
      PERFORM public.adjust_product_stock(
        v_pid,
        v_delta,
        CASE WHEN v_delta >= 0 THEN 'in' ELSE 'out' END,
        'inventory_count',
        v_sess.id,
        NULL
      );
    END IF;
  END LOOP;

  UPDATE public.inventory_count_sessions
  SET status = 'submitted', submitted_at = NOW()
  WHERE id = v_sess.id;

  DELETE FROM public.inventory_count_short_links WHERE session_id = v_sess.id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_inventory_count_public(UUID, JSONB, UUID) TO anon, authenticated;

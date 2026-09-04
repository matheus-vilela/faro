-- Contagem de estoque: alvo oculto no operador, UoM, agenda maleável, onboarding.

-- ---------------------------------------------------------------------------
-- Colunas: sessão, linhas, empresa
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_count_sessions
  ALTER COLUMN validate_live SET DEFAULT false;

COMMENT ON COLUMN public.inventory_count_sessions.validate_live IS
  'Default false: o submit não recusa fora da faixa; divergência só na aba Aprovar. Não vazar in_band ao operador.';

ALTER TABLE public.inventory_count_sessions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS operator_notified_at TIMESTAMPTZ;

ALTER TABLE public.inventory_count_sessions
  DROP CONSTRAINT IF EXISTS inventory_count_sessions_kind_check;

ALTER TABLE public.inventory_count_sessions
  ADD CONSTRAINT inventory_count_sessions_kind_check
  CHECK (kind IN ('regular', 'onboarding'));

COMMENT ON COLUMN public.inventory_count_sessions.kind IS
  'regular = listagem/grupo; onboarding = contagem geral obrigatória após match.';

ALTER TABLE public.inventory_count_lines
  ADD COLUMN IF NOT EXISTS counted_unit_code TEXT,
  ADD COLUMN IF NOT EXISTS counted_qty_input NUMERIC(14,4);

COMMENT ON COLUMN public.inventory_count_lines.counted_qty IS
  'Quantidade na unidade de estoque (hub) do produto.';
COMMENT ON COLUMN public.inventory_count_lines.counted_unit_code IS
  'Unidade em que o operador digitou (auditoria).';
COMMENT ON COLUMN public.inventory_count_lines.counted_qty_input IS
  'Quantidade digitada na counted_unit_code (auditoria).';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_stock_unlocked BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.companies.onboarding_stock_unlocked IS
  'False enquanto a contagem geral de onboarding não for aprovada. NF reais continuam movimentando current_quantity; o saldo operacional só é considerado validado após o commit dessa sessão.';

-- ---------------------------------------------------------------------------
-- Agenda maleável
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_count_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_count_group_id UUID REFERENCES public.inventory_count_groups(id) ON DELETE CASCADE,
  inventory_count_listing_id UUID REFERENCES public.inventory_count_listings(id) ON DELETE CASCADE,
  assigned_company_member_id UUID REFERENCES public.company_members(id) ON DELETE SET NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  recurrence_kind TEXT NOT NULL DEFAULT 'once'
    CHECK (recurrence_kind IN ('once', 'every_n_days', 'alt_weeks')),
  interval_days INTEGER CHECK (interval_days IS NULL OR interval_days >= 1),
  weekday INTEGER CHECK (weekday IS NULL OR (weekday >= 0 AND weekday <= 6)),
  active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_count_schedules_target CHECK (
    inventory_count_group_id IS NOT NULL
    OR inventory_count_listing_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_schedules_due
  ON public.inventory_count_schedules(next_run_at)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_inventory_count_schedules_company
  ON public.inventory_count_schedules(company_id, active, next_run_at);

ALTER TABLE public.inventory_count_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users manage inventory count schedules" ON public.inventory_count_schedules;
CREATE POLICY "Company users manage inventory count schedules"
  ON public.inventory_count_schedules FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_schedules TO authenticated;
GRANT ALL ON public.inventory_count_schedules TO service_role;

-- ---------------------------------------------------------------------------
-- Conversão UoM (hub = products.unit)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_count_system_unit_factor(
  p_from TEXT,
  p_to TEXT
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(COALESCE(p_from, ''))) = lower(trim(COALESCE(p_to, ''))) THEN 1::numeric
    WHEN lower(trim(p_from)) = 'mg' AND lower(trim(p_to)) = 'g' THEN 0.001
    WHEN lower(trim(p_from)) = 'mg' AND lower(trim(p_to)) = 'kg' THEN 0.000001
    WHEN lower(trim(p_from)) = 'g' AND lower(trim(p_to)) = 'mg' THEN 1000
    WHEN lower(trim(p_from)) = 'g' AND lower(trim(p_to)) = 'kg' THEN 0.001
    WHEN lower(trim(p_from)) = 'kg' AND lower(trim(p_to)) = 'mg' THEN 1000000
    WHEN lower(trim(p_from)) = 'kg' AND lower(trim(p_to)) = 'g' THEN 1000
    WHEN lower(trim(p_from)) = 'ml' AND lower(trim(p_to)) = 'l' THEN 0.001
    WHEN lower(trim(p_from)) = 'l' AND lower(trim(p_to)) = 'ml' THEN 1000
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_count_qty_to_hub(
  p_qty NUMERIC,
  p_from_unit TEXT,
  p_hub_unit TEXT,
  p_conversions JSONB
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_from TEXT := lower(trim(COALESCE(p_from_unit, '')));
  v_hub TEXT := lower(trim(COALESCE(p_hub_unit, '')));
  v_sys NUMERIC;
  v_pri NUMERIC;
  v_sec NUMERIC;
BEGIN
  IF p_qty IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_from = '' OR v_hub = '' OR v_from = v_hub THEN
    RETURN p_qty;
  END IF;

  v_sys := public.inventory_count_system_unit_factor(v_from, v_hub);
  IF v_sys IS NOT NULL THEN
    RETURN p_qty * v_sys;
  END IF;

  SELECT (elem->>'primary_qty')::numeric, (elem->>'secondary_qty')::numeric
  INTO v_pri, v_sec
  FROM jsonb_array_elements(COALESCE(p_conversions, '[]'::jsonb)) elem
  WHERE lower(trim(COALESCE(elem->>'primary_unit_code', ''))) = v_hub
    AND lower(trim(COALESCE(elem->>'secondary_unit_code', ''))) = v_from
  LIMIT 1;

  IF v_pri IS NOT NULL AND v_sec IS NOT NULL AND v_sec <> 0 THEN
    RETURN p_qty * (v_pri / v_sec);
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_count_format_qty_hint(p_qty NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(trim(trailing '.' from trim(trailing '0' from to_char(p_qty, 'FM999999990.9999'))), '');
$$;

CREATE OR REPLACE FUNCTION public.inventory_count_public_allowed_units(
  p_hub TEXT,
  p_conversions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_hub TEXT := lower(trim(COALESCE(p_hub, '')));
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_code TEXT;
  v_hint_qty NUMERIC;
  v_out JSONB := '[]'::jsonb;
  v_sys TEXT;
BEGIN
  IF v_hub = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_codes := array_append(v_codes, v_hub);

  FOR v_code IN
    SELECT DISTINCT lower(trim(elem->>'secondary_unit_code'))
    FROM jsonb_array_elements(COALESCE(p_conversions, '[]'::jsonb)) elem
    WHERE lower(trim(COALESCE(elem->>'primary_unit_code', ''))) = v_hub
      AND trim(COALESCE(elem->>'secondary_unit_code', '')) <> ''
  LOOP
    IF NOT v_code = ANY (v_codes) THEN
      v_codes := array_append(v_codes, v_code);
    END IF;
  END LOOP;

  FOREACH v_sys IN ARRAY ARRAY['mg','g','kg','ml','l']
  LOOP
    IF public.inventory_count_system_unit_factor(v_hub, v_sys) IS NOT NULL
       AND NOT v_sys = ANY (v_codes) THEN
      v_codes := array_append(v_codes, v_sys);
    END IF;
  END LOOP;

  FOREACH v_code IN ARRAY v_codes
  LOOP
    IF v_code = v_hub THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', v_code,
        'hint', NULL
      ));
    ELSE
      v_hint_qty := public.inventory_count_qty_to_hub(1, v_code, v_hub, p_conversions);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', v_code,
        'hint', CASE
          WHEN v_hint_qty IS NULL THEN NULL
          ELSE '1 ' || v_code || ' = ' || COALESCE(public.inventory_count_format_qty_hint(v_hint_qty), v_hint_qty::text) || ' ' || v_hub
        END
      ));
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Short link
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_inventory_count_short_link(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_slug TEXT;
  i INT;
BEGIN
  SELECT s.id, s.token, s.company_id
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.id = p_session_id;

  IF v_sess.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT l.slug INTO v_slug
  FROM public.inventory_count_short_links l
  WHERE l.session_id = p_session_id;

  IF v_slug IS NOT NULL THEN
    RETURN v_slug;
  END IF;

  FOR i IN 1..12 LOOP
    v_slug := substr(md5(p_session_id::text || clock_timestamp()::text || i::text), 1, 8);
    BEGIN
      INSERT INTO public.inventory_count_short_links (slug, session_id, token, company_id)
      VALUES (v_slug, v_sess.id, v_sess.token, v_sess.company_id);
      RETURN v_slug;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  SELECT l.slug INTO v_slug
  FROM public.inventory_count_short_links l
  WHERE l.session_id = p_session_id;
  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_inventory_count_short_link(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_inventory_count_short_link(UUID)
  TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Seed: onboarding ignora listing_required
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

GRANT EXECUTE ON FUNCTION public.seed_inventory_count_lines(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Abrir sessão (validate_live false)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_inventory_count_session_internal(
  p_company_id UUID,
  p_listing_id UUID,
  p_kind TEXT,
  p_assigned_company_member_id UUID,
  p_created_by_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing RECORD;
  v_sess_id UUID;
  v_token UUID;
  v_slug TEXT;
  v_seed JSON;
  v_kind TEXT := COALESCE(NULLIF(trim(p_kind), ''), 'regular');
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
    'group_name', COALESCE(v_listing.group_name, CASE WHEN v_kind = 'onboarding' THEN 'Onboarding' ELSE NULL END)
  );
END;
$$;

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

-- ---------------------------------------------------------------------------
-- RPC público: sem expected, sem in_band; unidades + hint
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
  v_group_catalog_count INT;
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
      'counted_qty', COALESCE(l.counted_qty_input, l.counted_qty),
      'counted_unit_code', COALESCE(l.counted_unit_code, p.unit),
      'allowed_units', public.inventory_count_public_allowed_units(p.unit, p.unit_conversions),
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
    'validate_live', false,
    'products', v_products
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_public(UUID) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.set_inventory_count_line_public(UUID, UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.set_inventory_count_line_public(
  p_token UUID,
  p_product_id UUID,
  p_counted_qty NUMERIC,
  p_counted_unit_code TEXT DEFAULT NULL
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

  SELECT l.* INTO v_line
  FROM public.inventory_count_lines l
  WHERE l.session_id = v_sess.id AND l.product_id = p_product_id
  FOR UPDATE;

  IF v_line.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'line_not_found');
  END IF;

  IF v_sess.status = 'returned' AND NOT COALESCE(v_line.recount_required, false) THEN
    RETURN json_build_object('ok', false, 'error', 'not_returned_item');
  END IF;

  SELECT p.unit, p.unit_conversions INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id AND p.company_id = v_sess.company_id;

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
    'counted_qty', v_hub_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_inventory_count_line_public(UUID, UUID, NUMERIC, TEXT)
  TO anon, authenticated;

-- Submit: NÃO recusa out_of_band
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
  v_pending INT;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id, s.validate_live,
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

  IF v_sess.kind <> 'onboarding' AND v_sess.inventory_count_group_id IS NULL THEN
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
    RETURN json_build_object('ok', false, 'error', 'incomplete', 'missing', v_pending);
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

  RETURN json_build_object('ok', true, 'status', 'committed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_inventory_count_session(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Onboarding: sessão geral
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_onboarding_inventory_count(p_company_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_open RECORD;
  v_res JSON;
BEGIN
  SELECT s.id INTO v_existing
  FROM public.inventory_count_sessions s
  WHERE s.company_id = p_company_id
    AND COALESCE(s.kind, 'regular') = 'onboarding'
    AND s.status = 'committed'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.companies
    SET onboarding_stock_unlocked = true
    WHERE id = p_company_id AND onboarding_stock_unlocked IS DISTINCT FROM true;
    RETURN json_build_object('ok', true, 'status', 'already_committed');
  END IF;

  SELECT s.id, s.token INTO v_open
  FROM public.inventory_count_sessions s
  WHERE s.company_id = p_company_id
    AND COALESCE(s.kind, 'regular') = 'onboarding'
    AND s.status IN ('open', 'returned', 'pending_approval')
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_open.id IS NOT NULL THEN
    UPDATE public.companies
    SET onboarding_stock_unlocked = false
    WHERE id = p_company_id AND onboarding_stock_unlocked IS DISTINCT FROM false;
    RETURN json_build_object('ok', true, 'status', 'pending', 'session_id', v_open.id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS NULL OR p.is_active = true)
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'no_products');
  END IF;

  UPDATE public.companies
  SET onboarding_stock_unlocked = false
  WHERE id = p_company_id;

  v_res := public.open_inventory_count_session_internal(
    p_company_id, NULL, 'onboarding', NULL, NULL
  );
  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_onboarding_inventory_count(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.companies_maybe_start_onboarding_inventory_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.onboarding_completed IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.onboarding_completed IS DISTINCT FROM TRUE) THEN
    PERFORM public.ensure_onboarding_inventory_count(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_start_onboarding_inventory_count ON public.companies;
CREATE TRIGGER tr_companies_start_onboarding_inventory_count
  AFTER INSERT OR UPDATE OF setup, onboarding_fiscal, onboarding_pdv, onboarding_completed
  ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.companies_maybe_start_onboarding_inventory_count();

-- ---------------------------------------------------------------------------
-- Processar agendas vencidas (remarcar NÃO cria sessão antecipada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_count_advance_schedule(
  p_kind TEXT,
  p_from TIMESTAMPTZ,
  p_interval_days INTEGER
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_next TIMESTAMPTZ := p_from;
  v_n INTEGER := GREATEST(COALESCE(p_interval_days, 1), 1);
BEGIN
  IF p_kind = 'once' THEN
    RETURN NULL;
  END IF;
  IF p_kind = 'every_n_days' THEN
    v_next := p_from + (v_n || ' days')::interval;
    WHILE v_next <= NOW() LOOP
      v_next := v_next + (v_n || ' days')::interval;
    END LOOP;
    RETURN v_next;
  END IF;
  v_next := p_from + interval '14 days';
  WHILE v_next <= NOW() LOOP
    v_next := v_next + interval '14 days';
  END LOOP;
  RETURN v_next;
END;
$$;

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

REVOKE ALL ON FUNCTION public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_inventory_count_session_internal(UUID, UUID, TEXT, UUID, UUID)
  TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('inventory_count_schedules_due');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'inventory_count_schedules_due',
    '*/15 * * * *',
    $cron$SELECT public.process_due_inventory_count_schedules();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível: process_due_inventory_count_schedules não foi agendado (%).', SQLERRM;
END $$;

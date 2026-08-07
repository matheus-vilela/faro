-- Contagem inteligente: linhas com snapshot, tolerância, aprovação e alvo oculto.

-- ---------------------------------------------------------------------------
-- Sessões: novos status + aprovador + modo de validação
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_count_sessions
  DROP CONSTRAINT IF EXISTS inventory_count_sessions_status_check;

ALTER TABLE public.inventory_count_sessions
  ADD COLUMN IF NOT EXISTS approver_company_member_id UUID
    REFERENCES public.company_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS validate_live BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_tolerance_pct NUMERIC(6,2) NOT NULL DEFAULT 5
    CHECK (default_tolerance_pct >= 0 AND default_tolerance_pct <= 100),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

-- Migrar submitted legado → committed (já ajustou estoque na hora)
UPDATE public.inventory_count_sessions
SET status = 'committed', committed_at = COALESCE(submitted_at, NOW())
WHERE status = 'submitted';

ALTER TABLE public.inventory_count_sessions
  ADD CONSTRAINT inventory_count_sessions_status_check
  CHECK (status IN (
    'open',
    'pending_approval',
    'returned',
    'approved',
    'committed'
  ));

COMMENT ON COLUMN public.inventory_count_sessions.validate_live IS
  'Se true, PWA sinaliza dentro/fora da faixa na hora (alvo oculto). Se false, só registra e concilia depois.';
COMMENT ON COLUMN public.inventory_count_sessions.default_tolerance_pct IS
  'Tolerância percentual padrão (±) para faixa do alvo oculto.';

-- ---------------------------------------------------------------------------
-- Linhas da contagem (snapshot esperado × contado)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  expected_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  counted_qty NUMERIC(14,4),
  tolerance_pct NUMERIC(6,2) NOT NULL DEFAULT 5,
  in_band BOOLEAN,
  recount_required BOOLEAN NOT NULL DEFAULT false,
  returned_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_count_lines_session_product UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_session
  ON public.inventory_count_lines(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_company
  ON public.inventory_count_lines(company_id);

ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users manage inventory count lines" ON public.inventory_count_lines;
CREATE POLICY "Company users manage inventory count lines"
  ON public.inventory_count_lines FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

-- Tolerância por chave de categoria (texto livre / label) na empresa
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS inventory_tolerance_by_category JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.companies.inventory_tolerance_by_category IS
  'Mapa { "bebidas": 5, "destilados": 12 } — % de tolerância por categoria de contagem.';

-- ---------------------------------------------------------------------------
-- Helper: faixa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_count_qty_in_band(
  p_expected NUMERIC,
  p_counted NUMERIC,
  p_tolerance_pct NUMERIC
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_counted IS NULL THEN NULL
    WHEN COALESCE(p_expected, 0) = 0 THEN ABS(COALESCE(p_counted, 0)) <= 0.0001
    ELSE ABS(p_counted - p_expected) <= (ABS(p_expected) * GREATEST(COALESCE(p_tolerance_pct, 0), 0) / 100.0)
  END;
$$;

-- ---------------------------------------------------------------------------
-- Seed linhas ao criar/abrir sessão (chamado pelo painel/WA via RPC)
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

-- ---------------------------------------------------------------------------
-- RPC público: NÃO vaza expected / current_quantity
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
  v_assigned_name TEXT;
  v_group_id UUID;
  v_groups JSON;
  v_group_catalog_count INT;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id,
         s.validate_live, s.default_tolerance_pct
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'closed');
  END IF;

  -- Garante linhas (idempotente)
  PERFORM public.seed_inventory_count_lines(v_sess.id);

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
    'group_name', COALESCE(v_group_name, ''),
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

-- ---------------------------------------------------------------------------
-- RPC público: setar quantidade de uma linha (alvo oculto)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_inventory_count_line_public(
  p_token UUID,
  p_product_id UUID,
  p_counted_qty NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_line RECORD;
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

  -- Em recontagem devolvida, só permite linhas com recount_required
  IF v_sess.status = 'returned' AND NOT COALESCE(v_line.recount_required, false) THEN
    RETURN json_build_object('ok', false, 'error', 'not_returned_item');
  END IF;

  v_in_band := public.inventory_count_qty_in_band(
    v_line.expected_qty, p_counted_qty, v_line.tolerance_pct
  );

  UPDATE public.inventory_count_lines
  SET
    counted_qty = p_counted_qty,
    in_band = v_in_band,
    recount_required = CASE
      WHEN v_sess.validate_live AND NOT v_in_band THEN true
      ELSE false
    END,
    updated_at = NOW()
  WHERE id = v_line.id;

  RETURN json_build_object(
    'ok', true,
    'in_band', CASE WHEN v_sess.validate_live THEN v_in_band ELSE NULL END,
    'recount_required', CASE
      WHEN v_sess.validate_live AND NOT v_in_band THEN true
      ELSE false
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_inventory_count_line_public(UUID, UUID, NUMERIC)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enviar para aprovação (NÃO ajusta estoque)
-- ---------------------------------------------------------------------------
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
  v_out_of_band INT;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id, s.validate_live
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

  SELECT COUNT(*)::INT INTO v_pending
  FROM public.inventory_count_lines l
  WHERE l.session_id = v_sess.id
    AND (
      l.counted_qty IS NULL
      OR (v_sess.status = 'returned' AND l.recount_required AND l.counted_qty IS NULL)
    );

  -- Em returned, só exige linhas devolvidas
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

  IF v_sess.validate_live THEN
    SELECT COUNT(*)::INT INTO v_out_of_band
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id
      AND COALESCE(l.in_band, false) = false
      AND (v_sess.status <> 'returned' OR l.recount_required);
    IF v_out_of_band > 0 THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'out_of_band',
        'count', v_out_of_band
      );
    END IF;
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

-- Mantém submit legado apontando para o novo fluxo (compat)
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
  v_res JSON;
BEGIN
  SELECT s.id, s.status INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  PERFORM public.seed_inventory_count_lines(v_sess.id);

  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) = 'array' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_pid := (v_line->>'product_id')::uuid;
      v_counted := COALESCE((v_line->>'counted_qty')::decimal, 0);
      PERFORM public.set_inventory_count_line_public(p_token, v_pid, v_counted);
    END LOOP;
  END IF;

  v_res := public.submit_inventory_count_for_approval(p_token, p_inventory_count_group_id);
  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_inventory_count_public(UUID, JSONB, UUID)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gestor: devolver itens (reabre sessão returned)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_inventory_count_lines(
  p_session_id UUID,
  p_product_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_token UUID;
  v_slug TEXT;
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

  IF v_sess.status NOT IN ('pending_approval', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_products');
  END IF;

  UPDATE public.inventory_count_lines
  SET
    recount_required = true,
    returned_at = NOW(),
    counted_qty = NULL,
    in_band = NULL,
    updated_at = NOW()
  WHERE session_id = v_sess.id
    AND product_id = ANY(p_product_ids);

  UPDATE public.inventory_count_sessions
  SET status = 'returned', returned_at = NOW()
  WHERE id = v_sess.id;

  v_token := v_sess.token;

  -- Recria short link se não existir
  SELECT slug INTO v_slug
  FROM public.inventory_count_short_links
  WHERE session_id = v_sess.id;

  IF v_slug IS NULL THEN
    v_slug := substr(md5(v_sess.id::text || clock_timestamp()::text), 1, 8);
    INSERT INTO public.inventory_count_short_links (slug, session_id, token, company_id)
    VALUES (v_slug, v_sess.id, v_token, v_sess.company_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'status', 'returned',
    'token', v_token,
    'slug', v_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_inventory_count_lines(UUID, UUID[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Gestor: aprovar e commitar estoque
-- ---------------------------------------------------------------------------
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

  DELETE FROM public.inventory_count_short_links WHERE session_id = v_sess.id;

  RETURN json_build_object('ok', true, 'status', 'committed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_inventory_count_session(UUID) TO authenticated;

-- Short slug resolve: open OU returned
CREATE OR REPLACE FUNCTION public.get_inventory_count_token_by_short_slug(p_slug text)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.token
  FROM public.inventory_count_short_links l
  INNER JOIN public.inventory_count_sessions s ON s.id = l.session_id
  WHERE l.slug = p_slug
    AND s.status IN ('open', 'returned')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_token_by_short_slug(text)
  TO anon, authenticated;

-- Contagem de estoque por listagens (subdivisão do grupo).
-- Cada sessão passa a poder apontar para uma listagem específica.

CREATE TABLE IF NOT EXISTS public.inventory_count_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_count_group_id UUID NOT NULL REFERENCES public.inventory_count_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  assigned_company_member_id UUID REFERENCES public.company_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_count_listings_name_not_empty CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_listings_company_group
  ON public.inventory_count_listings(company_id, inventory_count_group_id, sort_order, name);

CREATE TABLE IF NOT EXISTS public.inventory_count_listing_products (
  listing_id UUID NOT NULL REFERENCES public.inventory_count_listings(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_listing_products_product
  ON public.inventory_count_listing_products(product_id);

ALTER TABLE public.inventory_count_sessions
  ADD COLUMN IF NOT EXISTS inventory_count_listing_id UUID
    REFERENCES public.inventory_count_listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_listing
  ON public.inventory_count_sessions(inventory_count_listing_id)
  WHERE inventory_count_listing_id IS NOT NULL;

COMMENT ON TABLE public.inventory_count_listings IS
  'Listagens de contagem por grupo (cada uma com operador e produtos próprios).';
COMMENT ON TABLE public.inventory_count_listing_products IS
  'Produtos incluídos em cada listagem de contagem.';
COMMENT ON COLUMN public.inventory_count_sessions.inventory_count_listing_id IS
  'Listagem vinculada à sessão de contagem (quando aplicável).';

ALTER TABLE public.inventory_count_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_listing_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users read inventory count listings" ON public.inventory_count_listings;
CREATE POLICY "Company users read inventory count listings"
  ON public.inventory_count_listings FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Company users manage inventory count listings" ON public.inventory_count_listings;
CREATE POLICY "Company users manage inventory count listings"
  ON public.inventory_count_listings FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Company users read inventory count listing products" ON public.inventory_count_listing_products;
CREATE POLICY "Company users read inventory count listing products"
  ON public.inventory_count_listing_products FOR SELECT
  USING (
    listing_id IN (
      SELECT l.id
      FROM public.inventory_count_listings l
      WHERE l.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Company users manage inventory count listing products" ON public.inventory_count_listing_products;
CREATE POLICY "Company users manage inventory count listing products"
  ON public.inventory_count_listing_products FOR ALL
  USING (
    listing_id IN (
      SELECT l.id
      FROM public.inventory_count_listings l
      WHERE l.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    listing_id IN (
      SELECT l.id
      FROM public.inventory_count_listings l
      WHERE l.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  );

GRANT ALL ON public.inventory_count_listings TO authenticated;
GRANT ALL ON public.inventory_count_listings TO service_role;
GRANT ALL ON public.inventory_count_listing_products TO authenticated;
GRANT ALL ON public.inventory_count_listing_products TO service_role;

-- Cria uma listagem inicial para grupos existentes que ainda não têm listagens.
INSERT INTO public.inventory_count_listings (
  company_id,
  inventory_count_group_id,
  name,
  sort_order,
  assigned_company_member_id
)
SELECT
  g.company_id,
  g.id,
  'Lista principal',
  0,
  NULL
FROM public.inventory_count_groups g
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_count_listings l
  WHERE l.inventory_count_group_id = g.id
);

-- Vincula todos os produtos ativos da empresa à listagem inicial criada (somente para listagens vazias).
INSERT INTO public.inventory_count_listing_products (listing_id, product_id)
SELECT
  l.id,
  p.id
FROM public.inventory_count_listings l
JOIN public.products p
  ON p.company_id = l.company_id
 AND (p.is_active IS NULL OR p.is_active = true)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_count_listing_products lp
  WHERE lp.listing_id = l.id
);

-- Retrocompatibilidade: sessões antigas com grupo passam a apontar para a primeira listagem do grupo.
UPDATE public.inventory_count_sessions s
SET inventory_count_listing_id = x.listing_id
FROM (
  SELECT DISTINCT ON (l.inventory_count_group_id)
    l.inventory_count_group_id,
    l.id AS listing_id
  FROM public.inventory_count_listings l
  ORDER BY l.inventory_count_group_id, l.sort_order, l.created_at, l.id
) x
WHERE s.inventory_count_listing_id IS NULL
  AND s.inventory_count_group_id = x.inventory_count_group_id;

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
  v_listing_name TEXT;
  v_assigned_name TEXT;
BEGIN
  SELECT
    s.id,
    s.company_id,
    s.status,
    s.inventory_count_group_id,
    s.inventory_count_listing_id,
    s.assigned_company_member_id
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'closed');
  END IF;

  SELECT c.name INTO v_company_name
  FROM public.companies c
  WHERE c.id = v_sess.company_id;

  SELECT
    COALESCE(g.name, ''),
    COALESCE(l.name, ''),
    COALESCE(am.name, '')
  INTO v_group_name, v_listing_name, v_assigned_name
  FROM public.inventory_count_sessions s
  LEFT JOIN public.inventory_count_groups g ON g.id = s.inventory_count_group_id
  LEFT JOIN public.inventory_count_listings l ON l.id = s.inventory_count_listing_id
  LEFT JOIN public.company_members am ON am.id = COALESCE(l.assigned_company_member_id, s.assigned_company_member_id)
  WHERE s.id = v_sess.id;

  IF v_sess.inventory_count_listing_id IS NOT NULL THEN
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
      FROM public.inventory_count_listing_products lp
      INNER JOIN public.products p ON p.id = lp.product_id
      WHERE lp.listing_id = v_sess.inventory_count_listing_id
        AND p.company_id = v_sess.company_id
        AND (p.is_active IS NULL OR p.is_active = true)
      ORDER BY p.name
      LIMIT 500
    ) p;
  ELSE
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
  END IF;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_sess.id,
    'company_name', COALESCE(v_company_name, ''),
    'group_name', COALESCE(v_group_name, ''),
    'listing_name', COALESCE(v_listing_name, ''),
    'assigned_to_name', COALESCE(v_assigned_name, ''),
    'inventory_count_group_id', v_sess.inventory_count_group_id,
    'inventory_count_listing_id', v_sess.inventory_count_listing_id,
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
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_listing_id
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

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_pid := (v_line->>'product_id')::uuid;
    v_counted := COALESCE((v_line->>'counted_qty')::decimal, 0);
    IF v_counted < 0 THEN
      RETURN json_build_object('ok', false, 'error', 'negative_qty');
    END IF;

    IF v_sess.inventory_count_listing_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.inventory_count_listing_products lp
      WHERE lp.listing_id = v_sess.inventory_count_listing_id
        AND lp.product_id = v_pid
    ) THEN
      CONTINUE;
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

GRANT EXECUTE ON FUNCTION public.get_inventory_count_public(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_inventory_count_public(UUID, JSONB, UUID) TO anon, authenticated;

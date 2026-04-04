-- Estoque avançado: CMV (custo médio), contagem pública (WhatsApp), perdas, receitas, compras, movimentos com custo.

-- 1) Produtos: CMV médio e código de barras (etiquetas)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS average_cost DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS barcode TEXT;

COMMENT ON COLUMN public.products.average_cost IS 'Custo médio ponderado (CMV) por unidade de estoque';
COMMENT ON COLUMN public.products.barcode IS 'Código numérico para etiqueta (EAN/Code128); opcional';

-- 2) Movimentos: custo unitário no momento da movimentação
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12, 4);

COMMENT ON COLUMN public.stock_movements.unit_cost IS 'Custo unitário de referência (entrada: NF; saída: CMV médio)';

-- 3) Ajuste de estoque com CMV ponderado
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id UUID,
  p_delta DECIMAL,
  p_type TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_unit_value DECIMAL DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_qty DECIMAL;
  v_old_avg DECIMAL;
  v_last_val DECIMAL;
  v_new_qty DECIMAL;
  v_new_avg DECIMAL;
  v_base_avg DECIMAL;
  v_mov_cost DECIMAL;
BEGIN
  SELECT p.current_quantity, p.average_cost, p.last_unit_value
  INTO v_old_qty, v_old_avg, v_last_val
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  v_base_avg := COALESCE(v_old_avg, v_last_val, 0);
  v_new_qty := GREATEST(0, v_old_qty + p_delta);

  IF p_delta > 0 AND p_unit_value IS NOT NULL THEN
    IF v_new_qty <= 0 THEN
      v_new_avg := v_old_avg;
    ELSIF v_old_qty <= 0 THEN
      v_new_avg := p_unit_value;
    ELSE
      v_new_avg := (v_old_qty * v_base_avg + p_delta * p_unit_value) / v_new_qty;
    END IF;
  ELSE
    v_new_avg := v_old_avg;
  END IF;

  v_mov_cost := CASE
    WHEN p_delta >= 0 THEN p_unit_value
    ELSE NULLIF(v_base_avg, 0)
  END;

  UPDATE public.products SET
    current_quantity = v_new_qty,
    last_unit_value = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value
    END,
    average_cost = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN v_new_avg
      ELSE average_cost
    END,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id, quantity, type, reference_type, reference_id, unit_cost
  )
  VALUES (
    p_product_id,
    ABS(p_delta),
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id,
    v_mov_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) TO anon, authenticated;

-- 4) Sessões de contagem de inventário (link público)
CREATE TABLE IF NOT EXISTS public.inventory_count_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  company_member_id UUID REFERENCES public.company_members(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_company
  ON public.inventory_count_sessions(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_count_short_links (
  slug TEXT PRIMARY KEY NOT NULL,
  session_id UUID NOT NULL UNIQUE REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE,
  token UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_short_links_session
  ON public.inventory_count_short_links(session_id);

COMMENT ON TABLE public.inventory_count_sessions IS 'Contagem de estoque via link público; invalidada ao submeter.';
COMMENT ON TABLE public.inventory_count_short_links IS 'Slug curto /i/:slug → token da sessão aberta.';

ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users see inventory sessions"
  ON public.inventory_count_sessions FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Company users manage inventory sessions"
  ON public.inventory_count_sessions FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "inventory_short_links_insert_company"
  ON public.inventory_count_short_links FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM public.inventory_count_sessions s
      WHERE s.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  );

-- 5) Desperdício
CREATE TABLE IF NOT EXISTS public.product_waste (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity DECIMAL(12, 4) NOT NULL CHECK (quantity > 0),
  reason TEXT,
  company_member_id UUID REFERENCES public.company_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_waste_company ON public.product_waste(company_id, created_at DESC);

ALTER TABLE public.product_waste ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users manage waste"
  ON public.product_waste FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

-- 6) Receitas (fichas técnicas) e ingredientes
CREATE TABLE IF NOT EXISTS public.recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  output_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  batch_yield DECIMAL(12, 4) NOT NULL DEFAULT 1 CHECK (batch_yield > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity DECIMAL(12, 4) NOT NULL CHECK (quantity > 0),
  UNIQUE (recipe_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_recipes_company ON public.recipes(company_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON public.recipe_ingredients(recipe_id);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users manage recipes"
  ON public.recipes FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Company users manage recipe ingredients"
  ON public.recipe_ingredients FOR ALL
  USING (
    recipe_id IN (SELECT id FROM public.recipes r WHERE r.company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    ))
  )
  WITH CHECK (
    recipe_id IN (SELECT id FROM public.recipes r WHERE r.company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    ))
  );

-- 7) Pedidos de compra (gestão simplificada)
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),
  expected_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity DECIMAL(12, 4) NOT NULL CHECK (quantity > 0),
  unit_value DECIMAL(12, 2),
  UNIQUE (order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON public.purchase_orders(company_id, created_at DESC);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users manage purchase orders"
  ON public.purchase_orders FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Company users manage purchase order items"
  ON public.purchase_order_items FOR ALL
  USING (
    order_id IN (SELECT id FROM public.purchase_orders po WHERE po.company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    ))
  )
  WITH CHECK (
    order_id IN (SELECT id FROM public.purchase_orders po WHERE po.company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    ))
  );

-- 8) RPC: slug → token (sessão aberta)
CREATE OR REPLACE FUNCTION public.get_inventory_count_token_by_short_slug(p_slug TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.token
  FROM public.inventory_count_short_links l
  INNER JOIN public.inventory_count_sessions s ON s.id = l.session_id
  WHERE l.slug = lower(trim(p_slug))
    AND s.status = 'open';
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_token_by_short_slug(TEXT) TO anon, authenticated;

-- 9) RPC: dados públicos da contagem
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
BEGIN
  SELECT s.id, s.company_id, s.status
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
    'products', v_products
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_count_public(UUID) TO anon, authenticated;

-- 10) RPC: submeter contagem (ajustes de estoque)
CREATE OR REPLACE FUNCTION public.submit_inventory_count_public(
  p_token UUID,
  p_lines JSONB
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
  SELECT s.id, s.company_id, s.status
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

GRANT EXECUTE ON FUNCTION public.submit_inventory_count_public(UUID, JSONB) TO anon, authenticated;

-- 11) RPC: baixa de estoque por receita (porções)
CREATE OR REPLACE FUNCTION public.consume_recipe_stock(
  p_recipe_id UUID,
  p_portions DECIMAL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_scale DECIMAL;
  v_ing RECORD;
  v_need DECIMAL;
BEGIN
  IF p_portions IS NULL OR p_portions <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_portions');
  END IF;

  SELECT r.id, r.company_id, r.batch_yield, r.active
  INTO v_rec
  FROM public.recipes r
  WHERE r.id = p_recipe_id;

  IF v_rec.id IS NULL OR v_rec.active IS NOT TRUE THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_rec.company_id NOT IN (
    SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_scale := p_portions / v_rec.batch_yield;

  FOR v_ing IN
    SELECT ri.product_id, ri.quantity
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = v_rec.id
  LOOP
    v_need := v_ing.quantity * v_scale;
    IF v_need > 0 THEN
      PERFORM public.adjust_product_stock(
        v_ing.product_id,
        -v_need,
        'out',
        'recipe',
        v_rec.id,
        NULL
      );
    END IF;
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_recipe_stock(UUID, DECIMAL) TO authenticated;

-- Inicializar CMV a partir do último preço conhecido (dados legados)
UPDATE public.products
SET average_cost = last_unit_value
WHERE average_cost IS NULL AND last_unit_value IS NOT NULL AND last_unit_value > 0;

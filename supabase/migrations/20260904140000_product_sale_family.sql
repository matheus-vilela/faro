-- Família de venda (item de cardápio) × variantes de estoque.
-- Não é ficha técnica: a venda da família não explode nem baixa nada.

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_control_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_stock_control_type_check
  CHECK (stock_control_type IN (
    'DIRECT',
    'RECIPE_CONTROLLED',
    'COMPOSITE',
    'SERVICE',
    'SALE_FAMILY'
  ));

COMMENT ON COLUMN public.products.stock_control_type IS
  'DIRECT = SKU de estoque; RECIPE_CONTROLLED = ficha (baixa insumos fixos); COMPOSITE = composto; SERVICE = sem estoque; SALE_FAMILY = item de cardápio (venda não baixa; variantes saem pelo estoque do dia).';

CREATE TABLE IF NOT EXISTS public.product_sale_family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  family_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty_per_sale NUMERIC(14, 4) NOT NULL DEFAULT 1 CHECK (qty_per_sale > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_product_id, variant_product_id),
  UNIQUE (variant_product_id),
  CHECK (family_product_id <> variant_product_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_family_members_company
  ON public.product_sale_family_members (company_id);
CREATE INDEX IF NOT EXISTS idx_sale_family_members_family
  ON public.product_sale_family_members (family_product_id);

COMMENT ON TABLE public.product_sale_family_members IS
  'Variantes de estoque ligadas a um item de cardápio (família de venda). qty_per_sale é só cadastro; não gera movimento.';

ALTER TABLE public.product_sale_family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage sale family members" ON public.product_sale_family_members;
CREATE POLICY "Users manage sale family members"
  ON public.product_sale_family_members FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin)
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin)
  );

GRANT ALL ON public.product_sale_family_members TO authenticated;
GRANT ALL ON public.product_sale_family_members TO service_role;

CREATE OR REPLACE FUNCTION public.product_is_sale_family(p_product_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.stock_control_type = 'SALE_FAMILY'
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_product_match_key(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT regexp_replace(
    lower(extensions.unaccent(trim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')))),
    '\s+',
    ' ',
    'g'
  );
$$;

CREATE OR REPLACE FUNCTION public.promote_product_to_sale_family(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET
    stock_control_type = 'SALE_FAMILY',
    listed_in_product_catalog = false,
    composes_cmv = false,
    updated_at = now()
  WHERE id = p_product_id
    AND stock_control_type IS DISTINCT FROM 'RECIPE_CONTROLLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.link_sale_family_variant(
  p_company_id UUID,
  p_family_product_id UUID,
  p_variant_name TEXT,
  p_variant_sku TEXT DEFAULT NULL,
  p_variant_unit TEXT DEFAULT 'un',
  p_qty_per_sale NUMERIC DEFAULT 1,
  p_variant_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_family RECORD;
  v_variant_id UUID;
  v_created BOOLEAN := false;
  v_promoted BOOLEAN := false;
  v_sku TEXT := nullif(btrim(coalesce(p_variant_sku, '')), '');
  v_name TEXT := nullif(btrim(coalesce(p_variant_name, '')), '');
  v_unit TEXT := coalesce(nullif(btrim(coalesce(p_variant_unit, '')), ''), 'un');
  v_qty NUMERIC := coalesce(p_qty_per_sale, 1);
  v_other UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;
  IF p_company_id IS NULL OR p_family_product_id IS NULL THEN
    RAISE EXCEPTION 'company_id e family_product_id sao obrigatorios';
  END IF;
  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nome da variante obrigatorio';
  END IF;
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Proporcao deve ser maior que zero';
  END IF;

  SELECT p.id, p.company_id, p.stock_control_type, p.name
  INTO v_family
  FROM public.products p
  WHERE p.id = p_family_product_id
  FOR UPDATE;

  IF v_family.id IS NULL OR v_family.company_id <> p_company_id THEN
    RAISE EXCEPTION 'Produto da familia nao encontrado';
  END IF;
  IF v_family.stock_control_type = 'RECIPE_CONTROLLED' THEN
    RAISE EXCEPTION 'Este produto e ficha tecnica. Familia de venda e outro cadastro.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_sale_family_members m
    WHERE m.variant_product_id = p_family_product_id
  ) THEN
    RAISE EXCEPTION 'Uma variante nao pode virar familia';
  END IF;

  IF v_family.stock_control_type IS DISTINCT FROM 'SALE_FAMILY' THEN
    PERFORM public.promote_product_to_sale_family(p_family_product_id);
    v_promoted := true;
  END IF;

  IF p_variant_product_id IS NOT NULL THEN
    v_variant_id := p_variant_product_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_variant_id AND p.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Variante informada nao encontrada';
    END IF;
  ELSE
    IF v_sku IS NOT NULL THEN
      SELECT p.id INTO v_variant_id
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND p.is_active IS NOT FALSE
        AND btrim(coalesce(p.sku, '')) = v_sku
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_variant_id IS NULL THEN
      SELECT p.id INTO v_variant_id
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND p.is_active IS NOT FALSE
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_variant_id IS NULL THEN
      INSERT INTO public.products (
        company_id, name, sku, unit, current_quantity, min_quantity,
        is_active, stock_control_type, listed_in_product_catalog, composes_cmv
      ) VALUES (
        p_company_id, left(upper(v_name), 512), v_sku, left(v_unit, 32),
        0, 0, true, 'DIRECT', true, true
      )
      RETURNING id INTO v_variant_id;
      v_created := true;
    END IF;
  END IF;

  IF v_variant_id = p_family_product_id THEN
    RAISE EXCEPTION 'A variante nao pode ser a propria familia';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_variant_id AND p.stock_control_type = 'SALE_FAMILY'
  ) THEN
    RAISE EXCEPTION 'Uma familia nao pode ser variante de outra';
  END IF;

  SELECT m.family_product_id INTO v_other
  FROM public.product_sale_family_members m
  WHERE m.variant_product_id = v_variant_id
    AND m.family_product_id <> p_family_product_id;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Esta variante ja pertence a outra familia de venda';
  END IF;

  INSERT INTO public.product_sale_family_members (
    company_id, family_product_id, variant_product_id, qty_per_sale
  ) VALUES (
    p_company_id, p_family_product_id, v_variant_id, v_qty
  )
  ON CONFLICT (family_product_id, variant_product_id)
  DO UPDATE SET qty_per_sale = excluded.qty_per_sale, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'family_product_id', p_family_product_id,
    'variant_product_id', v_variant_id,
    'created_variant', v_created,
    'promoted_family', v_promoted,
    'qty_per_sale', v_qty
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_sale_family_variant(
  p_company_id UUID,
  p_variant_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;
  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  DELETE FROM public.product_sale_family_members
  WHERE company_id = p_company_id
    AND variant_product_id = p_variant_product_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_sale_family_for_product(
  p_company_id UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_kind TEXT := 'none';
  v_family JSONB;
  v_members JSONB := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;
  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id
      AND p.company_id = p_company_id
      AND p.stock_control_type = 'SALE_FAMILY'
  ) THEN
    v_kind := 'family';
    SELECT jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku)
    INTO v_family
    FROM public.products p
    WHERE p.id = p_product_id;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'variant_product_id', vp.id,
      'name', vp.name,
      'sku', vp.sku,
      'qty_per_sale', m.qty_per_sale
    ) ORDER BY vp.name), '[]'::jsonb)
    INTO v_members
    FROM public.product_sale_family_members m
    JOIN public.products vp ON vp.id = m.variant_product_id
    WHERE m.family_product_id = p_product_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.product_sale_family_members m
    WHERE m.variant_product_id = p_product_id
      AND m.company_id = p_company_id
  ) THEN
    v_kind := 'variant';
    SELECT jsonb_build_object(
      'id', fp.id,
      'name', fp.name,
      'sku', fp.sku,
      'qty_per_sale', m.qty_per_sale,
      'variant_product_id', m.variant_product_id
    )
    INTO v_family
    FROM public.product_sale_family_members m
    JOIN public.products fp ON fp.id = m.family_product_id
    WHERE m.variant_product_id = p_product_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'family', v_family,
    'members', v_members
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_epoc_stock_variant_outs(
  p_company_id UUID,
  p_sale_date DATE,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item JSONB;
  v_sku TEXT;
  v_name TEXT;
  v_qty NUMERIC;
  v_product_id UUID;
  v_applied INTEGER := 0;
  v_skipped INTEGER := 0;
  v_already INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;
  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF p_sale_date IS NULL THEN
    RAISE EXCEPTION 'Data obrigatoria';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'items deve ser um array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_sku := nullif(btrim(coalesce(v_item->>'sku', '')), '');
    v_name := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_qty := NULLIF(v_item->>'qty', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_product_id := NULL;
    IF v_sku IS NOT NULL THEN
      SELECT p.id INTO v_product_id
      FROM public.products p
      JOIN public.product_sale_family_members m ON m.variant_product_id = p.id
      WHERE p.company_id = p_company_id
        AND btrim(coalesce(p.sku, '')) = v_sku
      LIMIT 1;
    END IF;
    IF v_product_id IS NULL AND v_name IS NOT NULL THEN
      SELECT p.id INTO v_product_id
      FROM public.products p
      JOIN public.product_sale_family_members m ON m.variant_product_id = p.id
      WHERE p.company_id = p_company_id
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.stock_movements sm
      WHERE sm.product_id = v_product_id
        AND sm.reference_type = 'epoc_stock_report'
        AND sm.type = 'out'
        AND coalesce(sm.metadata_json->>'sale_date', '') = p_sale_date::text
    ) THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    PERFORM public.adjust_product_stock(
      v_product_id,
      -v_qty,
      'out',
      'epoc_stock_report',
      NULL
    );

    UPDATE public.stock_movements
    SET metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'sale_date', p_sale_date::text,
      'source', 'epoc_rel_estoque'
    )
    WHERE id = (
      SELECT sm.id
      FROM public.stock_movements sm
      WHERE sm.product_id = v_product_id
        AND sm.reference_type = 'epoc_stock_report'
      ORDER BY sm.created_at DESC
      LIMIT 1
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'skipped', v_skipped,
    'already', v_already
  );
END;
$$;

REVOKE ALL ON FUNCTION public.product_is_sale_family(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_is_sale_family(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_product_match_key(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_product_to_sale_family(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_sale_family_variant(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_sale_family_variant(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_sale_family_for_product(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_epoc_stock_variant_outs(UUID, DATE, JSONB) TO authenticated, service_role;

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
  v_company_id UUID;
  v_product_unit TEXT;
  v_old_qty DECIMAL;
  v_old_avg DECIMAL;
  v_last_val DECIMAL;
  v_new_qty DECIMAL;
  v_new_avg DECIMAL;
  v_base_avg DECIMAL;
  v_mov_cost DECIMAL;
  v_metadata JSONB;
  v_sct TEXT;
BEGIN
  SELECT p.company_id, NULLIF(btrim(p.unit), ''), p.current_quantity, p.average_cost, p.last_unit_value, p.stock_control_type
  INTO v_company_id, v_product_unit, v_old_qty, v_old_avg, v_last_val, v_sct
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  -- Família de venda: a receita não mexe no estoque do item de cardápio.
  IF v_sct = 'SALE_FAMILY'
     AND coalesce(p_reference_type, '') IN ('revenue_entry', 'revenue_entry_update') THEN
    RETURN;
  END IF;

  v_base_avg := COALESCE(v_old_avg, v_last_val, 0);
  v_new_qty := v_old_qty + p_delta;

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

  v_metadata := jsonb_build_object(
    'quantity_unit', COALESCE(v_product_unit, 'un')
  );

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
    product_id,
    company_id,
    quantity,
    type,
    reference_type,
    reference_id,
    unit_cost,
    metadata_json
  )
  VALUES (
    p_product_id,
    v_company_id,
    ABS(p_delta),
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id,
    v_mov_cost,
    v_metadata
  );
END;
$$;

COMMENT ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) IS
  'Ajusta saldo e CMV. Família de venda ignora movimentos vindos de revenue_entry.';

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL)
  TO anon, authenticated, service_role;

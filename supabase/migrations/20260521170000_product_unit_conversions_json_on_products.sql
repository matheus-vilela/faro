-- Conversões de unidade passam a viver em products.unit_conversions (JSONB); remove tabela filha.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit_conversions JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.products.unit_conversions IS
  'Equivalências na unidade de estoque: [{primary_qty, primary_unit_code, secondary_qty, secondary_unit_code}, ...].';

-- Backfill a partir da tabela legada (se existir).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'product_unit_conversions'
  ) THEN
    UPDATE public.products p
    SET unit_conversions = COALESCE(src.rows, '[]'::jsonb)
    FROM (
      SELECT
        c.product_id,
        jsonb_agg(
          jsonb_build_object(
            'primary_qty', c.primary_qty,
            'primary_unit_code', lower(trim(c.primary_unit_code)),
            'secondary_qty', c.secondary_qty,
            'secondary_unit_code', lower(trim(c.secondary_unit_code))
          )
          ORDER BY lower(trim(c.secondary_unit_code))
        ) AS rows
      FROM public.product_unit_conversions c
      GROUP BY c.product_id
    ) src
    WHERE p.id = src.product_id
      AND (p.unit_conversions IS NULL OR p.unit_conversions = '[]'::jsonb);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_product_unit_conversion(
  p_product_id UUID,
  p_primary_qty NUMERIC,
  p_primary_unit_code TEXT,
  p_secondary_qty NUMERIC,
  p_secondary_unit_code TEXT
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  hu TEXT;
  sec TEXT;
  arr JSONB;
  filtered JSONB;
BEGIN
  sec := lower(trim(p_secondary_unit_code));
  IF sec IS NULL OR sec = '' OR p_primary_qty IS NULL OR p_primary_qty <= 0
     OR p_secondary_qty IS NULL OR p_secondary_qty <= 0 THEN
    RETURN;
  END IF;

  SELECT lower(trim(p.unit)) INTO hu
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF hu IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  IF lower(trim(coalesce(p_primary_unit_code, hu))) <> hu THEN
    RAISE EXCEPTION 'A unidade da conversão deve ser a unidade de estoque do produto';
  END IF;

  IF sec = hu THEN
    RAISE EXCEPTION 'A unidade secundária deve ser diferente da unidade de estoque';
  END IF;

  SELECT coalesce(p.unit_conversions, '[]'::jsonb) INTO arr
  FROM public.products p
  WHERE p.id = p_product_id;

  SELECT coalesce(jsonb_agg(elem ORDER BY elem->>'secondary_unit_code'), '[]'::jsonb)
  INTO filtered
  FROM jsonb_array_elements(arr) elem
  WHERE lower(trim(elem->>'secondary_unit_code')) <> sec;

  filtered := filtered || jsonb_build_array(
    jsonb_build_object(
      'primary_qty', p_primary_qty,
      'primary_unit_code', hu,
      'secondary_qty', p_secondary_qty,
      'secondary_unit_code', sec
    )
  );

  UPDATE public.products
  SET unit_conversions = filtered, updated_at = NOW()
  WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recipe_ingredient_qty_in_stock_unit(
  p_product_id uuid,
  p_quantity numeric,
  p_input_quantity numeric,
  p_input_unit_code text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  hu text;
  iu text;
  pq numeric;
  sq numeric;
  r numeric;
BEGIN
  SELECT lower(trim(p.unit)) INTO hu
  FROM public.products p
  WHERE p.id = p_product_id;

  IF hu IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_input_quantity IS NULL
     OR p_input_unit_code IS NULL
     OR btrim(p_input_unit_code) = '' THEN
    RETURN p_quantity;
  END IF;

  iu := lower(trim(p_input_unit_code));

  IF iu = hu THEN
    RETURN coalesce(p_quantity, p_input_quantity);
  END IF;

  SELECT (elem->>'primary_qty')::numeric, (elem->>'secondary_qty')::numeric
  INTO pq, sq
  FROM public.products p
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.unit_conversions, '[]'::jsonb)) elem
  WHERE p.id = p_product_id
    AND lower(trim(elem->>'primary_unit_code')) = hu
    AND lower(trim(elem->>'secondary_unit_code')) = iu
  LIMIT 1;

  IF FOUND AND sq IS NOT NULL AND sq <> 0 THEN
    RETURN p_input_quantity * (pq / sq);
  END IF;

  r := public.system_unit_ratio(iu, hu);
  IF r IS NOT NULL THEN
    RETURN p_input_quantity * r;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recipe_ingredient_qty_in_stock_unit(uuid, numeric, numeric, text) IS
  'Quantidade na unidade de estoque; usa products.unit_conversions e system_unit_ratio.';

COMMENT ON FUNCTION public.product_sale_qty_in_stock_unit(uuid, numeric, text) IS
  'Quantidade na unidade de estoque a partir da venda em outra unidade; usa products.unit_conversions.';

-- merge_onboarding_products: mescla unit_conversions JSON em vez da tabela removida.
CREATE OR REPLACE FUNCTION public.merge_onboarding_products(
  p_company_id UUID,
  p_winner_id UUID,
  p_loser_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_win_company UUID;
  v_lose_company UUID;
  v_qty_win NUMERIC;
  v_qty_lose NUMERIC;
  v_win_conv JSONB;
  v_lose_conv JSONB;
  v_merged JSONB;
BEGIN
  IF p_winner_id = p_loser_id THEN
    RETURN;
  END IF;

  SELECT company_id, current_quantity, coalesce(unit_conversions, '[]'::jsonb)
  INTO v_win_company, v_qty_win, v_win_conv
  FROM products WHERE id = p_winner_id FOR UPDATE;
  SELECT company_id, current_quantity, coalesce(unit_conversions, '[]'::jsonb)
  INTO v_lose_company, v_qty_lose, v_lose_conv
  FROM products WHERE id = p_loser_id FOR UPDATE;

  IF v_win_company IS NULL OR v_lose_company IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;
  IF v_win_company <> p_company_id OR v_lose_company <> p_company_id THEN
    RAISE EXCEPTION 'Produtos não pertencem à empresa informada';
  END IF;

  DELETE FROM public.product_operational_config
  WHERE company_id = p_company_id AND product_id = p_loser_id;

  DELETE FROM public.product_category_assignments WHERE product_id = p_loser_id;

  UPDATE public.product_import_equivalences SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  DELETE FROM public.product_unit_rules r
  WHERE r.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_unit_rules w
      WHERE w.company_id = r.company_id AND w.product_id = p_winner_id
        AND w.from_unit_normalized = r.from_unit_normalized
    );

  UPDATE public.product_unit_rules SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  DELETE FROM public.product_invoice_line_aliases l
  WHERE l.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_invoice_line_aliases w
      WHERE w.company_id = l.company_id AND w.product_id = p_winner_id
        AND w.normalized_label = l.normalized_label
    );

  UPDATE public.product_invoice_line_aliases SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.expense_items SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.stock_movements SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.revenue_entries SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.purchase_order_items SET product_id = p_winner_id WHERE product_id = p_loser_id;

  SELECT coalesce(
    (
      SELECT jsonb_agg(w.elem ORDER BY w.elem->>'secondary_unit_code')
      FROM (
        SELECT DISTINCT ON (lower(trim(elem->>'secondary_unit_code'))) elem
        FROM (
          SELECT elem FROM jsonb_array_elements(v_win_conv) elem
          UNION ALL
          SELECT elem FROM jsonb_array_elements(v_lose_conv) elem
        ) all_elems
        ORDER BY lower(trim(elem->>'secondary_unit_code')), elem
      ) w
    ),
    '[]'::jsonb
  ) INTO v_merged;

  UPDATE public.inventory_count_listings SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.import_item_resolution_rules SET target_product_id = p_winner_id WHERE target_product_id = p_loser_id;
  UPDATE public.import_recipe_draft_components SET product_id = p_winner_id WHERE product_id = p_loser_id;

  DELETE FROM public.recipe_ingredients ri
  WHERE ri.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.recipe_ingredients z
      WHERE z.recipe_id = ri.recipe_id AND z.product_id = p_winner_id
    );

  UPDATE public.recipe_ingredients SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.recipes SET output_product_id = p_winner_id WHERE output_product_id = p_loser_id;

  UPDATE public.products SET
    current_quantity = COALESCE(v_qty_win, 0) + COALESCE(v_qty_lose, 0),
    unit_conversions = v_merged,
    updated_at = NOW()
  WHERE id = p_winner_id;

  DELETE FROM public.products WHERE id = p_loser_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_product_unit_conversion(uuid, numeric, text, numeric, text)
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS tr_product_unit_conversions_codes_check ON public.product_unit_conversions;
DROP FUNCTION IF EXISTS public.enforce_product_unit_conversion_codes();
DROP POLICY IF EXISTS "Users can manage product unit conversions" ON public.product_unit_conversions;
DROP TABLE IF EXISTS public.product_unit_conversions;

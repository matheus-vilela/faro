-- Etapa 2: ligar vendas (product_sale) à ficha após existirem ingredientes.
-- Relaxa CHECK de recipe_sale (porções = quantity, pode ser > 1 em importações).

ALTER TABLE public.product_import_dashboard_review
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.product_import_dashboard_review.payload IS
  'Metadados da revisão; ex.: revenue_link=pending após conversão para ficha, até migrar revenue_entries.';

ALTER TABLE public.revenue_entries DROP CONSTRAINT IF EXISTS revenue_entries_sale_fields_check;

ALTER TABLE public.revenue_entries
  ADD CONSTRAINT revenue_entries_sale_fields_check CHECK (
    (entry_mode = 'manual' AND product_id IS NULL AND recipe_id IS NULL AND quantity IS NULL AND pricing_mode IS NULL)
    OR (
      entry_mode = 'product_sale'
      AND product_id IS NOT NULL
      AND recipe_id IS NULL
      AND quantity IS NOT NULL
      AND quantity > 0
      AND pricing_mode IS NOT NULL
    )
    OR (
      entry_mode = 'recipe_sale'
      AND recipe_id IS NOT NULL
      AND product_id IS NULL
      AND quantity IS NOT NULL
      AND quantity > 0
      AND pricing_mode IS NOT NULL
    )
  );

-- Passo 1 (substitui): grava payload para etapa 2 opcional.
CREATE OR REPLACE FUNCTION public.dashboard_import_review_confirm_outbound_as_recipe(
  p_company_id UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
  v_recipe_id UUID;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT p.name
  INTO v_name
  FROM public.products p
  WHERE p.id = p_product_id AND p.company_id = p_company_id
  FOR UPDATE;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.product_id = p_product_id
      AND sm.type = 'out'
      AND sm.reference_type = 'revenue_entry'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.product_id = p_product_id
      AND sm.type = 'in'
      AND sm.reference_type IN ('expense_item', 'import_breakdown')
  )
  INTO v_ok;

  IF v_ok IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'eligibility_failed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.company_id = p_company_id AND r.output_product_id = p_product_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_already_exists');
  END IF;

  INSERT INTO public.recipes (
    company_id,
    name,
    output_product_id,
    batch_yield,
    active,
    recipe_type
  )
  VALUES (
    p_company_id,
    left(trim(v_name) || ' — ficha técnica', 500),
    p_product_id,
    1,
    true,
    'PREP'
  )
  RETURNING id INTO v_recipe_id;

  UPDATE public.products
  SET
    stock_control_type = 'RECIPE_CONTROLLED',
    updated_at = now()
  WHERE id = p_product_id AND company_id = p_company_id;

  INSERT INTO public.product_import_dashboard_review (
    company_id,
    product_id,
    review_bucket,
    resolution,
    payload,
    resolved_at,
    resolved_by,
    updated_at
  )
  VALUES (
    p_company_id,
    p_product_id,
    'EXIT_NO_ENTRY',
    'CONVERTED_TO_TECH_SHEET',
    '{"revenue_link": "pending"}'::jsonb,
    now(),
    auth.uid(),
    now()
  )
  ON CONFLICT (company_id, product_id, review_bucket) DO UPDATE SET
    resolution = 'CONVERTED_TO_TECH_SHEET',
    payload = '{"revenue_link": "pending"}'::jsonb,
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'product_id', p_product_id,
    'revenue_link', 'pending'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

-- Lista etapa 2: conversão feita, ficha com ingredientes, vendas ainda em product_sale.
CREATE OR REPLACE FUNCTION public.dashboard_import_review_pending_revenue_link_list(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH base AS (
    SELECT
      p.id AS product_id,
      p.name,
      r.id AS recipe_id,
      (
        SELECT count(*)::integer
        FROM public.revenue_entries re
        WHERE re.company_id = p_company_id
          AND re.product_id = p.id
          AND re.entry_mode = 'product_sale'
          AND re.source = 'product_sale'
      ) AS pending_sales_count
    FROM public.product_import_dashboard_review pir
    JOIN public.products p ON p.id = pir.product_id AND p.company_id = pir.company_id
    JOIN public.recipes r
      ON r.company_id = pir.company_id
      AND r.output_product_id = p.id
    WHERE pir.company_id = p_company_id
      AND pir.review_bucket = 'EXIT_NO_ENTRY'
      AND pir.resolution = 'CONVERTED_TO_TECH_SHEET'
      AND pir.payload->>'revenue_link' = 'pending'
      AND EXISTS (SELECT 1 FROM public.recipe_ingredients ri WHERE ri.recipe_id = r.id)
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'recipe_id', x.recipe_id,
          'pending_sales_count', x.pending_sales_count
        )
        ORDER BY x.pending_sales_count DESC, x.name ASC
      )
      FROM (
        SELECT * FROM base
        WHERE pending_sales_count > 0
        ORDER BY pending_sales_count DESC, name ASC
        LIMIT 30
      ) x
    ),
    '[]'::jsonb
  )
  INTO v_out;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.dashboard_import_review_pending_revenue_link_list(UUID) IS
  'Dashboard etapa 2: produtos convertidos em ficha com ingredientes e vendas ainda em product_sale.';

-- Etapa 2 explícita: atualiza revenue_entries (sem retocar stock_movements já gravados).
CREATE OR REPLACE FUNCTION public.dashboard_import_review_finalize_recipe_product_sales(
  p_company_id UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe_id UUID;
  v_n INTEGER := 0;
  v_ing INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_import_dashboard_review pir
    WHERE pir.company_id = p_company_id
      AND pir.product_id = p_product_id
      AND pir.review_bucket = 'EXIT_NO_ENTRY'
      AND pir.resolution = 'CONVERTED_TO_TECH_SHEET'
      AND pir.payload->>'revenue_link' = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending_or_missing_review');
  END IF;

  SELECT r.id INTO v_recipe_id
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_product_id
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  SELECT count(*)::integer INTO v_ing
  FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = v_recipe_id;

  IF v_ing < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_needs_ingredients');
  END IF;

  UPDATE public.revenue_entries re
  SET
    entry_mode = 'recipe_sale',
    source = 'recipe_sale',
    recipe_id = v_recipe_id,
    product_id = NULL,
    updated_at = now()
  WHERE re.company_id = p_company_id
    AND re.product_id = p_product_id
    AND re.entry_mode = 'product_sale'
    AND re.source = 'product_sale';

  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.product_import_dashboard_review pir
  SET
    payload = coalesce(pir.payload, '{}'::jsonb) || jsonb_build_object(
      'revenue_link', 'done',
      'migrated_entries', v_n,
      'finalized_at', clock_timestamp()
    ),
    updated_at = now()
  WHERE pir.company_id = p_company_id
    AND pir.product_id = p_product_id
    AND pir.review_bucket = 'EXIT_NO_ENTRY';

  RETURN jsonb_build_object(
    'ok', true,
    'migrated_entries', v_n,
    'recipe_id', v_recipe_id,
    'product_id', p_product_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.dashboard_import_review_finalize_recipe_product_sales(UUID, UUID) IS
  'Etapa 2: migra lançamentos product_sale para recipe_sale (mesma quantity = porções). Não altera stock_movements.';

GRANT EXECUTE ON FUNCTION public.dashboard_import_review_pending_revenue_link_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_import_review_finalize_recipe_product_sales(UUID, UUID) TO authenticated;

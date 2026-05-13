-- Revisão pós-importação (XML / EPOC): filas no dashboard sem exclusões automáticas.

CREATE TABLE IF NOT EXISTS public.product_import_dashboard_review (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  review_bucket TEXT NOT NULL CHECK (review_bucket IN ('ENTRY_NO_EXIT', 'EXIT_NO_ENTRY')),
  resolution TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution IN (
    'OPEN',
    'DISMISSED',
    'LINK_RECIPE_STARTED',
    'CONVERTED_TO_TECH_SHEET'
  )),
  notes TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, product_id, review_bucket)
);

CREATE INDEX IF NOT EXISTS idx_pi_dash_rev_company_bucket
  ON public.product_import_dashboard_review (company_id, review_bucket);

COMMENT ON TABLE public.product_import_dashboard_review IS
  'Decisões do usuário na revisão pós-importação (dashboard). Não altera estoque; apenas oculta itens da fila ou registra fluxo explícito.';

ALTER TABLE public.product_import_dashboard_review ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_import_dashboard_review_company"
  ON public.product_import_dashboard_review FOR ALL
  USING (
    company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_import_dashboard_review TO authenticated;

-- ---------------------------------------------------------------------------
-- Lista: entrada (NF/compra) sem saída — típico pós-XML / recebimento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_import_review_entry_no_exit_list(p_company_id UUID)
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

  WITH reviewed AS (
    SELECT pir.product_id
    FROM public.product_import_dashboard_review pir
    WHERE pir.company_id = p_company_id
      AND pir.review_bucket = 'ENTRY_NO_EXIT'
      AND pir.resolution <> 'OPEN'
  ),
  cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.current_quantity::double precision AS current_quantity,
      (
        EXISTS (
          SELECT 1 FROM public.onboarding_import_item_raw o
          WHERE o.company_id = p_company_id AND o.created_product_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.expense_items ei
          JOIN public.expenses e ON e.id = ei.expense_id
          WHERE ei.product_id = p.id
            AND e.company_id = p_company_id
            AND (
              ei.import_engine_suggestion ILIKE '%XML%'
              OR ei.import_engine_suggestion = 'XML_CATALOG_MOTOR_APPLIED'
              OR ei.import_engine_suggestion = 'XML_CATALOG_MOTOR_PENDING'
            )
        )
      ) AS priority_import
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND (p.stock_control_type IS NULL OR p.stock_control_type IN ('DIRECT', 'COMPOSITE'))
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND sm.reference_type IN ('expense_item', 'import_breakdown')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'out'
      )
      AND NOT EXISTS (SELECT 1 FROM reviewed r WHERE r.product_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id AND r.output_product_id = p.id
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'current_quantity', x.current_quantity,
          'priority_import', x.priority_import
        )
        ORDER BY x.priority_import DESC NULLS LAST, x.name ASC
      )
      FROM (
        SELECT * FROM cand
        ORDER BY priority_import DESC NULLS LAST, name ASC
        LIMIT 40
      ) x
    ),
    '[]'::jsonb
  )
  INTO v_out;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.dashboard_import_review_entry_no_exit_list(UUID) IS
  'Dashboard: produtos com entrada de compra/import e sem saída; exclui já revisados e quem já tem receita de saída.';

-- ---------------------------------------------------------------------------
-- Lista: saída por receita (venda) sem entrada de compra — típico pós-EPOC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_import_review_exit_no_entry_list(p_company_id UUID)
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

  WITH reviewed AS (
    SELECT pir.product_id
    FROM public.product_import_dashboard_review pir
    WHERE pir.company_id = p_company_id
      AND pir.review_bucket = 'EXIT_NO_ENTRY'
      AND pir.resolution <> 'OPEN'
  ),
  cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.current_quantity::double precision AS current_quantity,
      EXISTS (
        SELECT 1 FROM public.revenue_entries re
        WHERE re.company_id = p_company_id
          AND re.product_id = p.id
          AND re.integration_csv_import_job_id IS NOT NULL
      ) AS priority_epoc
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND (p.stock_control_type IS NULL OR p.stock_control_type = 'DIRECT')
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'out'
          AND sm.reference_type = 'revenue_entry'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND sm.reference_type IN ('expense_item', 'import_breakdown')
      )
      AND NOT EXISTS (SELECT 1 FROM reviewed r WHERE r.product_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id AND r.output_product_id = p.id
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'current_quantity', x.current_quantity,
          'priority_epoc', x.priority_epoc
        )
        ORDER BY x.priority_epoc DESC NULLS LAST, x.name ASC
      )
      FROM (
        SELECT * FROM cand
        ORDER BY priority_epoc DESC NULLS LAST, name ASC
        LIMIT 40
      ) x
    ),
    '[]'::jsonb
  )
  INTO v_out;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.dashboard_import_review_exit_no_entry_list(UUID) IS
  'Dashboard: produtos com baixa por venda (revenue_entry) e sem entrada de compra; exclui revisados e quem já tem receita de saída.';

-- ---------------------------------------------------------------------------
-- Marca revisão (dispensar ou “abri ficha”) — sem alterar catálogo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_import_review_set_resolution(
  p_company_id UUID,
  p_product_id UUID,
  p_bucket TEXT,
  p_resolution TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF p_bucket NOT IN ('ENTRY_NO_EXIT', 'EXIT_NO_ENTRY') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_bucket');
  END IF;
  IF p_resolution NOT IN ('DISMISSED', 'LINK_RECIPE_STARTED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_resolution');
  END IF;

  INSERT INTO public.product_import_dashboard_review (
    company_id, product_id, review_bucket, resolution, resolved_at, resolved_by, updated_at
  )
  VALUES (
    p_company_id, p_product_id, p_bucket, p_resolution, now(), auth.uid(), now()
  )
  ON CONFLICT (company_id, product_id, review_bucket) DO UPDATE SET
    resolution = EXCLUDED.resolution,
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Confirmação explícita: criar ficha (receita PREP) + classificar produto.
-- Não apaga produto nem receitas; não altera movimentos já gravados.
-- ---------------------------------------------------------------------------
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
    company_id, product_id, review_bucket, resolution, resolved_at, resolved_by, updated_at
  )
  VALUES (
    p_company_id, p_product_id, 'EXIT_NO_ENTRY', 'CONVERTED_TO_TECH_SHEET', now(), auth.uid(), now()
  )
  ON CONFLICT (company_id, product_id, review_bucket) DO UPDATE SET
    resolution = 'CONVERTED_TO_TECH_SHEET',
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'product_id', p_product_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_import_review_entry_no_exit_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_import_review_exit_no_entry_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_import_review_set_resolution(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_import_review_confirm_outbound_as_recipe(UUID, UUID) TO authenticated;

-- Vendas (produto e ficha) podem baixar estoque mesmo com saldo insuficiente (saldo negativo permitido).

CREATE OR REPLACE FUNCTION public.consume_recipe_stock(
  p_recipe_id UUID,
  p_portions DECIMAL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
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
  v_per DECIMAL;
  v_need DECIMAL;
  v_ref_type TEXT;
  v_ref_id UUID;
  v_is_service_role BOOLEAN;
BEGIN
  IF p_portions IS NULL OR p_portions <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_portions');
  END IF;

  v_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

  SELECT r.id, r.company_id, r.batch_yield, r.active
  INTO v_rec
  FROM public.recipes r
  WHERE r.id = p_recipe_id;

  IF v_rec.id IS NULL OR v_rec.active IS NOT TRUE THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF auth.uid() IS NULL THEN
    IF NOT v_is_service_role THEN
      RETURN json_build_object('ok', false, 'error', 'not_authenticated');
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id = v_rec.company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_reference_id IS NOT NULL THEN
    v_ref_type := coalesce(nullif(btrim(p_reference_type), ''), 'revenue_entry');
    v_ref_id := p_reference_id;
  ELSE
    v_ref_type := 'recipe';
    v_ref_id := v_rec.id;
  END IF;

  v_scale := p_portions / v_rec.batch_yield;

  FOR v_ing IN
    SELECT ri.product_id, ri.quantity, ri.input_quantity, ri.input_unit_code
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = v_rec.id
    ORDER BY ri.id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id, v_ing.quantity, v_ing.input_quantity, v_ing.input_unit_code
    );
    IF v_per IS NULL THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'missing_conversion',
        'product_id', v_ing.product_id
      );
    END IF;
    v_need := v_per * v_scale;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    PERFORM public.adjust_product_stock(
      v_ing.product_id,
      -v_need,
      'out',
      v_ref_type,
      v_ref_id,
      NULL
    );
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.consume_recipe_stock(UUID, DECIMAL, TEXT, UUID) IS
  'Consome ingredientes da receita; permite estoque negativo (sem bloqueio por saldo insuficiente).';

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.create_revenue_entry(jsonb)'::regprocedure)
  INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Função public.create_revenue_entry(jsonb) não encontrada';
  END IF;

  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_csv_import_job_id IS NULL AND v_stock < v_stock_qty THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_csv_import_job_id IS NULL AND v_stock < v_quantity THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_stock_qty THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_quantity THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_csv_import_job_id IS NULL AND v_stock < v_need_r THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para produzir a receita'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_need_r THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para produzir a receita'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );

  EXECUTE v_def;

  SELECT pg_get_functiondef('public.update_revenue_entry(jsonb)'::regprocedure)
  INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Função public.update_revenue_entry(jsonb) não encontrada';
  END IF;

  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_stock_qty THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_quantity THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_need_r THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para produzir a receita'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );

  EXECUTE v_def;
END;
$$;

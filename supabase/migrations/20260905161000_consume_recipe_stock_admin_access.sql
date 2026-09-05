-- consume_recipe_stock (e RPCs irmãs) recusavam admin Faro:
-- ELSIF + company_id qualificado (v_rec.company_id) escaparam do patch
-- 20260802230000. Superadmin tem acesso a todas as unidades.

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
  ELSIF NOT public.user_has_company_access(auth.uid(), v_rec.company_id) THEN
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
  'Consome ingredientes da receita; permite estoque negativo. Acesso: membro, service_role ou admin Faro.';

GRANT EXECUTE ON FUNCTION public.consume_recipe_stock(UUID, DECIMAL, TEXT, UUID)
  TO authenticated, service_role;

-- Demais RPCs com o mesmo padrão (ELSIF / company_id qualificado).
DO $$
DECLARE
  r record;
  def text;
  new_def text;
  updated int := 0;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname NOT IN (
        'user_has_company_access',
        'is_platform_admin',
        'user_accessible_company_ids',
        'user_visible_company_group_ids',
        'consume_recipe_stock'
      )
      AND pg_get_functiondef(p.oid) ~* 'user_companies'
      AND pg_get_functiondef(p.oid) !~* 'user_has_company_access\s*\('
  LOOP
    def := pg_get_functiondef(r.oid);
    new_def := regexp_replace(
      def,
      '(IF|ELSIF)\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s*(?:\n\s*)?FROM\s+public\.user_companies\s+uc\s*(?:\n\s*)?WHERE\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s*(?:\n\s*)?AND\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)',
      '\1 NOT public.user_has_company_access(\2, \3)',
      'gi'
    );
    new_def := regexp_replace(
      new_def,
      '(IF|ELSIF)\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s*(?:\n\s*)?FROM\s+public\.user_companies\s+uc\s*(?:\n\s*)?WHERE\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\n\s*)?AND\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s*\)',
      '\1 NOT public.user_has_company_access(\3, \2)',
      'gi'
    );

    IF new_def IS DISTINCT FROM def THEN
      BEGIN
        EXECUTE new_def;
        updated := updated + 1;
        RAISE NOTICE 'admin access patched: public.%(%)', r.proname, r.args;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'falha ao patchar public.%(%): %', r.proname, r.args, SQLERRM;
      END;
    END IF;
  END LOOP;

  RAISE NOTICE 'consume_recipe_stock_admin_access: % funções extras atualizadas', updated;
END $$;

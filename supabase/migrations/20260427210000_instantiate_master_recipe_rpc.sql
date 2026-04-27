-- Instancia ficha técnica (tenant) a partir da chave mestre, com versionamento (não substitui linhas silenciosamente).

CREATE OR REPLACE FUNCTION public.instantiate_master_recipe_for_company(
  p_company_id UUID,
  p_output_product_id UUID,
  p_master_external_key TEXT,
  p_ingredients JSONB,
  p_supersede_recipe_id UUID DEFAULT NULL,
  p_recipe_display_name TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_master public.master_recipe_catalog%ROWTYPE;
  v_out_company UUID;
  v_new_id UUID;
  v_version INTEGER := 1;
  v_old_version INTEGER;
  v_old_company UUID;
  v_old_out UUID;
  el JSONB;
  v_pid UUID;
  v_qty NUMERIC;
  v_in_qty NUMERIC;
  v_in_unit TEXT;
  v_loss NUMERIC;
  v_sort INTEGER;
  line_no INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_master
  FROM public.master_recipe_catalog m
  WHERE m.external_key = p_master_external_key
    AND m.is_active IS true
  LIMIT 1;

  IF v_master.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'master_recipe_not_found');
  END IF;

  SELECT p.company_id INTO v_out_company
  FROM public.products p
  WHERE p.id = p_output_product_id;

  IF v_out_company IS NULL OR v_out_company <> p_company_id THEN
    RETURN json_build_object('ok', false, 'error', 'output_product_mismatch');
  END IF;

  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' OR jsonb_array_length(p_ingredients) < 1 THEN
    RETURN json_build_object('ok', false, 'error', 'ingredients_required');
  END IF;

  FOR el IN SELECT * FROM jsonb_array_elements(p_ingredients)
  LOOP
    line_no := line_no + 1;
    v_pid := NULLIF(trim(both FROM el->>'product_id'), '')::uuid;
    IF v_pid IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_product_id', 'line', line_no);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_pid AND p.company_id = p_company_id
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'ingredient_not_in_company', 'product_id', v_pid);
    END IF;
  END LOOP;

  IF p_supersede_recipe_id IS NOT NULL THEN
    SELECT r.version, r.company_id, r.output_product_id
    INTO v_old_version, v_old_company, v_old_out
    FROM public.recipes r
    WHERE r.id = p_supersede_recipe_id;

    IF v_old_company IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'supersede_recipe_not_found');
    END IF;
    IF v_old_company <> p_company_id THEN
      RETURN json_build_object('ok', false, 'error', 'supersede_company_mismatch');
    END IF;
    IF v_old_out IS DISTINCT FROM p_output_product_id THEN
      RETURN json_build_object('ok', false, 'error', 'supersede_output_mismatch');
    END IF;

    v_version := COALESCE(v_old_version, 1) + 1;
    UPDATE public.recipes
    SET active = false, updated_at = now()
    WHERE id = p_supersede_recipe_id AND company_id = p_company_id;
  END IF;

  INSERT INTO public.recipes (
    company_id, name, output_product_id, batch_yield, active,
    recipe_type, version, created_at, updated_at
  ) VALUES (
    p_company_id,
    COALESCE(NULLIF(trim(p_recipe_display_name), ''), v_master.canonical_name),
    p_output_product_id,
    v_master.default_yield_quantity,
    true,
    'ENTRY_BREAKDOWN',
    v_version,
    now(),
    now()
  )
  RETURNING id INTO v_new_id;

  line_no := 0;
  FOR el IN SELECT * FROM jsonb_array_elements(p_ingredients)
  LOOP
    line_no := line_no + 1;
    v_pid := NULLIF(trim(both FROM el->>'product_id'), '')::uuid;
    v_qty := COALESCE(NULLIF(trim(both FROM el->>'quantity'), '')::numeric, (el->>'quantity')::numeric);
    v_in_qty := COALESCE(NULLIF(trim(both FROM el->>'input_quantity'), '')::numeric, (el->>'input_quantity')::numeric, v_qty);
    v_in_unit := NULLIF(trim(both FROM el->>'input_unit_code'), '');
    v_loss := COALESCE(NULLIF(trim(both FROM el->>'loss_factor'), '')::numeric, (el->>'loss_factor')::numeric, 1::numeric);
    v_sort := COALESCE(NULLIF(trim(both FROM el->>'sort_order'), '')::int, (el->>'sort_order')::int, line_no);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_quantity', 'line', line_no);
    END IF;
    IF v_in_qty IS NULL OR v_in_qty <= 0 THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_input_quantity', 'line', line_no);
    END IF;
    IF v_in_unit IS NULL OR length(v_in_unit) = 0 THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_input_unit', 'line', line_no);
    END IF;
    IF v_loss IS NULL OR v_loss <= 0 THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_loss_factor', 'line', line_no);
    END IF;

    INSERT INTO public.recipe_ingredients (
      recipe_id, product_id, quantity, input_quantity, input_unit_code, loss_factor, sort_order
    ) VALUES (
      v_new_id, v_pid, v_qty, v_in_qty, lower(v_in_unit), v_loss, v_sort
    );
  END LOOP;

  INSERT INTO public.tenant_recipe_template_override (
    company_id, recipe_id, master_recipe_id, source_master_version, override_notes, active
  ) VALUES (
    p_company_id,
    v_new_id,
    v_master.id,
    v_master.version,
    'Instanciada a partir do catálogo mestre (onboarding / assistido).',
    true
  );

  RETURN json_build_object(
    'ok', true,
    'recipe_id', v_new_id,
    'version', v_version
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.instantiate_master_recipe_for_company(UUID, UUID, TEXT, JSONB, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instantiate_master_recipe_for_company(UUID, UUID, TEXT, JSONB, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.instantiate_master_recipe_for_company IS
  'Cria receita ENTRY_BREAKDOWN + ingredientes; opcionalmente desativa p_supersede (nova versão, sem UPDATE na linha antiga).';

-- Catálogo mestre: fichas adicionais (alinhado a web/src/lib/masterRecipeCatalog/seedRegistry.ts)

INSERT INTO public.master_recipe_catalog (
  external_key, canonical_name, normalized_name, recipe_type, family, subcategory,
  description, default_yield_quantity, default_yield_unit, default_portion_quantity, default_portion_unit,
  servings_count, prep_time_minutes, recipe_candidate_score, status, curation_status, origin, is_active, version
) VALUES
  (
    'mr-drink-mojito', 'Mojito', 'mojito', 'DRINK_RECIPE',
    'Drinks', 'Muddled', 'Rum, hortelã, limão, açúcar e soda.',
    1, 'un', 1, 'un', 1, 5, 0.91, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  ),
  (
    'mr-drink-moscow-mule', 'Moscow Mule', 'moscow mule', 'DRINK_RECIPE',
    'Drinks', 'Highball', 'Vodka, ginger beer e limão.',
    1, 'un', 1, 'un', 1, 4, 0.9, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  ),
  (
    'mr-prep-feijao-base', 'Feijão cozido base', 'feijao cozido base', 'PREP_RECIPE',
    'Cozinha', 'Grãos', 'Feijão pré-cozido para porções e montagem.',
    5, 'kg', 0.15, 'kg', 30, 120, 0.87, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  ),
  (
    'mr-prep-maionese-casa', 'Maionese da casa', 'maionese da casa', 'PREP_RECIPE',
    'Cozinha', 'Molhos', 'Emulsão básica de óleo e limão.',
    1, 'kg', 0.04, 'kg', 24, 20, 0.88, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  )
ON CONFLICT (external_key) DO NOTHING;


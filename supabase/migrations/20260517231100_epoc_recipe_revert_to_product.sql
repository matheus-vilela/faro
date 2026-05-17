-- Reclassificar ficha EPOC sem insumos como produto de venda (remove receita, DIRECT).

ALTER TABLE public.product_import_dashboard_review
  DROP CONSTRAINT IF EXISTS product_import_dashboard_review_resolution_check;

ALTER TABLE public.product_import_dashboard_review
  ADD CONSTRAINT product_import_dashboard_review_resolution_check
  CHECK (resolution IN (
    'OPEN',
    'DISMISSED',
    'LINK_RECIPE_STARTED',
    'CONVERTED_TO_TECH_SHEET',
    'CONVERTED_TO_PRODUCT'
  ));

CREATE OR REPLACE FUNCTION public.dashboard_import_review_epoc_recipe_revert_to_product(
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
  v_has_ingredients BOOLEAN;
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
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  SELECT r.id
  INTO v_recipe_id
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_product_id
    AND (r.active IS DISTINCT FROM false)
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri WHERE ri.recipe_id = v_recipe_id
  )
  INTO v_has_ingredients;

  IF v_has_ingredients THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_has_ingredients');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.revenue_entries re
    WHERE re.company_id = p_company_id
      AND re.recipe_id = v_recipe_id
      AND re.entry_mode = 'recipe_sale'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_sale_entries_exist');
  END IF;

  DELETE FROM public.recipes WHERE id = v_recipe_id;

  UPDATE public.products
  SET
    stock_control_type = 'DIRECT',
    updated_at = now()
  WHERE id = p_product_id AND company_id = p_company_id;

  UPDATE public.product_operational_config poc
  SET
    suggested_operational_type = 'PRODUTO_REVENDA',
    final_operational_type = 'PRODUTO_REVENDA',
    final_decision_source = 'USER_CONFIRMED',
    configuration_status = 'CONFIGURADO',
    linked_entry_breakdown_recipe_id = CASE
      WHEN poc.linked_entry_breakdown_recipe_id = v_recipe_id THEN NULL
      ELSE poc.linked_entry_breakdown_recipe_id
    END,
    suggestion_reasons = coalesce(poc.suggestion_reasons, '{}'::jsonb)
      || jsonb_build_object('epoc_reverted_from_recipe', true),
    updated_at = now()
  WHERE poc.company_id = p_company_id AND poc.product_id = p_product_id;

  INSERT INTO public.product_import_dashboard_review (
    company_id, product_id, review_bucket, resolution, resolved_at, resolved_by, updated_at,
    notes
  )
  VALUES (
    p_company_id,
    p_product_id,
    'RECIPE_NO_INGREDIENTS',
    'CONVERTED_TO_PRODUCT',
    now(),
    auth.uid(),
    now(),
    'Reclassificado como produto de venda (ficha removida).'
  )
  ON CONFLICT (company_id, product_id, review_bucket) DO UPDATE SET
    resolution = 'CONVERTED_TO_PRODUCT',
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now(),
    notes = EXCLUDED.notes;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'deleted_recipe_id', v_recipe_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.dashboard_import_review_epoc_recipe_revert_to_product(UUID, UUID) IS
  'Dashboard EPOC: remove ficha técnica sem insumos e trata o item como produto (DIRECT / PRODUTO_REVENDA).';

GRANT EXECUTE ON FUNCTION public.dashboard_import_review_epoc_recipe_revert_to_product(UUID, UUID) TO authenticated;

-- Desfazer ficha técnica (com ou sem insumos): apaga receita, restaura DIRECT e libera correlação.

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_undo(
  p_company_id UUID,
  p_recipe_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_output_product_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT r.output_product_id
  INTO v_output_product_id
  FROM public.recipes r
  WHERE r.id = p_recipe_id
    AND r.company_id = p_company_id;

  IF v_output_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.revenue_entries re
    WHERE re.company_id = p_company_id
      AND re.recipe_id = p_recipe_id
      AND re.entry_mode = 'recipe_sale'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_sale_entries_exist');
  END IF;

  DELETE FROM public.recipes
  WHERE id = p_recipe_id
    AND company_id = p_company_id;

  UPDATE public.products
  SET
    stock_control_type = 'DIRECT',
    listed_in_product_catalog = CASE
      WHEN listed_in_product_catalog IS FALSE THEN true
      ELSE listed_in_product_catalog
    END,
    updated_at = now()
  WHERE id = v_output_product_id
    AND company_id = p_company_id;

  UPDATE public.product_operational_config poc
  SET
    suggested_operational_type = 'PRODUTO_REVENDA',
    final_operational_type = 'PRODUTO_REVENDA',
    final_decision_source = 'USER_CONFIRMED',
    configuration_status = 'CONFIGURADO',
    linked_entry_breakdown_recipe_id = CASE
      WHEN poc.linked_entry_breakdown_recipe_id = p_recipe_id THEN NULL
      ELSE poc.linked_entry_breakdown_recipe_id
    END,
    suggestion_reasons = coalesce(poc.suggestion_reasons, '{}'::jsonb)
      || jsonb_build_object('recipe_undone', true),
    updated_at = now()
  WHERE poc.company_id = p_company_id
    AND poc.product_id = v_output_product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'output_product_id', v_output_product_id,
    'recipe_id', p_recipe_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_undo(UUID, UUID) IS
  'Apaga ficha técnica (com insumos), restaura produto de saída para DIRECT e libera correlação vendidos/comprados.';

GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_undo(UUID, UUID) TO authenticated;

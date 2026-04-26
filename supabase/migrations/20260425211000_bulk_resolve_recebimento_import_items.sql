-- Resolve em lote itens pendentes de importação em um recebimento (link/token).

CREATE OR REPLACE FUNCTION public.bulk_update_import_resolution_for_recebimento(
  p_token UUID,
  p_import_stock_resolution TEXT,
  p_resolved_recipe_id UUID,
  p_target_product_id UUID DEFAULT NULL,
  p_import_nature TEXT DEFAULT 'EXPLODIR_POR_FICHA',
  p_import_engine_suggestion TEXT DEFAULT 'AUTO_APPLY_EXPLODIR_FICHA',
  p_import_pending_resolution BOOLEAN DEFAULT FALSE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recebimento RECORD;
  v_count INTEGER := 0;
BEGIN
  SELECT r.id, r.expense_id
  INTO v_recebimento
  FROM public.recebimentos r
  WHERE r.token = p_token
    AND r.status <> 'received';

  IF v_recebimento.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_or_already_received');
  END IF;

  IF p_import_stock_resolution NOT IN ('DIRECT', 'EXPLODE_BY_RECIPE') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_stock_resolution');
  END IF;

  IF p_import_stock_resolution = 'EXPLODE_BY_RECIPE' AND p_resolved_recipe_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'recipe_required_for_explode');
  END IF;

  UPDATE public.expense_items ei
  SET
    import_stock_resolution = p_import_stock_resolution,
    resolved_entry_breakdown_recipe_id = p_resolved_recipe_id,
    product_id = COALESCE(p_target_product_id, ei.product_id),
    import_nature = p_import_nature,
    import_engine_suggestion = p_import_engine_suggestion,
    import_pending_resolution = COALESCE(p_import_pending_resolution, false)
  WHERE ei.expense_id = v_recebimento.expense_id
    AND COALESCE(ei.import_pending_resolution, false) = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_update_import_resolution_for_recebimento(
  UUID, TEXT, UUID, UUID, TEXT, TEXT, BOOLEAN
) TO anon, authenticated;

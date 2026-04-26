CREATE OR REPLACE FUNCTION public.apply_unit_review_to_similar_products(
  p_company_id UUID,
  p_source_unit_raw TEXT,
  p_target_unit_code TEXT,
  p_exclude_product_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_source_norm TEXT := public.normalize_unit_alias_text(p_source_unit_raw);
  v_target_code TEXT := lower(btrim(coalesce(p_target_unit_code, '')));
  v_updated INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_company_id NOT IN (SELECT company_id FROM public.user_companies WHERE user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_source_norm = '' OR v_target_code = '' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  UPDATE public.products p
  SET
    unit = v_target_code,
    import_unit_needs_review = false,
    import_unit_raw = NULL
  WHERE p.company_id = p_company_id
    AND p.import_unit_needs_review = true
    AND public.normalize_unit_alias_text(p.import_unit_raw) = v_source_norm
    AND (p_exclude_product_id IS NULL OR p.id <> p_exclude_product_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object('ok', true, 'updated_products', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_unit_review_to_similar_products(UUID, TEXT, TEXT, UUID) TO authenticated;

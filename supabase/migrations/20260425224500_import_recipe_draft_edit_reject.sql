-- Edição e rejeição de rascunho IA no contexto público de recebimento (token).

CREATE OR REPLACE FUNCTION public.update_import_recipe_draft_for_recebimento(
  p_token UUID,
  p_draft_id UUID,
  p_components JSONB,
  p_confidence_0_1 NUMERIC DEFAULT NULL,
  p_reasons_json JSONB DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_expense_item_id UUID;
  v_status TEXT;
  v_row JSONB;
  v_product_id UUID;
  v_name TEXT;
  v_qty NUMERIC;
  v_unit TEXT;
  v_loss NUMERIC;
  v_conf NUMERIC;
  v_reason TEXT;
  v_sort INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
  SELECT d.company_id, d.expense_item_id, d.status
  INTO v_company_id, v_expense_item_id, v_status
  FROM public.import_recipe_drafts d
  JOIN public.recebimentos r
    ON r.expense_id = (SELECT ei.expense_id FROM public.expense_items ei WHERE ei.id = d.expense_item_id)
  WHERE d.id = p_draft_id
    AND r.token = p_token
    AND r.status <> 'received';

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_or_draft');
  END IF;

  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RETURN json_build_object('ok', false, 'error', 'draft_not_editable');
  END IF;

  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'components_required');
  END IF;

  DELETE FROM public.import_recipe_draft_components
  WHERE draft_id = p_draft_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    v_product_id := NULLIF(btrim(COALESCE(v_row->>'product_id', '')), '')::UUID;
    v_name := COALESCE(NULLIF(btrim(COALESCE(v_row->>'raw_component_name', '')), ''), 'Componente');
    v_qty := COALESCE(NULLIF(btrim(COALESCE(v_row->>'suggested_quantity', '')), '')::NUMERIC, 0);
    v_unit := NULLIF(btrim(COALESCE(v_row->>'suggested_unit', '')), '');
    v_loss := COALESCE(NULLIF(btrim(COALESCE(v_row->>'loss_factor', '')), '')::NUMERIC, 1);
    v_conf := NULLIF(btrim(COALESCE(v_row->>'confidence_0_1', '')), '')::NUMERIC;
    v_reason := NULLIF(btrim(COALESCE(v_row->>'match_reason', '')), '');

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    IF v_loss <= 0 THEN
      v_loss := 1;
    END IF;

    INSERT INTO public.import_recipe_draft_components (
      draft_id,
      product_id,
      raw_component_name,
      suggested_quantity,
      suggested_unit,
      loss_factor,
      confidence_0_1,
      match_reason,
      sort_order
    ) VALUES (
      p_draft_id,
      v_product_id,
      v_name,
      v_qty,
      v_unit,
      v_loss,
      v_conf,
      v_reason,
      v_sort
    );
    v_sort := v_sort + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  IF v_inserted <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_valid_components');
  END IF;

  UPDATE public.import_recipe_drafts
  SET
    confidence_0_1 = COALESCE(p_confidence_0_1, confidence_0_1),
    reasons_json = COALESCE(p_reasons_json, reasons_json),
    updated_at = NOW()
  WHERE id = p_draft_id;

  RETURN json_build_object('ok', true, 'components', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_import_recipe_draft_for_recebimento(UUID, UUID, JSONB, NUMERIC, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_import_recipe_draft_for_recebimento(
  p_token UUID,
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT d.company_id
  INTO v_company_id
  FROM public.import_recipe_drafts d
  JOIN public.recebimentos r
    ON r.expense_id = (SELECT ei.expense_id FROM public.expense_items ei WHERE ei.id = d.expense_item_id)
  WHERE d.id = p_draft_id
    AND r.token = p_token
    AND r.status <> 'received';

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_or_draft');
  END IF;

  UPDATE public.import_recipe_drafts
  SET
    status = 'REJECTED',
    reasons_json = COALESCE(reasons_json, '{}'::jsonb) || jsonb_build_object('reject_reason', p_reason),
    updated_at = NOW()
  WHERE id = p_draft_id
    AND status = 'DRAFT';

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_import_recipe_draft_for_recebimento(UUID, UUID, TEXT) TO anon, authenticated;

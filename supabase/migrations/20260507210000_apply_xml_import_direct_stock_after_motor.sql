-- Entrada automática de estoque após o motor de catálogo XML (compra), espelhando a lógica
-- de entrada direta em confirmar_recebimento, sem exigir confirmação de recebimento.
-- Não aplica quando import_pending_resolution, EXPLODE_BY_RECIPE ou stock_added já true.

CREATE OR REPLACE FUNCTION public.apply_xml_import_direct_stock_for_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_row RECORD;
  v_apply NUMERIC;
  v_applied INTEGER := 0;
BEGIN
  SELECT e.company_id
  INTO v_company_id
  FROM public.expenses e
  WHERE e.id = p_expense_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expense_not_found');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = v_company_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  FOR v_row IN
    SELECT
      ei.id,
      ei.product_id,
      ei.quantity,
      ei.unit_value,
      ei.stock_quantity,
      ei.stock_added,
      ei.import_pending_resolution,
      ei.import_stock_resolution
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
  LOOP
    IF v_row.product_id IS NULL THEN
      CONTINUE;
    END IF;
    IF COALESCE(v_row.stock_added, false) THEN
      CONTINUE;
    END IF;
    IF COALESCE(v_row.import_pending_resolution, false) THEN
      CONTINUE;
    END IF;
    IF v_row.import_stock_resolution = 'EXPLODE_BY_RECIPE' THEN
      CONTINUE;
    END IF;

    v_apply := COALESCE(v_row.stock_quantity, v_row.quantity);
    IF v_apply IS NULL OR v_apply <= 0 THEN
      CONTINUE;
    END IF;

    PERFORM public.adjust_product_stock(
      v_row.product_id,
      v_apply,
      'in',
      'expense_item',
      v_row.id,
      v_row.unit_value
    );

    UPDATE public.expense_items
    SET stock_added = true
    WHERE id = v_row.id;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'lines_applied', v_applied);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.apply_xml_import_direct_stock_for_expense(UUID) IS
  'Após motor XML: dá entrada direta no estoque (DIRECT) para linhas com produto resolvido e sem pendência de import.';

GRANT EXECUTE ON FUNCTION public.apply_xml_import_direct_stock_for_expense(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_xml_import_direct_stock_for_expense(UUID) TO service_role;

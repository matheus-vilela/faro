-- Permite selecionar ficha de entrada (ENTRY_BREAKDOWN) na tela pública de recebimento.

CREATE OR REPLACE FUNCTION public.list_entry_breakdown_recipes_for_recebimento_item(
  p_token UUID,
  p_expense_item_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_product_id UUID;
  v_current_recipe_id UUID;
BEGIN
  SELECT e.company_id, ei.product_id, ei.resolved_entry_breakdown_recipe_id
  INTO v_company_id, v_product_id, v_current_recipe_id
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  JOIN public.expense_items ei ON ei.expense_id = e.id
  WHERE r.token = p_token
    AND r.status <> 'received'
    AND ei.id = p_expense_item_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token_or_item');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'recipes', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'name', r.name,
            'version', r.version,
            'output_product_id', r.output_product_id,
            'batch_yield', r.batch_yield,
            'is_recommended', (
              (
                v_current_recipe_id IS NOT NULL
                AND r.id = v_current_recipe_id
              )
              OR (
                v_current_recipe_id IS NULL
                AND v_product_id IS NOT NULL
                AND r.output_product_id = v_product_id
              )
            ),
            'recommendation_reason',
            CASE
              WHEN v_current_recipe_id IS NOT NULL AND r.id = v_current_recipe_id
                THEN 'Sugerida previamente para este item'
              WHEN v_current_recipe_id IS NULL AND v_product_id IS NOT NULL AND r.output_product_id = v_product_id
                THEN 'Output da ficha coincide com o produto do item'
              ELSE NULL
            END
          )
          ORDER BY
            CASE
              WHEN v_current_recipe_id IS NOT NULL AND r.id = v_current_recipe_id THEN 0
              WHEN v_current_recipe_id IS NULL AND v_product_id IS NOT NULL AND r.output_product_id = v_product_id THEN 1
              ELSE 2
            END,
            r.name,
            r.version DESC
        )
        FROM public.recipes r
        WHERE r.company_id = v_company_id
          AND r.active = true
          AND r.recipe_type = 'ENTRY_BREAKDOWN'
      ),
      '[]'::jsonb
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_entry_breakdown_recipes_for_recebimento_item(UUID, UUID) TO anon, authenticated;

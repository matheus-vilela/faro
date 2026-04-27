-- Classificação de itens (onboarding) visível no link de recebimento (anon) com token válido.

CREATE OR REPLACE FUNCTION public.get_item_classification_onboarding_status_for_recebimento(p_token UUID)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company_id UUID;
  v_total int;
  v_configured int;
  v_blocked int;
  v_incomplete int;
BEGIN
  SELECT e.company_id
  INTO v_company_id
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  WHERE r.token = p_token
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'recebimento_not_found');
  END IF;

  SELECT count(*)::int INTO v_total
  FROM public.products p
  WHERE p.company_id = v_company_id
    AND COALESCE(p.is_active, true) IS true;

  SELECT count(*)::int INTO v_configured
  FROM public.products p
  INNER JOIN public.product_operational_config c
    ON c.product_id = p.id AND c.company_id = p.company_id
  WHERE p.company_id = v_company_id
    AND COALESCE(p.is_active, true) IS true
    AND c.configuration_status = 'CONFIGURADO';

  SELECT count(*)::int INTO v_blocked
  FROM public.product_operational_config c
  WHERE c.company_id = v_company_id
    AND c.configuration_status = 'BLOQUEADO';

  SELECT count(*)::int INTO v_incomplete
  FROM public.products p
  LEFT JOIN public.product_operational_config c
    ON c.product_id = p.id AND c.company_id = p.company_id
  WHERE p.company_id = v_company_id
    AND COALESCE(p.is_active, true) IS true
    AND (c.id IS NULL OR c.configuration_status IS DISTINCT FROM 'CONFIGURADO');

  RETURN json_build_object(
    'ok', true,
    'total_products', v_total,
    'configured', v_configured,
    'blocked', v_blocked,
    'incomplete', v_incomplete,
    'percent', CASE
      WHEN v_total <= 0 THEN 100
      ELSE round((v_configured::numeric / v_total::numeric) * 100::numeric, 2)
    END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_item_classification_onboarding_status_for_recebimento(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_item_classification_onboarding_status_for_recebimento(UUID) TO anon, authenticated;

-- Hints de classificação por item (válido com token de recebimento; anon não passa RLS da tabela).
CREATE OR REPLACE FUNCTION public.get_catalog_resolution_hints_for_recebimento(
  p_token UUID,
  p_product_ids UUID[]
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company_id UUID;
  v_rows json;
BEGIN
  SELECT e.company_id
  INTO v_company_id
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  WHERE r.token = p_token
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'recebimento_not_found');
  END IF;

  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN json_build_object('ok', true, 'rows', '[]'::json);
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'product_id', c.product_id,
        'configuration_status', c.configuration_status,
        'final_operational_type', c.final_operational_type,
        'linked_entry_breakdown_recipe_id', c.linked_entry_breakdown_recipe_id
      )
    ),
    '[]'::json
  )
  INTO v_rows
  FROM public.product_operational_config c
  WHERE c.company_id = v_company_id
    AND c.product_id = ANY (p_product_ids);

  RETURN json_build_object('ok', true, 'rows', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_catalog_resolution_hints_for_recebimento(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_resolution_hints_for_recebimento(UUID, UUID[]) TO anon, authenticated;

-- Tags de catálogo (Cervejas, Soft…) em produtos/fichas vendidos sem assignment.
-- Só heurística de nome; nomes de pagamento não viram tag; sem fallback para Diversos.

CREATE OR REPLACE FUNCTION public.pick_sale_catalog_mix_category_id(
  p_company_id UUID,
  p_product_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_n TEXT;
  v_id UUID;
BEGIN
  v_n := lower(trim(coalesce(p_product_name, '')));
  v_n := translate(v_n,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
  );
  IF v_n = '' THEN
    RETURN NULL;
  END IF;
  IF v_n ~ '^(dinheiro|pix|especie|cash|cartao|credito|debito|voucher|vr|alelo|sodexo|ticket|vale)$' THEN
    RETURN NULL;
  END IF;
  IF v_n ~ '(^| )(dinheiro|especie|cash)( |$)' AND length(v_n) <= 22 THEN
    RETURN NULL;
  END IF;

  IF v_n ~ '(heineken|heine|brahma|skol|amstel|stella|budweiser|corona|praya|eisenbahn|antarctica|bohemia|spaten|therezopolis|colorado|cervej|chopp|lager|pilsen|stout)' THEN
    SELECT c.id INTO v_id
    FROM public.company_product_categories c
    WHERE c.company_id = p_company_id
      AND c.ativo IS DISTINCT FROM false
      AND coalesce(c.exclude_from_sales, false) = false
      AND c.name ~* 'cervej'
    ORDER BY c.sort_order, c.name
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF v_n ~ '(coca|fanta|pepsi|guaran|refrigerante|refriger|suco|isoton|energ|nescau|sprite|schweppes|gatorade|red bull|monster)' THEN
    SELECT c.id INTO v_id
    FROM public.company_product_categories c
    WHERE c.company_id = p_company_id
      AND c.ativo IS DISTINCT FROM false
      AND coalesce(c.exclude_from_sales, false) = false
      AND c.name ~* 'soft'
    ORDER BY c.sort_order, c.name
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF v_n ~ '(gin|vodka|whisk|cachaca|cachaça|rum|tequila|destil)' THEN
    SELECT c.id INTO v_id
    FROM public.company_product_categories c
    WHERE c.company_id = p_company_id
      AND c.ativo IS DISTINCT FROM false
      AND coalesce(c.exclude_from_sales, false) = false
      AND c.name ~* 'destil'
    ORDER BY c.sort_order, c.name
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF v_n ~ '(vinho|espum|champ|prosecco|malbec)' THEN
    SELECT c.id INTO v_id
    FROM public.company_product_categories c
    WHERE c.company_id = p_company_id
      AND c.ativo IS DISTINCT FROM false
      AND coalesce(c.exclude_from_sales, false) = false
      AND c.name ~* 'vinho'
    ORDER BY c.sort_order, c.name
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF v_n ~ '(prato|porcao|porção|bolinho|pastel|caldo|salgado|sobremes|espet|hamburg|pizza)' THEN
    SELECT c.id INTO v_id
    FROM public.company_product_categories c
    WHERE c.company_id = p_company_id
      AND c.ativo IS DISTINCT FROM false
      AND coalesce(c.exclude_from_sales, false) = false
      AND c.name ~* 'salgad|sobremes|pronto'
    ORDER BY c.sort_order, c.name
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_sale_catalog_mix(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;

  INSERT INTO public.product_category_assignments (company_id, product_id, category_id)
  SELECT p.company_id, p.id, public.pick_sale_catalog_mix_category_id(p.company_id, p.name)
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_category_assignments a
      WHERE a.product_id = p.id
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.revenue_entries re
        WHERE re.company_id = p_company_id
          AND re.product_id = p.id
          AND re.entry_mode = 'product_sale'
      )
      OR EXISTS (
        SELECT 1
        FROM public.recipes r
        JOIN public.revenue_entries re ON re.recipe_id = r.id
        WHERE re.company_id = p_company_id
          AND re.entry_mode = 'recipe_sale'
          AND r.output_product_id = p.id
      )
    )
    AND public.pick_sale_catalog_mix_category_id(p.company_id, p.name) IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'inserted', v_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.pick_sale_catalog_mix_category_id(UUID, TEXT) IS
  'Sugere categoria de catálogo (Cervejas, Soft…) pelo nome do produto; NULL se incerto ou pagamento.';
COMMENT ON FUNCTION public.backfill_sale_catalog_mix(UUID) IS
  'Atribui grupo de catálogo a produtos vendidos sem tag, via heurística de nome.';

GRANT EXECUTE ON FUNCTION public.pick_sale_catalog_mix_category_id(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_sale_catalog_mix(UUID) TO service_role;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies
  LOOP
    PERFORM public.backfill_sale_catalog_mix(r.id);
  END LOOP;
END $$;

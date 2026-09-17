-- Folhas DRE de mix de venda (bebidas / produtos), nunca forma de pagamento.
-- Backfill product_sale + recipe_sale nas folhas dump; invalida cache do import EPOC.

CREATE OR REPLACE FUNCTION public.ensure_sale_mix_revenue_leaves(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent UUID;
  v_bebidas UUID;
  v_produtos UUID;
  v_ordem INT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;

  SELECT c.id INTO v_bebidas
  FROM public.company_categories c
  WHERE c.company_id = p_company_id
    AND c.natureza = 'RECEITA'
    AND c.tipo = 'OPERACIONAL'
    AND c.ativo IS DISTINCT FROM false
    AND coalesce(c.papel_receita_dre, '') IS DISTINCT FROM 'DEDUCAO'
    AND NOT EXISTS (
      SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = c.id
    )
    AND c.name ~* 'venda.*bebida|bebidas'
  ORDER BY c.ordem NULLS LAST, c.name
  LIMIT 1;

  SELECT c.id INTO v_produtos
  FROM public.company_categories c
  WHERE c.company_id = p_company_id
    AND c.natureza = 'RECEITA'
    AND c.tipo = 'OPERACIONAL'
    AND c.ativo IS DISTINCT FROM false
    AND coalesce(c.papel_receita_dre, '') IS DISTINCT FROM 'DEDUCAO'
    AND NOT EXISTS (
      SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = c.id
    )
    AND c.name ~* 'venda.*produto'
    AND c.name !~* 'bebida'
  ORDER BY c.ordem NULLS LAST, c.name
  LIMIT 1;

  SELECT c.id INTO v_parent
  FROM public.company_categories c
  WHERE c.company_id = p_company_id
    AND c.natureza = 'RECEITA'
    AND c.tipo = 'OPERACIONAL'
    AND c.parent_id IS NULL
    AND c.ativo IS DISTINCT FROM false
  ORDER BY
    CASE
      WHEN c.name ~* 'receita operacional' THEN 0
      WHEN c.papel_receita_dre = 'BRUTA' THEN 1
      WHEN c.name ~* 'receita bruta' THEN 2
      ELSE 9
    END,
    c.ordem NULLS LAST
  LIMIT 1;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'Empresa sem conta RECEITA OPERACIONAL raiz';
  END IF;

  SELECT coalesce(max(c.ordem), 0) INTO v_ordem
  FROM public.company_categories c
  WHERE c.parent_id = v_parent;

  IF v_bebidas IS NULL THEN
    INSERT INTO public.company_categories (
      company_id, parent_id, name, ordem, sort_order, natureza, tipo,
      ativo, padrao_sistema, incluir_no_dre, papel_receita_dre
    ) VALUES (
      p_company_id, v_parent, 'Vendas de bebidas', v_ordem + 1, v_ordem + 1,
      'RECEITA', 'OPERACIONAL', true, false, true, NULL
    )
    RETURNING id INTO v_bebidas;
  END IF;

  IF v_produtos IS NULL THEN
    INSERT INTO public.company_categories (
      company_id, parent_id, name, ordem, sort_order, natureza, tipo,
      ativo, padrao_sistema, incluir_no_dre, papel_receita_dre
    ) VALUES (
      p_company_id, v_parent, 'Vendas de produtos', v_ordem + 2, v_ordem + 2,
      'RECEITA', 'OPERACIONAL', true, false, true, NULL
    )
    RETURNING id INTO v_produtos;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.ensure_sale_mix_revenue_leaves(UUID) IS
  'Garante folhas RECEITA OPERACIONAL Vendas de bebidas e Vendas de produtos.';

CREATE OR REPLACE FUNCTION public.reclassify_sale_revenue_categories(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bebidas UUID;
  v_produtos UUID;
  v_bebidas_parent UUID;
  v_produtos_parent UUID;
  v_updated INT := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id obrigatorio';
  END IF;

  PERFORM public.ensure_sale_mix_revenue_leaves(p_company_id);

  SELECT c.id, c.parent_id INTO v_bebidas, v_bebidas_parent
  FROM public.company_categories c
  WHERE c.company_id = p_company_id
    AND c.natureza = 'RECEITA'
    AND c.tipo = 'OPERACIONAL'
    AND NOT EXISTS (
      SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = c.id
    )
    AND c.name ~* 'venda.*bebida|bebidas'
  ORDER BY c.ordem NULLS LAST, c.name
  LIMIT 1;

  SELECT c.id, c.parent_id INTO v_produtos, v_produtos_parent
  FROM public.company_categories c
  WHERE c.company_id = p_company_id
    AND c.natureza = 'RECEITA'
    AND c.tipo = 'OPERACIONAL'
    AND NOT EXISTS (
      SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = c.id
    )
    AND c.name ~* 'venda.*produto'
    AND c.name !~* 'bebida'
  ORDER BY c.ordem NULLS LAST, c.name
  LIMIT 1;

  IF v_bebidas IS NULL OR v_produtos IS NULL THEN
    RAISE EXCEPTION 'Folhas de mix de venda nao encontradas apos ensure';
  END IF;

  WITH dump AS (
    SELECT c.id
    FROM public.company_categories c
    WHERE c.company_id = p_company_id
      AND (
        c.name ~* '(^dinheiro$|venda[[:space:]]+pix|^pix([[:space:]]+epoc)?$|vr[[:space:]]*/?[[:space:]]*alelo|adiantamento|reservas[[:space:]]+e[[:space:]]+eventos|outras[[:space:]]+entradas)'
        OR c.id IN (
          SELECT parent_id FROM public.company_categories
          WHERE company_id = p_company_id
            AND name IN ('Vendas de bebidas', 'Vendas de produtos')
            AND parent_id IS NOT NULL
        )
      )
  ),
  classified AS (
    SELECT
      re.id,
      CASE
        WHEN concat_ws(
          ' ',
          re.title,
          p.name,
          r.name,
          cat.names
        ) ~* '(cervej|chopp|heine|brahma|skol|amstel|stella|budweiser|corona|praya|eisenbahn|antarctica|bohemia|long[[:space:]]*neck|\blata\b|refriger|coca|fanta|pepsi|guaran|suco|agua|mineral|gin|vodka|whisk|caipir|drink|red[[:space:]]*bull|tonica|energet|destil|vinho|espum|gelo|rolha|cachaca|tequila)'
          OR coalesce(cat.names, '') ~* '(cervej|chopp|soft|destil|vinho|gelo|bebida|agua|refriger|suco|alcool|energet|cachaca|gin|conhaque|licor)'
        THEN v_bebidas
        ELSE v_produtos
      END AS new_sub
    FROM public.revenue_entries re
    LEFT JOIN public.products p ON p.id = re.product_id
    LEFT JOIN public.recipes r ON r.id = re.recipe_id
    LEFT JOIN LATERAL (
      SELECT string_agg(cpc.name, ' ') AS names
      FROM public.product_category_assignments pca
      JOIN public.company_product_categories cpc ON cpc.id = pca.category_id
      WHERE pca.product_id = coalesce(re.product_id, r.output_product_id)
    ) cat ON true
    WHERE re.company_id = p_company_id
      AND re.revenue_type = 'operational'
      AND re.entry_mode IN ('product_sale', 'recipe_sale')
      AND re.subcategory_id IN (SELECT id FROM dump)
  )
  UPDATE public.revenue_entries re
  SET
    subcategory_id = classified.new_sub,
    category_id = CASE
      WHEN classified.new_sub = v_bebidas THEN v_bebidas_parent
      ELSE v_produtos_parent
    END
  FROM classified
  WHERE re.id = classified.id
    AND (
      re.subcategory_id IS DISTINCT FROM classified.new_sub
      OR re.category_id IS DISTINCT FROM CASE
        WHEN classified.new_sub = v_bebidas THEN v_bebidas_parent
        ELSE v_produtos_parent
      END
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.integration_csv_revenue_import_jobs j
  SET metadata = j.metadata - 'epoc_revenue_category_by_product'
  WHERE j.company_id = p_company_id
    AND j.metadata ? 'epoc_revenue_category_by_product';

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'bebidas_id', v_bebidas,
    'produtos_id', v_produtos,
    'updated', v_updated
  );
END;
$$;

COMMENT ON FUNCTION public.reclassify_sale_revenue_categories(UUID) IS
  'Reclassifica vendas de produto/ficha em folhas dump (Dinheiro, Pix, Adiantamento…) para mix bebidas/produtos.';

GRANT EXECUTE ON FUNCTION public.ensure_sale_mix_revenue_leaves(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reclassify_sale_revenue_categories(UUID) TO service_role;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.company_categories c
      WHERE c.company_id = r.id
        AND c.natureza = 'RECEITA'
        AND c.tipo = 'OPERACIONAL'
        AND c.parent_id IS NULL
    ) THEN
      PERFORM public.ensure_sale_mix_revenue_leaves(r.id);
      PERFORM public.reclassify_sale_revenue_categories(r.id);
    END IF;
  END LOOP;
END $$;

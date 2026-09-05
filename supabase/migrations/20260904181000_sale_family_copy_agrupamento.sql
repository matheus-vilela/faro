-- Copy visível: agrupamento (não família). Código interno permanece sale_family.

COMMENT ON TABLE public.product_sale_family_members IS
  'Variantes de estoque ligadas a um item de cardápio (agrupamento). qty_per_sale é só cadastro; não gera movimento.';

COMMENT ON COLUMN public.products.stock_only_origin IS
  'Saiu no relatório de estoque EPOC e não na venda. Candidato a variante de agrupamento.';

COMMENT ON TABLE public.epoc_day_stock_outs IS
  'Saídas de mod_rel_estoque persistidas no mesmo ciclo da venda de produtos. A UI lista só-estoque ainda sem agrupamento.';

CREATE OR REPLACE FUNCTION public.link_sale_family_variant(
  p_company_id UUID,
  p_family_product_id UUID,
  p_variant_name TEXT,
  p_variant_sku TEXT DEFAULT NULL,
  p_variant_unit TEXT DEFAULT 'un',
  p_qty_per_sale NUMERIC DEFAULT 1,
  p_variant_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_family RECORD;
  v_variant_id UUID;
  v_created BOOLEAN := false;
  v_promoted BOOLEAN := false;
  v_sku TEXT := nullif(btrim(coalesce(p_variant_sku, '')), '');
  v_name TEXT := nullif(btrim(coalesce(p_variant_name, '')), '');
  v_unit TEXT := coalesce(nullif(btrim(coalesce(p_variant_unit, '')), ''), 'un');
  v_qty NUMERIC := coalesce(p_qty_per_sale, 1);
  v_other UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;
  IF p_company_id IS NULL OR p_family_product_id IS NULL THEN
    RAISE EXCEPTION 'company_id e family_product_id sao obrigatorios';
  END IF;
  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nome da variante obrigatorio';
  END IF;
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Proporcao deve ser maior que zero';
  END IF;

  SELECT p.id, p.company_id, p.stock_control_type, p.name
  INTO v_family
  FROM public.products p
  WHERE p.id = p_family_product_id
  FOR UPDATE;

  IF v_family.id IS NULL OR v_family.company_id <> p_company_id THEN
    RAISE EXCEPTION 'Produto do agrupamento nao encontrado';
  END IF;
  IF v_family.stock_control_type = 'RECIPE_CONTROLLED' THEN
    RAISE EXCEPTION 'Este produto e ficha tecnica. Agrupamento e outro cadastro.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_sale_family_members m
    WHERE m.variant_product_id = p_family_product_id
  ) THEN
    RAISE EXCEPTION 'Uma variante nao pode virar agrupamento';
  END IF;

  IF v_family.stock_control_type IS DISTINCT FROM 'SALE_FAMILY' THEN
    PERFORM public.promote_product_to_sale_family(p_family_product_id);
    v_promoted := true;
  END IF;

  IF p_variant_product_id IS NOT NULL THEN
    v_variant_id := p_variant_product_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_variant_id AND p.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Variante informada nao encontrada';
    END IF;
  ELSE
    IF v_sku IS NOT NULL THEN
      SELECT p.id INTO v_variant_id
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND p.is_active IS NOT FALSE
        AND btrim(coalesce(p.sku, '')) = v_sku
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_variant_id IS NULL THEN
      SELECT p.id INTO v_variant_id
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND p.is_active IS NOT FALSE
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_variant_id IS NULL THEN
      INSERT INTO public.products (
        company_id, name, sku, unit, current_quantity, min_quantity,
        is_active, stock_control_type, listed_in_product_catalog, composes_cmv
      ) VALUES (
        p_company_id, left(upper(v_name), 512), v_sku, left(v_unit, 32),
        0, 0, true, 'DIRECT', true, true
      )
      RETURNING id INTO v_variant_id;
      v_created := true;
    END IF;
  END IF;

  IF v_variant_id = p_family_product_id THEN
    RAISE EXCEPTION 'A variante nao pode ser o proprio agrupamento';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_variant_id AND p.stock_control_type = 'SALE_FAMILY'
  ) THEN
    RAISE EXCEPTION 'Um agrupamento nao pode ser variante de outro';
  END IF;

  SELECT m.family_product_id INTO v_other
  FROM public.product_sale_family_members m
  WHERE m.variant_product_id = v_variant_id
    AND m.family_product_id <> p_family_product_id;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Esta variante ja pertence a outro agrupamento';
  END IF;

  INSERT INTO public.product_sale_family_members (
    company_id, family_product_id, variant_product_id, qty_per_sale
  ) VALUES (
    p_company_id, p_family_product_id, v_variant_id, v_qty
  )
  ON CONFLICT (family_product_id, variant_product_id)
  DO UPDATE SET qty_per_sale = excluded.qty_per_sale, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'family_product_id', p_family_product_id,
    'variant_product_id', v_variant_id,
    'created_variant', v_created,
    'promoted_family', v_promoted,
    'qty_per_sale', v_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_sale_family_variant(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, UUID)
  TO authenticated, service_role;

-- Baixa de estoque EPOC para qualquer produto casado (não só variante já ligada).
-- Água (também na venda do dia) não baixa de novo.

DROP FUNCTION IF EXISTS public.apply_epoc_stock_variant_outs(UUID, DATE, JSONB);

CREATE OR REPLACE FUNCTION public.apply_epoc_stock_variant_outs(
  p_company_id UUID,
  p_sale_date DATE,
  p_items JSONB,
  p_sold JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item JSONB;
  v_sold JSONB;
  v_sku TEXT;
  v_name TEXT;
  v_qty NUMERIC;
  v_product_id UUID;
  v_sct TEXT;
  v_sold_match BOOLEAN;
  v_applied INTEGER := 0;
  v_skipped INTEGER := 0;
  v_already INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
       AND current_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'Sessao invalida';
    END IF;
  ELSIF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF p_sale_date IS NULL THEN
    RAISE EXCEPTION 'Data obrigatoria';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'items deve ser um array';
  END IF;
  IF p_sold IS NULL OR jsonb_typeof(p_sold) IS DISTINCT FROM 'array' THEN
    p_sold := '[]'::jsonb;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_sku := nullif(btrim(coalesce(v_item->>'sku', '')), '');
    v_name := nullif(btrim(coalesce(v_item->>'name', '')), '');
    BEGIN
      v_qty := NULLIF(v_item->>'qty', '')::numeric;
    EXCEPTION WHEN others THEN
      v_qty := NULL;
    END;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_sold_match := false;
    FOR v_sold IN SELECT value FROM jsonb_array_elements(p_sold)
    LOOP
      IF v_sku IS NOT NULL
        AND nullif(btrim(coalesce(v_sold->>'sku', '')), '') = v_sku
      THEN
        v_sold_match := true;
      END IF;
      IF v_name IS NOT NULL
        AND nullif(btrim(coalesce(v_sold->>'name', '')), '') IS NOT NULL
        AND public.normalize_product_match_key(v_sold->>'name')
          = public.normalize_product_match_key(v_name)
      THEN
        v_sold_match := true;
      END IF;
    END LOOP;
    IF v_sold_match THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_product_id := NULL;
    v_sct := NULL;
    IF v_sku IS NOT NULL THEN
      SELECT p.id, p.stock_control_type INTO v_product_id, v_sct
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND btrim(coalesce(p.sku, '')) = v_sku
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_product_id IS NULL AND v_name IS NOT NULL THEN
      SELECT p.id, p.stock_control_type INTO v_product_id, v_sct
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_sct = 'SALE_FAMILY' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_sct = 'RECIPE_CONTROLLED'
       AND NOT EXISTS (
         SELECT 1 FROM public.product_sale_family_members m
         WHERE m.variant_product_id = v_product_id
       )
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.revenue_entries re
      WHERE re.product_id = v_product_id
        AND re.entry_date = p_sale_date
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.stock_movements sm
      WHERE sm.product_id = v_product_id
        AND sm.reference_type = 'epoc_stock_report'
        AND sm.type = 'out'
        AND coalesce(sm.metadata_json->>'sale_date', '') = p_sale_date::text
    ) THEN
      v_already := v_already + 1;
      CONTINUE;
    END IF;

    PERFORM public.adjust_product_stock(
      v_product_id,
      -v_qty,
      'out',
      'epoc_stock_report',
      NULL
    );

    UPDATE public.stock_movements
    SET metadata_json = coalesce(metadata_json, '{}'::jsonb) || jsonb_build_object(
      'sale_date', p_sale_date::text,
      'source', 'epoc_rel_estoque'
    )
    WHERE id = (
      SELECT sm.id
      FROM public.stock_movements sm
      WHERE sm.product_id = v_product_id
        AND sm.reference_type = 'epoc_stock_report'
      ORDER BY sm.created_at DESC
      LIMIT 1
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'skipped', v_skipped,
    'already', v_already
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_epoc_stock_variant_outs(UUID, DATE, JSONB, JSONB)
  TO authenticated, service_role;

DO $$
DECLARE
  v_day RECORD;
  v_items JSONB;
BEGIN
  FOR v_day IN
    SELECT company_id, sale_date
    FROM public.epoc_day_stock_outs
    GROUP BY company_id, sale_date
  LOOP
    SELECT coalesce(
      jsonb_agg(jsonb_build_object(
        'sku', o.sku,
        'name', o.name,
        'qty', o.qty
      )),
      '[]'::jsonb
    )
    INTO v_items
    FROM public.epoc_day_stock_outs o
    WHERE o.company_id = v_day.company_id
      AND o.sale_date = v_day.sale_date;

    PERFORM public.apply_epoc_stock_variant_outs(
      v_day.company_id,
      v_day.sale_date,
      v_items,
      '[]'::jsonb
    );
  END LOOP;
END;
$$;

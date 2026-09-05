-- Só-estoque da lista do dia precisa existir no catálogo para filtrar/vincular.

CREATE OR REPLACE FUNCTION public.mark_epoc_stock_only_products(
  p_company_id UUID,
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
  v_unit TEXT;
  v_product public.products%ROWTYPE;
  v_marked INTEGER := 0;
  v_created INTEGER := 0;
  v_sku_filled INTEGER := 0;
  v_cleared INTEGER := 0;
  v_sold_sku BOOLEAN;
  v_sold_name BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Sessao invalida';
    END IF;
  ELSIF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
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
    v_unit := coalesce(nullif(btrim(coalesce(v_item->>'unit', '')), ''), 'un');
    IF v_sku IS NULL AND v_name IS NULL THEN
      CONTINUE;
    END IF;

    v_sold_sku := false;
    v_sold_name := false;
    FOR v_sold IN SELECT value FROM jsonb_array_elements(p_sold)
    LOOP
      IF v_sku IS NOT NULL
        AND nullif(btrim(coalesce(v_sold->>'sku', '')), '') = v_sku
      THEN
        v_sold_sku := true;
      END IF;
      IF v_name IS NOT NULL
        AND nullif(btrim(coalesce(v_sold->>'name', '')), '') IS NOT NULL
        AND public.normalize_product_match_key(v_sold->>'name')
          = public.normalize_product_match_key(v_name)
      THEN
        v_sold_name := true;
      END IF;
    END LOOP;

    v_product := NULL;
    IF v_sku IS NOT NULL THEN
      SELECT * INTO v_product
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND btrim(coalesce(p.sku, '')) = v_sku
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_product.id IS NULL AND v_name IS NOT NULL THEN
      SELECT * INTO v_product
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_product.id IS NULL THEN
      IF v_sold_sku OR v_sold_name OR v_name IS NULL THEN
        CONTINUE;
      END IF;
      INSERT INTO public.products (
        company_id, name, sku, unit, current_quantity, min_quantity,
        is_active, stock_control_type, listed_in_product_catalog, composes_cmv,
        stock_only_origin
      ) VALUES (
        p_company_id,
        left(upper(v_name), 512),
        v_sku,
        left(v_unit, 32),
        0, 0, true, 'DIRECT', true, true,
        true
      )
      RETURNING * INTO v_product;
      v_created := v_created + 1;
      CONTINUE;
    END IF;

    IF v_sold_sku OR v_sold_name
      OR v_product.stock_control_type IN ('SALE_FAMILY', 'RECIPE_CONTROLLED')
      OR EXISTS (
        SELECT 1 FROM public.product_sale_family_members m
        WHERE m.variant_product_id = v_product.id
      )
      OR EXISTS (
        SELECT 1 FROM public.revenue_entries r
        WHERE r.product_id = v_product.id
      )
    THEN
      IF v_product.stock_only_origin THEN
        UPDATE public.products
        SET stock_only_origin = false, updated_at = now()
        WHERE id = v_product.id;
        v_cleared := v_cleared + 1;
      END IF;
      CONTINUE;
    END IF;

    UPDATE public.products
    SET
      stock_only_origin = true,
      sku = CASE
        WHEN nullif(btrim(coalesce(sku, '')), '') IS NULL AND v_sku IS NOT NULL
        THEN v_sku
        ELSE sku
      END,
      listed_in_product_catalog = true,
      updated_at = now()
    WHERE id = v_product.id
      AND (
        stock_only_origin IS NOT TRUE
        OR listed_in_product_catalog IS NOT TRUE
        OR (
          nullif(btrim(coalesce(sku, '')), '') IS NULL
          AND v_sku IS NOT NULL
        )
      );

    IF FOUND THEN
      IF v_product.stock_only_origin IS NOT TRUE THEN
        v_marked := v_marked + 1;
      END IF;
      IF nullif(btrim(coalesce(v_product.sku, '')), '') IS NULL AND v_sku IS NOT NULL THEN
        v_sku_filled := v_sku_filled + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'marked', v_marked,
    'created', v_created,
    'sku_filled', v_sku_filled,
    'cleared', v_cleared
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_epoc_stock_only_products(UUID, JSONB, JSONB)
  TO authenticated, service_role;

INSERT INTO public.products (
  company_id, name, sku, unit, current_quantity, min_quantity,
  is_active, stock_control_type, listed_in_product_catalog, composes_cmv,
  stock_only_origin
)
SELECT DISTINCT ON (
  o.company_id,
  coalesce(nullif(btrim(o.sku), ''), ''),
  public.normalize_product_match_key(o.name)
)
  o.company_id,
  left(upper(o.name), 512),
  nullif(btrim(o.sku), ''),
  left(coalesce(nullif(btrim(o.unit), ''), 'un'), 32),
  0,
  0,
  true,
  'DIRECT',
  true,
  true,
  true
FROM public.epoc_day_stock_outs o
WHERE nullif(btrim(o.name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.company_id = o.company_id
      AND (
        (
          nullif(btrim(o.sku), '') IS NOT NULL
          AND btrim(coalesce(p.sku, '')) = btrim(o.sku)
        )
        OR public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(o.name)
      )
  )
ORDER BY
  o.company_id,
  coalesce(nullif(btrim(o.sku), ''), ''),
  public.normalize_product_match_key(o.name),
  o.sale_date DESC;

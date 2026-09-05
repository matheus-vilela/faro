-- Sync operacional: estoque do dia no extras + apply via service_role.

ALTER TABLE public.epoc_sync_day_status
  ADD COLUMN IF NOT EXISTS stock_ok boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_error text;

COMMENT ON COLUMN public.epoc_sync_day_status.stock_ok IS
  'Relatório mod_rel_estoque do dia foi buscado e apply_epoc_stock_variant_outs rodou (mesmo com 0 baixas).';

CREATE OR REPLACE FUNCTION public.apply_epoc_stock_variant_outs(
  p_company_id UUID,
  p_sale_date DATE,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item JSONB;
  v_sku TEXT;
  v_name TEXT;
  v_qty NUMERIC;
  v_product_id UUID;
  v_applied INTEGER := 0;
  v_skipped INTEGER := 0;
  v_already INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
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

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_sku := nullif(btrim(coalesce(v_item->>'sku', '')), '');
    v_name := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_qty := NULLIF(v_item->>'qty', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_product_id := NULL;
    IF v_sku IS NOT NULL THEN
      SELECT p.id INTO v_product_id
      FROM public.products p
      JOIN public.product_sale_family_members m ON m.variant_product_id = p.id
      WHERE p.company_id = p_company_id
        AND btrim(coalesce(p.sku, '')) = v_sku
      LIMIT 1;
    END IF;
    IF v_product_id IS NULL AND v_name IS NOT NULL THEN
      SELECT p.id INTO v_product_id
      FROM public.products p
      JOIN public.product_sale_family_members m ON m.variant_product_id = p.id
      WHERE p.company_id = p_company_id
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      LIMIT 1;
    END IF;

    IF v_product_id IS NULL THEN
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

GRANT EXECUTE ON FUNCTION public.apply_epoc_stock_variant_outs(UUID, DATE, JSONB)
  TO authenticated, service_role;

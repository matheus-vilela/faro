-- Corrige merge: inventory_count_listings não tem product_id (usa inventory_count_listing_products).

CREATE OR REPLACE FUNCTION public.merge_company_products(
  p_company_id UUID,
  p_winner_id UUID,
  p_loser_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_win RECORD;
  v_lose RECORD;
  v_qty_win NUMERIC;
  v_qty_lose NUMERIC;
  v_win_conv JSONB;
  v_lose_conv JSONB;
  v_merged_conv JSONB;
  v_names TEXT[];
  v_canon_lose TEXT;
  v_unit_lose TEXT;
  v_label TEXT;
BEGIN
  IF p_winner_id = p_loser_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_product');
  END IF;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT
    p.*,
    p.current_quantity AS qty
  INTO v_win
  FROM public.products p
  WHERE p.id = p_winner_id
  FOR UPDATE;

  SELECT
    p.*,
    p.current_quantity AS qty
  INTO v_lose
  FROM public.products p
  WHERE p.id = p_loser_id
  FOR UPDATE;

  IF v_win.id IS NULL OR v_lose.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  IF v_win.company_id <> p_company_id OR v_lose.company_id <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_mismatch');
  END IF;

  v_qty_win := COALESCE(v_win.qty, 0);
  v_qty_lose := COALESCE(v_lose.qty, 0);
  v_win_conv := COALESCE(v_win.unit_conversions, '[]'::jsonb);
  v_lose_conv := COALESCE(v_lose.unit_conversions, '[]'::jsonb);

  DELETE FROM public.product_operational_config
  WHERE company_id = p_company_id AND product_id = p_loser_id;

  DELETE FROM public.product_category_assignments WHERE product_id = p_loser_id;

  UPDATE public.product_import_equivalences
  SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  IF to_regclass('public.product_unit_rules') IS NOT NULL THEN
    DELETE FROM public.product_unit_rules r
    WHERE r.product_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.product_unit_rules w
        WHERE w.company_id = r.company_id
          AND w.product_id = p_winner_id
          AND w.from_unit_normalized = r.from_unit_normalized
      );

    UPDATE public.product_unit_rules
    SET product_id = p_winner_id, updated_at = NOW()
    WHERE product_id = p_loser_id;
  END IF;

  DELETE FROM public.product_invoice_line_aliases l
  WHERE l.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_invoice_line_aliases w
      WHERE w.company_id = l.company_id
        AND w.product_id = p_winner_id
        AND w.normalized_label = l.normalized_label
    );

  UPDATE public.product_invoice_line_aliases
  SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.expense_items SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.stock_movements SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.revenue_entries SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.purchase_order_items SET product_id = p_winner_id WHERE product_id = p_loser_id;

  IF to_regclass('public.inventory_count_listing_products') IS NOT NULL THEN
    DELETE FROM public.inventory_count_listing_products lp
    WHERE lp.product_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.inventory_count_listing_products w
        WHERE w.listing_id = lp.listing_id
          AND w.product_id = p_winner_id
      );

    UPDATE public.inventory_count_listing_products
    SET product_id = p_winner_id
    WHERE product_id = p_loser_id;
  END IF;

  IF to_regclass('public.expense_resolution_logs') IS NOT NULL THEN
    UPDATE public.expense_resolution_logs
    SET matched_product_id = p_winner_id
    WHERE matched_product_id = p_loser_id;
  END IF;

  DELETE FROM public.product_import_dashboard_review
  WHERE product_id = p_loser_id;

  DELETE FROM public.recipe_ingredients ri
  WHERE ri.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.recipe_ingredients z
      WHERE z.recipe_id = ri.recipe_id AND z.product_id = p_winner_id
    );

  UPDATE public.recipe_ingredients SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.recipes SET output_product_id = p_winner_id WHERE output_product_id = p_loser_id;

  SELECT COALESCE(
    (
      SELECT jsonb_agg(w.elem ORDER BY w.elem->>'secondary_unit_code')
      FROM (
        SELECT DISTINCT ON (lower(trim(elem->>'secondary_unit_code'))) elem
        FROM (
          SELECT elem FROM jsonb_array_elements(v_win_conv) elem
          UNION ALL
          SELECT elem FROM jsonb_array_elements(v_lose_conv) elem
        ) all_elems
        ORDER BY lower(trim(elem->>'secondary_unit_code')), elem
      ) w
    ),
    '[]'::jsonb
  ) INTO v_merged_conv;

  v_names := COALESCE(v_win.merged_catalog_names, '{}'::text[]);
  IF NULLIF(btrim(v_lose.name), '') IS NOT NULL THEN
    v_names := array_append(v_names, btrim(v_lose.name));
  END IF;
  IF NULLIF(btrim(v_lose.canonical_name), '') IS NOT NULL THEN
    v_names := array_append(v_names, btrim(v_lose.canonical_name));
  END IF;
  IF COALESCE(array_length(v_lose.merged_catalog_names, 1), 0) > 0 THEN
    v_names := v_names || v_lose.merged_catalog_names;
  END IF;

  SELECT array_agg(DISTINCT n ORDER BY n)
  INTO v_names
  FROM unnest(v_names) AS n
  WHERE n IS NOT NULL AND btrim(n) <> '';

  v_canon_lose := NULLIF(btrim(v_lose.canonical_name), '');
  IF v_canon_lose IS NULL AND NULLIF(btrim(v_lose.name), '') IS NOT NULL THEN
    v_canon_lose := public.normalize_invoice_product_label(v_lose.name);
  END IF;

  v_unit_lose := lower(btrim(COALESCE(v_lose.unit, 'un')));

  IF v_canon_lose IS NOT NULL AND length(v_canon_lose) >= 2 THEN
    INSERT INTO public.product_import_equivalences (
      company_id,
      source_canonical_name,
      source_unit_normalized,
      product_id,
      requires_confirmation
    ) VALUES (
      p_company_id,
      v_canon_lose,
      v_unit_lose,
      p_winner_id,
      false
    )
    ON CONFLICT (company_id, source_canonical_name, source_unit_normalized)
    DO UPDATE SET
      product_id = EXCLUDED.product_id,
      requires_confirmation = false,
      updated_at = NOW();
  END IF;

  v_label := public.normalize_invoice_product_label(v_lose.name);
  IF v_label IS NOT NULL THEN
    INSERT INTO public.product_invoice_line_aliases (company_id, normalized_label, product_id)
    VALUES (p_company_id, v_label, p_winner_id)
    ON CONFLICT (company_id, normalized_label)
    DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = NOW();
  END IF;

  UPDATE public.products SET
    current_quantity = COALESCE(v_qty_win, 0) + COALESCE(v_qty_lose, 0),
    unit_conversions = v_merged_conv,
    merged_catalog_names = COALESCE(v_names, '{}'::text[]),
    sku = COALESCE(NULLIF(btrim(sku), ''), NULLIF(btrim(v_lose.sku), '')),
    barcode = COALESCE(NULLIF(btrim(barcode), ''), NULLIF(btrim(v_lose.barcode), '')),
    ean = COALESCE(NULLIF(btrim(ean), ''), NULLIF(btrim(v_lose.ean), '')),
    ncm = COALESCE(NULLIF(btrim(ncm), ''), NULLIF(btrim(v_lose.ncm), '')),
    cfop = COALESCE(NULLIF(btrim(cfop), ''), NULLIF(btrim(v_lose.cfop), '')),
    csosn = COALESCE(NULLIF(btrim(csosn), ''), NULLIF(btrim(v_lose.csosn), '')),
    canonical_name = COALESCE(NULLIF(btrim(canonical_name), ''), NULLIF(btrim(v_lose.canonical_name), '')),
    import_unit_raw = COALESCE(NULLIF(btrim(import_unit_raw), ''), NULLIF(btrim(v_lose.import_unit_raw), '')),
    last_unit_value = COALESCE(last_unit_value, v_lose.last_unit_value),
    last_unit_value_unit_code = COALESCE(
      NULLIF(btrim(last_unit_value_unit_code), ''),
      NULLIF(btrim(v_lose.last_unit_value_unit_code), '')
    ),
    last_unit_value_stock = COALESCE(last_unit_value_stock, v_lose.last_unit_value_stock),
    average_cost = COALESCE(average_cost, v_lose.average_cost),
    updated_at = NOW()
  WHERE id = p_winner_id;

  DELETE FROM public.products WHERE id = p_loser_id;

  RETURN jsonb_build_object(
    'ok', true,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'merged_names', COALESCE(v_names, '{}'::text[])
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

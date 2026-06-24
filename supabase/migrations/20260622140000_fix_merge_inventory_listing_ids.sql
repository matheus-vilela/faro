-- Corrige merge/undo: inventory_count_listing_products usa PK (listing_id, product_id), sem coluna id.

-- ---------------------------------------------------------------------------
-- merge_company_products (com auditoria)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merge_company_products(
  p_company_id UUID,
  p_winner_id UUID,
  p_loser_id UUID,
  p_loser_to_winner_factor NUMERIC DEFAULT NULL,
  p_merged_unit_conversions JSONB DEFAULT NULL
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
  v_qty_lose_adj NUMERIC;
  v_min_lose NUMERIC;
  v_min_lose_adj NUMERIC;
  v_factor NUMERIC;
  v_win_unit TEXT;
  v_lose_unit TEXT;
  v_win_conv JSONB;
  v_lose_conv JSONB;
  v_merged_conv JSONB;
  v_names TEXT[];
  v_names_before TEXT[];
  v_canon_lose TEXT;
  v_unit_lose TEXT;
  v_label TEXT;
  v_event_id UUID := gen_random_uuid();
  v_merge_movement_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_merge_stamp JSONB;
  v_winner_before JSONB;
  v_loser_snapshot JSONB;
  v_stock_movements_before JSONB;
  v_affected_stock_ids UUID[];
  v_affected_expense_ids UUID[];
  v_affected_revenue_ids UUID[];
  v_affected_purchase_ids UUID[];
  v_affected_recipe_ingredient_ids UUID[];
  v_affected_recipe_output_ids UUID[];
  v_listing_ids_reassigned UUID[];
  v_listing_ids_removed UUID[];
  v_category_assignment_ids UUID[];
  v_operational_config_id UUID;
  v_loser_operational_config JSONB;
  v_loser_category_ids UUID[];
  v_aliases_equiv_keys TEXT[];
  v_aliases_invoice_labels TEXT[];
  v_event JSONB;
  v_new_merged_names TEXT[];
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

  SELECT p.*, p.current_quantity AS qty
  INTO v_win
  FROM public.products p
  WHERE p.id = p_winner_id
  FOR UPDATE;

  SELECT p.*, p.current_quantity AS qty
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

  v_win_unit := lower(btrim(COALESCE(v_win.unit, 'un')));
  v_lose_unit := lower(btrim(COALESCE(v_lose.unit, 'un')));
  v_qty_win := COALESCE(v_win.qty, 0);
  v_qty_lose := COALESCE(v_lose.qty, 0);
  v_min_lose := COALESCE(v_lose.min_quantity, 0);
  v_win_conv := COALESCE(v_win.unit_conversions, '[]'::jsonb);
  v_lose_conv := COALESCE(v_lose.unit_conversions, '[]'::jsonb);

  IF v_win_unit = v_lose_unit THEN
    v_factor := COALESCE(p_loser_to_winner_factor, 1);
  ELSE
    IF p_loser_to_winner_factor IS NULL OR p_loser_to_winner_factor <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'unit_conversion_required',
        'message',
        'Informe a proporÃ§Ã£o entre as unidades de estoque dos dois produtos.'
      );
    END IF;
    v_factor := p_loser_to_winner_factor;
  END IF;

  IF v_factor IS NULL OR v_factor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_unit_factor');
  END IF;

  v_qty_lose_adj := v_qty_lose * v_factor;
  v_min_lose_adj := v_min_lose * v_factor;
  v_names_before := COALESCE(v_win.merged_catalog_names, '{}'::text[]);

  v_winner_before := jsonb_build_object(
    'current_quantity', v_win.current_quantity,
    'min_quantity', v_win.min_quantity,
    'unit', v_win.unit,
    'unit_conversions', v_win_conv,
    'merged_catalog_names', to_jsonb(COALESCE(v_win.merged_catalog_names, '{}'::text[])),
    'sku', v_win.sku,
    'barcode', v_win.barcode,
    'ean', v_win.ean,
    'ncm', v_win.ncm,
    'cfop', v_win.cfop,
    'csosn', v_win.csosn,
    'canonical_name', v_win.canonical_name,
    'import_unit_raw', v_win.import_unit_raw,
    'last_unit_value', v_win.last_unit_value,
    'last_unit_value_unit_code', v_win.last_unit_value_unit_code,
    'last_unit_value_stock', v_win.last_unit_value_stock,
    'average_cost', v_win.average_cost,
    'merge_audit', COALESCE(v_win.merge_audit, '[]'::jsonb)
  );

  v_loser_snapshot := to_jsonb(v_lose) - 'qty';

  SELECT COALESCE(
    jsonb_object_agg(
      sm.id::text,
      jsonb_build_object('quantity', sm.quantity, 'product_id', sm.product_id)
    ),
    '{}'::jsonb
  )
  INTO v_stock_movements_before
  FROM public.stock_movements sm
  WHERE sm.product_id = p_loser_id;

  SELECT COALESCE(array_agg(sm.id), '{}'::uuid[])
  INTO v_affected_stock_ids
  FROM public.stock_movements sm
  WHERE sm.product_id = p_loser_id;

  SELECT COALESCE(array_agg(ei.id), '{}'::uuid[])
  INTO v_affected_expense_ids
  FROM public.expense_items ei
  WHERE ei.product_id = p_loser_id;

  SELECT COALESCE(array_agg(re.id), '{}'::uuid[])
  INTO v_affected_revenue_ids
  FROM public.revenue_entries re
  WHERE re.product_id = p_loser_id;

  SELECT COALESCE(array_agg(poi.id), '{}'::uuid[])
  INTO v_affected_purchase_ids
  FROM public.purchase_order_items poi
  WHERE poi.product_id = p_loser_id;

  SELECT COALESCE(array_agg(ri.id), '{}'::uuid[])
  INTO v_affected_recipe_ingredient_ids
  FROM public.recipe_ingredients ri
  WHERE ri.product_id = p_loser_id;

  SELECT COALESCE(array_agg(r.id), '{}'::uuid[])
  INTO v_affected_recipe_output_ids
  FROM public.recipes r
  WHERE r.output_product_id = p_loser_id;

  SELECT COALESCE(array_agg(lp.listing_id), '{}'::uuid[])
  INTO v_listing_ids_reassigned
  FROM public.inventory_count_listing_products lp
  WHERE lp.product_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_count_listing_products w
      WHERE w.listing_id = lp.listing_id AND w.product_id = p_winner_id
    );

  SELECT COALESCE(array_agg(lp.listing_id), '{}'::uuid[])
  INTO v_listing_ids_removed
  FROM public.inventory_count_listing_products lp
  WHERE lp.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.inventory_count_listing_products w
      WHERE w.listing_id = lp.listing_id AND w.product_id = p_winner_id
    );

  SELECT COALESCE(array_agg(pca.category_id), '{}'::uuid[])
  INTO v_loser_category_ids
  FROM public.product_category_assignments pca
  WHERE pca.product_id = p_loser_id;

  SELECT poc.id, to_jsonb(poc.*)
  INTO v_operational_config_id, v_loser_operational_config
  FROM public.product_operational_config poc
  WHERE poc.company_id = p_company_id AND poc.product_id = p_loser_id;

  v_merge_stamp := jsonb_build_object(
    'product_merge', jsonb_build_object(
      'event_id', v_event_id,
      'merged_at', v_now,
      'from_product_id', p_loser_id,
      'from_product_name', v_lose.name,
      'to_product_id', p_winner_id,
      'loser_to_winner_factor', v_factor
    )
  );

  DELETE FROM public.product_operational_config
  WHERE company_id = p_company_id AND product_id = p_loser_id;

  DELETE FROM public.product_category_assignments
  WHERE product_id = p_loser_id;

  UPDATE public.product_import_equivalences
  SET product_id = p_winner_id, updated_at = v_now
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
    SET product_id = p_winner_id, updated_at = v_now
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

  UPDATE public.expense_items ei
  SET
    metadata_json = COALESCE(ei.metadata_json, '{}'::jsonb) || v_merge_stamp,
    product_id = p_winner_id
  WHERE ei.product_id = p_loser_id;

  UPDATE public.stock_movements sm
  SET
    metadata_json = COALESCE(sm.metadata_json, '{}'::jsonb) || v_merge_stamp,
    quantity = sm.quantity * v_factor
  WHERE sm.product_id = p_loser_id;

  UPDATE public.stock_movements
  SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.revenue_entries SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.purchase_order_items SET product_id = p_winner_id WHERE product_id = p_loser_id;

  DELETE FROM public.inventory_count_listing_products lp
  WHERE lp.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.inventory_count_listing_products w
      WHERE w.listing_id = lp.listing_id AND w.product_id = p_winner_id
    );

  UPDATE public.inventory_count_listing_products
  SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

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

  IF p_merged_unit_conversions IS NOT NULL THEN
    v_merged_conv := p_merged_unit_conversions;
  ELSE
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
          WHERE lower(trim(elem->>'primary_unit_code')) = v_win_unit
          ORDER BY lower(trim(elem->>'secondary_unit_code')), elem
        ) w
      ),
      '[]'::jsonb
    ) INTO v_merged_conv;
  END IF;

  v_names := COALESCE(v_win.merged_catalog_names, '{}'::text[]);
  v_new_merged_names := '{}'::text[];
  IF NULLIF(btrim(v_lose.name), '') IS NOT NULL THEN
    v_names := array_append(v_names, btrim(v_lose.name));
    v_new_merged_names := array_append(v_new_merged_names, btrim(v_lose.name));
  END IF;
  IF NULLIF(btrim(v_lose.canonical_name), '') IS NOT NULL THEN
    v_names := array_append(v_names, btrim(v_lose.canonical_name));
    v_new_merged_names := array_append(v_new_merged_names, btrim(v_lose.canonical_name));
  END IF;
  IF COALESCE(array_length(v_lose.merged_catalog_names, 1), 0) > 0 THEN
    v_names := v_names || v_lose.merged_catalog_names;
    v_new_merged_names := v_new_merged_names || v_lose.merged_catalog_names;
  END IF;

  SELECT array_agg(DISTINCT n ORDER BY n)
  INTO v_names
  FROM unnest(v_names) AS n
  WHERE n IS NOT NULL AND btrim(n) <> '';

  SELECT array_agg(DISTINCT n ORDER BY n)
  INTO v_new_merged_names
  FROM unnest(v_new_merged_names) AS n
  WHERE n IS NOT NULL AND btrim(n) <> '';

  v_canon_lose := NULLIF(btrim(v_lose.canonical_name), '');
  IF v_canon_lose IS NULL AND NULLIF(btrim(v_lose.name), '') IS NOT NULL THEN
    v_canon_lose := public.normalize_invoice_product_label(v_lose.name);
  END IF;

  v_unit_lose := lower(btrim(COALESCE(v_lose.unit, 'un')));
  v_aliases_equiv_keys := '{}'::text[];
  v_aliases_invoice_labels := '{}'::text[];

  IF v_canon_lose IS NOT NULL AND length(v_canon_lose) >= 2 THEN
    v_aliases_equiv_keys := array_append(
      v_aliases_equiv_keys,
      v_canon_lose || '|' || v_unit_lose
    );
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
      updated_at = v_now;
  END IF;

  v_label := public.normalize_invoice_product_label(v_lose.name);
  IF v_label IS NOT NULL THEN
    v_aliases_invoice_labels := array_append(v_aliases_invoice_labels, v_label);
    INSERT INTO public.product_invoice_line_aliases (company_id, normalized_label, product_id)
    VALUES (p_company_id, v_label, p_winner_id)
    ON CONFLICT (company_id, normalized_label)
    DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = v_now;
  END IF;

  INSERT INTO public.stock_movements (
    product_id,
    company_id,
    quantity,
    type,
    reference_type,
    reference_id,
    metadata_json,
    created_at
  )
  VALUES (
    p_winner_id,
    p_company_id,
    ABS(v_qty_lose_adj),
    'in',
    'product_merge',
    v_event_id,
    jsonb_strip_nulls(jsonb_build_object(
      'movement_kind', 'product_merge',
      'quantity_unit', v_win.unit,
      'loser_id', p_loser_id,
      'loser_name', v_lose.name,
      'loser_to_winner_factor', v_factor,
      'stock_delta_winner_unit', v_qty_lose_adj,
      'registered_by_user_id', v_uid
    )),
    v_now
  )
  RETURNING id INTO v_merge_movement_id;

  v_event := jsonb_strip_nulls(jsonb_build_object(
    'id', v_event_id,
    'merged_at', v_now,
    'merged_by', v_uid,
    'loser_id', p_loser_id,
    'loser_name', v_lose.name,
    'loser_snapshot', v_loser_snapshot,
    'winner_before', v_winner_before,
    'loser_to_winner_factor', v_factor,
    'merged_unit_conversions', v_merged_conv,
    'stock_delta_winner_unit', v_qty_lose_adj,
    'affected', jsonb_build_object(
      'stock_movement_ids', to_jsonb(COALESCE(v_affected_stock_ids, '{}'::uuid[])),
      'expense_item_ids', to_jsonb(COALESCE(v_affected_expense_ids, '{}'::uuid[])),
      'revenue_entry_ids', to_jsonb(COALESCE(v_affected_revenue_ids, '{}'::uuid[])),
      'purchase_order_item_ids', to_jsonb(COALESCE(v_affected_purchase_ids, '{}'::uuid[])),
      'recipe_ingredient_ids', to_jsonb(COALESCE(v_affected_recipe_ingredient_ids, '{}'::uuid[])),
      'recipe_output_ids', to_jsonb(COALESCE(v_affected_recipe_output_ids, '{}'::uuid[])),
      'inventory_count_listing_ids_reassigned', to_jsonb(COALESCE(v_listing_ids_reassigned, '{}'::uuid[])),
      'inventory_count_listing_ids_removed', to_jsonb(COALESCE(v_listing_ids_removed, '{}'::uuid[])),
      'category_assignment_ids', to_jsonb(COALESCE(v_loser_category_ids, '{}'::uuid[])),
      'operational_config_id', v_operational_config_id
    ),
    'loser_operational_config', v_loser_operational_config,
    'stock_movements_before', v_stock_movements_before,
    'aliases_added', jsonb_build_object(
      'merged_catalog_names', to_jsonb(COALESCE(v_new_merged_names, '{}'::text[])),
      'import_equivalence_keys', to_jsonb(COALESCE(v_aliases_equiv_keys, '{}'::text[])),
      'invoice_line_labels', to_jsonb(COALESCE(v_aliases_invoice_labels, '{}'::text[]))
    ),
    'merge_movement_id', v_merge_movement_id,
    'undone_at', NULL,
    'undone_by', NULL
  ));

  UPDATE public.products SET
    current_quantity = COALESCE(v_qty_win, 0) + COALESCE(v_qty_lose_adj, 0),
    min_quantity = COALESCE(v_win.min_quantity, 0) + COALESCE(v_min_lose_adj, 0),
    unit_conversions = v_merged_conv,
    merged_catalog_names = COALESCE(v_names, '{}'::text[]),
    merge_audit = COALESCE(merge_audit, '[]'::jsonb)
      || COALESCE(v_lose.merge_audit, '[]'::jsonb)
      || jsonb_build_array(v_event),
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
    updated_at = v_now
  WHERE id = p_winner_id;

  DELETE FROM public.products WHERE id = p_loser_id;

  RETURN jsonb_build_object(
    'ok', true,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'merge_event_id', v_event_id,
    'merge_movement_id', v_merge_movement_id,
    'merged_names', COALESCE(v_names, '{}'::text[]),
    'loser_to_winner_factor', v_factor
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- undo_product_merge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.undo_product_merge(
  p_company_id UUID,
  p_event_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_winner_id UUID;
  v_event JSONB;
  v_loser_id UUID;
  v_loser_snapshot JSONB;
  v_winner_before JSONB;
  v_factor NUMERIC;
  v_now TIMESTAMPTZ := NOW();
  v_undo_movement_id UUID;
  v_stock_delta NUMERIC;
  v_mov_id TEXT;
  v_mov_data JSONB;
  v_exp_id UUID;
  v_rev_id UUID;
  v_poi_id UUID;
  v_ri_id UUID;
  v_ro_id UUID;
  v_listing_id UUID;
  v_cat_id UUID;
  v_equiv_key TEXT;
  v_equiv_parts TEXT[];
  v_inv_label TEXT;
  v_merge_mov_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT p.id, elem
  INTO v_winner_id, v_event
  FROM public.products p,
  LATERAL jsonb_array_elements(p.merge_audit) AS elem
  WHERE p.company_id = p_company_id
    AND elem->>'id' = p_event_id::text
    AND elem->>'undone_at' IS NULL
  LIMIT 1
  FOR UPDATE OF p;

  IF v_winner_id IS NULL OR v_event IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = (v_event->>'loser_id')::uuid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'loser_already_exists');
  END IF;

  v_loser_id := (v_event->>'loser_id')::uuid;
  v_loser_snapshot := v_event->'loser_snapshot';
  v_winner_before := v_event->'winner_before';
  v_factor := COALESCE((v_event->>'loser_to_winner_factor')::numeric, 1);
  v_stock_delta := COALESCE((v_event->>'stock_delta_winner_unit')::numeric, 0);
  v_merge_mov_id := NULLIF(v_event->>'merge_movement_id', '')::uuid;

  INSERT INTO public.products (
    id,
    company_id,
    name,
    sku,
    unit,
    min_quantity,
    current_quantity,
    last_unit_value,
    last_unit_value_unit_code,
    last_unit_value_stock,
    average_cost,
    barcode,
    ean,
    is_active,
    listed_in_product_catalog,
    composes_cmv,
    import_unit_raw,
    import_unit_needs_review,
    unit_conversions,
    merged_catalog_names,
    merge_audit,
    ncm,
    cfop,
    csosn,
    canonical_name,
    expiry_date,
    stock_lots,
    cmv_category_id,
    created_at,
    updated_at
  )
  VALUES (
    v_loser_id,
    p_company_id,
    COALESCE(v_loser_snapshot->>'name', 'Produto restaurado'),
    NULLIF(v_loser_snapshot->>'sku', ''),
    COALESCE(NULLIF(v_loser_snapshot->>'unit', ''), 'un'),
    COALESCE((v_loser_snapshot->>'min_quantity')::numeric, 0),
    COALESCE((v_loser_snapshot->>'current_quantity')::numeric, 0),
    NULLIF(v_loser_snapshot->>'last_unit_value', '')::numeric,
    NULLIF(v_loser_snapshot->>'last_unit_value_unit_code', ''),
    NULLIF(v_loser_snapshot->>'last_unit_value_stock', '')::numeric,
    NULLIF(v_loser_snapshot->>'average_cost', '')::numeric,
    NULLIF(v_loser_snapshot->>'barcode', ''),
    NULLIF(v_loser_snapshot->>'ean', ''),
    COALESCE((v_loser_snapshot->>'is_active')::boolean, true),
    COALESCE((v_loser_snapshot->>'listed_in_product_catalog')::boolean, true),
    COALESCE((v_loser_snapshot->>'composes_cmv')::boolean, true),
    NULLIF(v_loser_snapshot->>'import_unit_raw', ''),
    COALESCE((v_loser_snapshot->>'import_unit_needs_review')::boolean, false),
    COALESCE(v_loser_snapshot->'unit_conversions', '[]'::jsonb),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_loser_snapshot->'merged_catalog_names', '[]'::jsonb))),
      '{}'::text[]
    ),
    COALESCE(v_loser_snapshot->'merge_audit', '[]'::jsonb),
    NULLIF(v_loser_snapshot->>'ncm', ''),
    NULLIF(v_loser_snapshot->>'cfop', ''),
    NULLIF(v_loser_snapshot->>'csosn', ''),
    NULLIF(v_loser_snapshot->>'canonical_name', ''),
    NULLIF(v_loser_snapshot->>'expiry_date', '')::date,
    COALESCE(v_loser_snapshot->'stock_lots', '[]'::jsonb),
    NULLIF(v_loser_snapshot->>'cmv_category_id', '')::uuid,
    COALESCE((v_loser_snapshot->>'created_at')::timestamptz, v_now),
    v_now
  );

  UPDATE public.products SET
    current_quantity = COALESCE((v_winner_before->>'current_quantity')::numeric, current_quantity),
    min_quantity = COALESCE((v_winner_before->>'min_quantity')::numeric, min_quantity),
    unit_conversions = COALESCE(v_winner_before->'unit_conversions', unit_conversions),
    merged_catalog_names = COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_winner_before->'merged_catalog_names', '[]'::jsonb))),
      merged_catalog_names
    ),
    sku = NULLIF(v_winner_before->>'sku', ''),
    barcode = NULLIF(v_winner_before->>'barcode', ''),
    ean = NULLIF(v_winner_before->>'ean', ''),
    ncm = NULLIF(v_winner_before->>'ncm', ''),
    cfop = NULLIF(v_winner_before->>'cfop', ''),
    csosn = NULLIF(v_winner_before->>'csosn', ''),
    canonical_name = NULLIF(v_winner_before->>'canonical_name', ''),
    import_unit_raw = NULLIF(v_winner_before->>'import_unit_raw', ''),
    last_unit_value = NULLIF(v_winner_before->>'last_unit_value', '')::numeric,
    last_unit_value_unit_code = NULLIF(v_winner_before->>'last_unit_value_unit_code', ''),
    last_unit_value_stock = NULLIF(v_winner_before->>'last_unit_value_stock', '')::numeric,
    average_cost = NULLIF(v_winner_before->>'average_cost', '')::numeric,
    updated_at = v_now
  WHERE id = v_winner_id;

  FOR v_mov_id, v_mov_data IN
    SELECT key, value
    FROM jsonb_each(COALESCE(v_event->'stock_movements_before', '{}'::jsonb))
  LOOP
    UPDATE public.stock_movements sm
    SET
      product_id = (v_mov_data->>'product_id')::uuid,
      quantity = (v_mov_data->>'quantity')::numeric,
      metadata_json = COALESCE(sm.metadata_json, '{}'::jsonb) - 'product_merge'
    WHERE sm.id = v_mov_id::uuid;
  END LOOP;

  FOR v_exp_id IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'affected'->'expense_item_ids', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.expense_items ei
    SET
      product_id = v_loser_id,
      metadata_json = COALESCE(ei.metadata_json, '{}'::jsonb) - 'product_merge'
    WHERE ei.id = v_exp_id;
  END LOOP;

  FOR v_rev_id IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'affected'->'revenue_entry_ids', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.revenue_entries SET product_id = v_loser_id WHERE id = v_rev_id;
  END LOOP;

  FOR v_poi_id IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'affected'->'purchase_order_item_ids', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.purchase_order_items SET product_id = v_loser_id WHERE id = v_poi_id;
  END LOOP;

  FOR v_ri_id IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'affected'->'recipe_ingredient_ids', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.recipe_ingredients SET product_id = v_loser_id WHERE id = v_ri_id;
  END LOOP;

  FOR v_ro_id IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'affected'->'recipe_output_ids', '[]'::jsonb))::uuid
  LOOP
    UPDATE public.recipes SET output_product_id = v_loser_id WHERE id = v_ro_id;
  END LOOP;

  FOR v_listing_id IN
    SELECT jsonb_array_elements_text(
      COALESCE(v_event->'affected'->'inventory_count_listing_ids_reassigned', '[]'::jsonb)
    )::uuid
  LOOP
    UPDATE public.inventory_count_listing_products
    SET product_id = v_loser_id
    WHERE listing_id = v_listing_id AND product_id = v_winner_id;
  END LOOP;

  FOR v_listing_id IN
    SELECT jsonb_array_elements_text(
      COALESCE(v_event->'affected'->'inventory_count_listing_ids_removed', '[]'::jsonb)
    )::uuid
  LOOP
    INSERT INTO public.inventory_count_listing_products (listing_id, product_id)
    VALUES (v_listing_id, v_loser_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR v_cat_id IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'affected'->'category_assignment_ids', '[]'::jsonb))::uuid
  LOOP
    INSERT INTO public.product_category_assignments (product_id, category_id)
    VALUES (v_loser_id, v_cat_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF v_event->'loser_operational_config' IS NOT NULL
     AND v_event->'loser_operational_config' <> 'null'::jsonb THEN
    INSERT INTO public.product_operational_config (
      id,
      company_id,
      product_id,
      suggested_operational_type,
      suggested_score,
      suggestion_reasons,
      final_operational_type,
      final_decision_source,
      configuration_status,
      configuration_completeness,
      linked_entry_breakdown_recipe_id,
      notes,
      ui_filter_json,
      last_opened_product_id,
      last_edited_at,
      last_edited_by,
      created_at,
      updated_at
    )
    SELECT
      COALESCE((v_event->'loser_operational_config'->>'id')::uuid, gen_random_uuid()),
      p_company_id,
      v_loser_id,
      v_event->'loser_operational_config'->>'suggested_operational_type',
      COALESCE((v_event->'loser_operational_config'->>'suggested_score')::numeric, 0),
      COALESCE(v_event->'loser_operational_config'->'suggestion_reasons', '{}'::jsonb),
      NULLIF(v_event->'loser_operational_config'->>'final_operational_type', ''),
      NULLIF(v_event->'loser_operational_config'->>'final_decision_source', ''),
      COALESCE(v_event->'loser_operational_config'->>'configuration_status', 'PENDENTE'),
      COALESCE(v_event->'loser_operational_config'->'configuration_completeness', '{}'::jsonb),
      NULLIF(v_event->'loser_operational_config'->>'linked_entry_breakdown_recipe_id', '')::uuid,
      NULLIF(v_event->'loser_operational_config'->>'notes', ''),
      v_event->'loser_operational_config'->'ui_filter_json',
      NULLIF(v_event->'loser_operational_config'->>'last_opened_product_id', '')::uuid,
      NULLIF(v_event->'loser_operational_config'->>'last_edited_at', '')::timestamptz,
      NULLIF(v_event->'loser_operational_config'->>'last_edited_by', '')::uuid,
      COALESCE((v_event->'loser_operational_config'->>'created_at')::timestamptz, v_now),
      v_now
    ON CONFLICT (company_id, product_id) DO NOTHING;
  END IF;

  FOR v_equiv_key IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'aliases_added'->'import_equivalence_keys', '[]'::jsonb))
  LOOP
    v_equiv_parts := string_to_array(v_equiv_key, '|');
    IF array_length(v_equiv_parts, 1) >= 2 THEN
      DELETE FROM public.product_import_equivalences pie
      WHERE pie.company_id = p_company_id
        AND pie.source_canonical_name = v_equiv_parts[1]
        AND pie.source_unit_normalized = v_equiv_parts[2]
        AND pie.product_id = v_winner_id;
    END IF;
  END LOOP;

  FOR v_inv_label IN
    SELECT jsonb_array_elements_text(COALESCE(v_event->'aliases_added'->'invoice_line_labels', '[]'::jsonb))
  LOOP
    DELETE FROM public.product_invoice_line_aliases pila
    WHERE pila.company_id = p_company_id
      AND pila.normalized_label = v_inv_label
      AND pila.product_id = v_winner_id;
  END LOOP;

  IF v_merge_mov_id IS NOT NULL THEN
    UPDATE public.stock_movements
    SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('undone_at', v_now)
    WHERE id = v_merge_mov_id;
  END IF;

  INSERT INTO public.stock_movements (
    product_id,
    company_id,
    quantity,
    type,
    reference_type,
    reference_id,
    metadata_json,
    created_at
  )
  VALUES (
    v_winner_id,
    p_company_id,
    ABS(v_stock_delta),
    'out',
    'product_merge_undo',
    p_event_id,
    jsonb_strip_nulls(jsonb_build_object(
      'movement_kind', 'product_merge_undo',
      'loser_id', v_loser_id,
      'loser_name', v_event->>'loser_name',
      'restored_loser_id', v_loser_id,
      'registered_by_user_id', v_uid
    )),
    v_now
  )
  RETURNING id INTO v_undo_movement_id;

  UPDATE public.products p
  SET merge_audit = (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN elem->>'id' = p_event_id::text THEN
          elem || jsonb_build_object('undone_at', v_now, 'undone_by', v_uid, 'undo_movement_id', v_undo_movement_id)
        ELSE elem
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(p.merge_audit) AS elem
  )
  WHERE p.id = v_winner_id;

  RETURN jsonb_build_object(
    'ok', true,
    'winner_id', v_winner_id,
    'restored_loser_id', v_loser_id,
    'undo_movement_id', v_undo_movement_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.merge_company_products(UUID, UUID, UUID, NUMERIC, JSONB) IS
  'Unifica produtos com auditoria em merge_audit, legado em movimentaÃ§Ãµes/despesas e movimentaÃ§Ã£o product_merge.';

COMMENT ON FUNCTION public.undo_product_merge(UUID, UUID) IS
  'Desfaz unificaÃ§Ã£o registrada em merge_audit do produto vencedor.';

GRANT EXECUTE ON FUNCTION public.merge_company_products(UUID, UUID, UUID, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_product_merge(UUID, UUID) TO authenticated;

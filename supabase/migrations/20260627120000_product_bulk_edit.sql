-- Edição em lote de produtos (v1): NCM, categorias, ativo, CMV, tipo operacional.
-- Preview, apply transacional, auditoria e undo (24h, última operação).

CREATE TABLE IF NOT EXISTS public.product_bulk_edit_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  undone_at TIMESTAMPTZ NULL,
  field_key TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_ids UUID[] NOT NULL,
  item_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_bulk_edit_operations_company_created
  ON public.product_bulk_edit_operations (company_id, created_at DESC);

COMMENT ON TABLE public.product_bulk_edit_operations IS
  'Auditoria de edições em lote no cadastro de produtos; suporta desfazer a última operação em 24h.';

ALTER TABLE public.product_bulk_edit_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestor reads bulk edit operations in company"
  ON public.product_bulk_edit_operations;
CREATE POLICY "Gestor reads bulk edit operations in company"
  ON public.product_bulk_edit_operations FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT uc.company_id FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
        AND uc.role IN ('gestor', 'owner')
    )
  );

GRANT SELECT ON public.product_bulk_edit_operations TO authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (v1)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._bulk_edit_assert_gestor(p_company_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid
      AND uc.company_id = p_company_id
      AND uc.role IN ('gestor', 'owner')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public._bulk_edit_max_products()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 500;
$$;

CREATE OR REPLACE FUNCTION public._bulk_edit_is_allowed_field(p_field_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_field_key IN (
    'ncm',
    'product_categories',
    'is_active',
    'composes_cmv',
    'cmv_category_id',
    'operational_type'
  );
$$;

CREATE OR REPLACE FUNCTION public._bulk_edit_load_item_snapshot(
  p_company_id UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod JSONB;
  v_cat_ids JSONB;
  v_cfg JSONB;
BEGIN
  SELECT to_jsonb(p.*) INTO v_prod
  FROM public.products p
  WHERE p.id = p_product_id AND p.company_id = p_company_id;

  IF v_prod IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(pca.category_id ORDER BY pca.category_id), '[]'::jsonb)
  INTO v_cat_ids
  FROM public.product_category_assignments pca
  WHERE pca.product_id = p_product_id;

  SELECT to_jsonb(c.*) INTO v_cfg
  FROM public.product_operational_config c
  WHERE c.company_id = p_company_id AND c.product_id = p_product_id;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'product', v_prod,
    'category_ids', v_cat_ids,
    'operational_config', v_cfg,
    'side_effects', '{}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._bulk_edit_preview_item(
  p_field_key TEXT,
  p_snapshot JSONB,
  p_changes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_prod JSONB;
  v_name TEXT;
  v_before TEXT;
  v_after TEXT;
  v_after_val JSONB;
  v_mode TEXT;
  v_cat_ids JSONB;
  v_current_cats JSONB;
  v_result JSONB;
BEGIN
  v_prod := p_snapshot->'product';
  v_name := COALESCE(v_prod->>'name', 'Produto');

  CASE p_field_key
    WHEN 'product_categories' THEN
      v_before := COALESCE(p_snapshot->'category_ids', '[]'::jsonb)::text;
      v_mode := COALESCE(p_changes->>'mode', 'replace');
      v_cat_ids := COALESCE(p_changes->'category_ids', '[]'::jsonb);
      v_current_cats := COALESCE(p_snapshot->'category_ids', '[]'::jsonb);
      IF v_mode = 'replace' THEN
        v_after := v_cat_ids::text;
      ELSIF v_mode = 'add' THEN
        SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
        INTO v_result
        FROM (
          SELECT jsonb_array_elements_text(v_current_cats) AS elem
          UNION
          SELECT jsonb_array_elements_text(v_cat_ids) AS elem
        ) s;
        v_after := v_result::text;
      ELSE
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        INTO v_result
        FROM (
          SELECT jsonb_array_elements_text(v_current_cats) AS elem
          EXCEPT
          SELECT jsonb_array_elements_text(v_cat_ids) AS elem
        ) s;
        v_after := v_result::text;
      END IF;
    WHEN 'operational_type' THEN
      v_before := COALESCE(
        p_snapshot->'operational_config'->>'final_operational_type',
        p_snapshot->'operational_config'->>'suggested_operational_type',
        '—'
      );
      v_after := COALESCE(p_changes->>'value', '—');
    WHEN 'is_active' THEN
      v_before := CASE WHEN COALESCE((v_prod->>'is_active')::boolean, true) THEN 'Sim' ELSE 'Não' END;
      v_after := CASE WHEN (p_changes->>'value')::boolean THEN 'Sim' ELSE 'Não' END;
    WHEN 'composes_cmv' THEN
      v_before := CASE WHEN COALESCE((v_prod->>'composes_cmv')::boolean, true) THEN 'Sim' ELSE 'Não' END;
      v_after := CASE WHEN (p_changes->>'value')::boolean THEN 'Sim' ELSE 'Não' END;
    WHEN 'cmv_category_id' THEN
      v_before := COALESCE(v_prod->>'cmv_category_id', '—');
      v_after := COALESCE(p_changes->>'value', '—');
    WHEN 'ncm' THEN
      v_before := COALESCE(v_prod->>'ncm', '—');
      v_after := COALESCE(p_changes->>'value', '—');
    ELSE
      v_before := '—';
      v_after := '—';
  END CASE;

  RETURN jsonb_build_object(
    'product_id', p_snapshot->>'product_id',
    'product_name', v_name,
    'before', v_before,
    'after', v_after,
    'warnings', '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._bulk_edit_apply_one(
  p_company_id UUID,
  p_product_id UUID,
  p_field_key TEXT,
  p_changes JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bool BOOLEAN;
  v_uuid UUID;
  v_mode TEXT;
  v_cat_ids UUID[];
  v_cat UUID;
  v_op_type TEXT;
  v_ncm TEXT;
  v_lock UUID;
BEGIN
  IF NOT public._bulk_edit_is_allowed_field(p_field_key) THEN
    RAISE EXCEPTION 'invalid_field';
  END IF;

  SELECT id INTO v_lock FROM public.products
  WHERE id = p_product_id AND company_id = p_company_id
  FOR UPDATE;

  IF v_lock IS NULL THEN
    RETURN;
  END IF;

  CASE p_field_key
    WHEN 'product_categories' THEN
      v_mode := COALESCE(p_changes->>'mode', 'replace');
      SELECT ARRAY(
        SELECT (jsonb_array_elements_text(COALESCE(p_changes->'category_ids', '[]'::jsonb)))::uuid
      ) INTO v_cat_ids;

      IF v_mode = 'replace' THEN
        DELETE FROM public.product_category_assignments WHERE product_id = p_product_id;
        FOREACH v_cat IN ARRAY v_cat_ids LOOP
          INSERT INTO public.product_category_assignments (company_id, product_id, category_id)
          VALUES (p_company_id, p_product_id, v_cat)
          ON CONFLICT DO NOTHING;
        END LOOP;
      ELSIF v_mode = 'add' THEN
        FOREACH v_cat IN ARRAY v_cat_ids LOOP
          INSERT INTO public.product_category_assignments (company_id, product_id, category_id)
          VALUES (p_company_id, p_product_id, v_cat)
          ON CONFLICT DO NOTHING;
        END LOOP;
      ELSIF v_mode = 'remove' THEN
        DELETE FROM public.product_category_assignments pca
        WHERE pca.product_id = p_product_id
          AND pca.category_id = ANY(v_cat_ids);
      END IF;

    WHEN 'operational_type' THEN
      v_op_type := NULLIF(trim(p_changes->>'value'), '');
      IF v_op_type IS NOT NULL THEN
        PERFORM public.bulk_set_product_operational_type(
          p_company_id,
          ARRAY[p_product_id],
          v_op_type,
          'USER_EDITED'
        );
      END IF;

    WHEN 'is_active', 'composes_cmv' THEN
      v_bool := (p_changes->>'value')::boolean;
      IF p_field_key = 'is_active' THEN
        UPDATE public.products SET is_active = v_bool, updated_at = now()
        WHERE id = p_product_id;
      ELSE
        UPDATE public.products SET composes_cmv = v_bool, updated_at = now()
        WHERE id = p_product_id;
      END IF;

    WHEN 'cmv_category_id' THEN
      v_uuid := NULLIF(trim(p_changes->>'value'), '')::uuid;
      UPDATE public.products SET cmv_category_id = v_uuid, updated_at = now()
      WHERE id = p_product_id;

    WHEN 'ncm' THEN
      v_ncm := NULLIF(trim(p_changes->>'value'), '');
      UPDATE public.products SET ncm = v_ncm, updated_at = now()
      WHERE id = p_product_id;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public._bulk_edit_restore_snapshot(
  p_company_id UUID,
  p_item JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid UUID;
  v_prod JSONB;
  v_cat_ids JSONB;
  v_cat UUID;
  v_cfg JSONB;
BEGIN
  v_pid := (p_item->>'product_id')::uuid;
  v_prod := p_item->'product';

  IF v_prod IS NULL OR v_pid IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.products SET
    name = v_prod->>'name',
    sku = NULLIF(v_prod->>'sku', ''),
    unit = v_prod->>'unit',
    min_quantity = COALESCE((v_prod->>'min_quantity')::numeric, 0),
    current_quantity = COALESCE((v_prod->>'current_quantity')::numeric, 0),
    is_active = COALESCE((v_prod->>'is_active')::boolean, true),
    barcode = NULLIF(v_prod->>'barcode', ''),
    ean = NULLIF(v_prod->>'ean', ''),
    composes_cmv = COALESCE((v_prod->>'composes_cmv')::boolean, true),
    cmv_category_id = NULLIF(v_prod->>'cmv_category_id', '')::uuid,
    last_unit_value = NULLIF(v_prod->>'last_unit_value', '')::numeric,
    last_unit_value_unit_code = NULLIF(v_prod->>'last_unit_value_unit_code', ''),
    last_unit_value_stock = NULLIF(v_prod->>'last_unit_value_stock', '')::numeric,
    average_cost = NULLIF(v_prod->>'average_cost', '')::numeric,
    ncm = NULLIF(v_prod->>'ncm', ''),
    cfop = NULLIF(v_prod->>'cfop', ''),
    csosn = NULLIF(v_prod->>'csosn', ''),
    import_unit_raw = NULLIF(v_prod->>'import_unit_raw', ''),
    import_unit_needs_review = COALESCE((v_prod->>'import_unit_needs_review')::boolean, false),
    updated_at = now()
  WHERE id = v_pid AND company_id = p_company_id;

  v_cat_ids := COALESCE(p_item->'category_ids', '[]'::jsonb);
  DELETE FROM public.product_category_assignments WHERE product_id = v_pid;
  FOR v_cat IN
    SELECT (jsonb_array_elements_text(v_cat_ids))::uuid
  LOOP
    INSERT INTO public.product_category_assignments (company_id, product_id, category_id)
    VALUES (p_company_id, v_pid, v_cat)
    ON CONFLICT DO NOTHING;
  END LOOP;

  v_cfg := p_item->'operational_config';
  IF v_cfg IS NOT NULL AND v_cfg <> 'null'::jsonb THEN
    DELETE FROM public.product_operational_config
    WHERE company_id = p_company_id AND product_id = v_pid;

    INSERT INTO public.product_operational_config (
      id, company_id, product_id,
      suggested_operational_type, suggested_score, suggestion_reasons,
      final_operational_type, final_decision_source,
      configuration_status, configuration_completeness,
      linked_entry_breakdown_recipe_id, notes, ui_filter_json,
      last_opened_product_id, last_edited_at, last_edited_by,
      created_at, updated_at
    )
    VALUES (
      COALESCE((v_cfg->>'id')::uuid, gen_random_uuid()),
      p_company_id,
      v_pid,
      v_cfg->>'suggested_operational_type',
      COALESCE((v_cfg->>'suggested_score')::numeric, 0),
      COALESCE(v_cfg->'suggestion_reasons', '{}'::jsonb),
      NULLIF(v_cfg->>'final_operational_type', ''),
      NULLIF(v_cfg->>'final_decision_source', ''),
      COALESCE(v_cfg->>'configuration_status', 'PENDENTE'),
      COALESCE(v_cfg->'configuration_completeness', '{}'::jsonb),
      NULLIF(v_cfg->>'linked_entry_breakdown_recipe_id', '')::uuid,
      NULLIF(v_cfg->>'notes', ''),
      v_cfg->'ui_filter_json',
      NULLIF(v_cfg->>'last_opened_product_id', '')::uuid,
      NULLIF(v_cfg->>'last_edited_at', '')::timestamptz,
      NULLIF(v_cfg->>'last_edited_by', '')::uuid,
      COALESCE((v_cfg->>'created_at')::timestamptz, now()),
      now()
    );
  ELSE
    DELETE FROM public.product_operational_config
    WHERE company_id = p_company_id AND product_id = v_pid;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- preview_product_bulk_edit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_product_bulk_edit(
  p_company_id UUID,
  p_product_ids UUID[],
  p_field_key TEXT,
  p_changes JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_max INT;
  v_pid UUID;
  v_snap JSONB;
  v_items JSONB := '[]'::jsonb;
  v_count INT := 0;
  v_preview_limit INT := 100;
BEGIN
  BEGIN
    v_uid := public._bulk_edit_assert_gestor(p_company_id);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  IF NOT public._bulk_edit_is_allowed_field(p_field_key) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_field');
  END IF;

  v_max := public._bulk_edit_max_products();
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_selection');
  END IF;
  IF array_length(p_product_ids, 1) > v_max THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_products', 'max', v_max);
  END IF;

  FOREACH v_pid IN ARRAY p_product_ids
  LOOP
    v_snap := public._bulk_edit_load_item_snapshot(p_company_id, v_pid);
    IF v_snap IS NULL THEN
      CONTINUE;
    END IF;
    v_count := v_count + 1;
    IF v_count <= v_preview_limit THEN
      v_items := v_items || public._bulk_edit_preview_item(p_field_key, v_snap, p_changes);
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_valid_products');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'items', v_items,
    'total_count', v_count,
    'preview_limit', v_preview_limit,
    'truncated', v_count > v_preview_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_product_bulk_edit(UUID, UUID[], TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- apply_product_bulk_edit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_product_bulk_edit(
  p_company_id UUID,
  p_product_ids UUID[],
  p_field_key TEXT,
  p_changes JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_max INT;
  v_pid UUID;
  v_snap JSONB;
  v_snaps JSONB := '[]'::jsonb;
  v_count INT := 0;
  v_op_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  BEGIN
    v_uid := public._bulk_edit_assert_gestor(p_company_id);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  IF NOT public._bulk_edit_is_allowed_field(p_field_key) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_field');
  END IF;

  v_max := public._bulk_edit_max_products();
  IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_selection');
  END IF;
  IF array_length(p_product_ids, 1) > v_max THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_products', 'max', v_max);
  END IF;

  FOREACH v_pid IN ARRAY p_product_ids
  LOOP
    v_snap := public._bulk_edit_load_item_snapshot(p_company_id, v_pid);
    IF v_snap IS NULL THEN
      CONTINUE;
    END IF;
    PERFORM public._bulk_edit_apply_one(p_company_id, v_pid, p_field_key, p_changes);
    v_snaps := v_snaps || v_snap;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_valid_products');
  END IF;

  INSERT INTO public.product_bulk_edit_operations (
    company_id,
    created_by,
    created_at,
    expires_at,
    field_key,
    changes,
    product_ids,
    item_snapshots,
    updated_count
  )
  VALUES (
    p_company_id,
    v_uid,
    v_now,
    v_now + interval '24 hours',
    p_field_key,
    p_changes,
    p_product_ids,
    v_snaps,
    v_count
  )
  RETURNING id INTO v_op_id;

  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', v_op_id,
    'updated_count', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_product_bulk_edit(UUID, UUID[], TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_undoable_product_bulk_edit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_undoable_product_bulk_edit(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_row public.product_bulk_edit_operations%ROWTYPE;
BEGIN
  BEGIN
    v_uid := public._bulk_edit_assert_gestor(p_company_id);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  SELECT * INTO v_row
  FROM public.product_bulk_edit_operations o
  WHERE o.company_id = p_company_id
    AND o.undone_at IS NULL
    AND o.expires_at > now()
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'operation', NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'operation', jsonb_build_object(
      'id', v_row.id,
      'field_key', v_row.field_key,
      'changes', v_row.changes,
      'updated_count', v_row.updated_count,
      'created_at', v_row.created_at,
      'expires_at', v_row.expires_at
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_undoable_product_bulk_edit(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- undo_product_bulk_edit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.undo_product_bulk_edit(
  p_company_id UUID,
  p_operation_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_row public.product_bulk_edit_operations%ROWTYPE;
  v_latest_id UUID;
  v_item JSONB;
BEGIN
  BEGIN
    v_uid := public._bulk_edit_assert_gestor(p_company_id);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  SELECT id INTO v_latest_id
  FROM public.product_bulk_edit_operations
  WHERE company_id = p_company_id
    AND undone_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT * INTO v_row
  FROM public.product_bulk_edit_operations
  WHERE id = p_operation_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'operation_not_found');
  END IF;

  IF v_row.undone_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_undone');
  END IF;

  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_latest_id IS DISTINCT FROM p_operation_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_latest_operation');
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(v_row.item_snapshots)
  LOOP
    PERFORM public._bulk_edit_restore_snapshot(p_company_id, v_item);
  END LOOP;

  UPDATE public.product_bulk_edit_operations
  SET undone_at = now()
  WHERE id = p_operation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'restored_count', v_row.updated_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_product_bulk_edit(UUID, UUID) TO authenticated;

-- Rascunho de ficha de entrada (IA assistida) para itens importados.

CREATE TABLE IF NOT EXISTS public.import_recipe_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  expense_item_id UUID NOT NULL REFERENCES public.expense_items(id) ON DELETE CASCADE,
  source_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED')),
  confidence_0_1 NUMERIC(6, 4),
  llm_provider TEXT,
  llm_model TEXT,
  reasons_json JSONB,
  approved_recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_recipe_drafts_item
  ON public.import_recipe_drafts(expense_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.import_recipe_draft_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.import_recipe_drafts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  raw_component_name TEXT NOT NULL,
  suggested_quantity NUMERIC(14, 6) NOT NULL CHECK (suggested_quantity > 0),
  suggested_unit TEXT,
  loss_factor NUMERIC(10, 6) NOT NULL DEFAULT 1 CHECK (loss_factor > 0),
  confidence_0_1 NUMERIC(6, 4),
  match_reason TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_import_recipe_draft_components_draft
  ON public.import_recipe_draft_components(draft_id, sort_order, id);

ALTER TABLE public.import_recipe_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_recipe_draft_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members manage import recipe drafts" ON public.import_recipe_drafts;
CREATE POLICY "Company members manage import recipe drafts"
  ON public.import_recipe_drafts FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members manage import recipe draft components" ON public.import_recipe_draft_components;
CREATE POLICY "Company members manage import recipe draft components"
  ON public.import_recipe_draft_components FOR ALL
  USING (
    draft_id IN (
      SELECT d.id
      FROM public.import_recipe_drafts d
      WHERE d.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    draft_id IN (
      SELECT d.id
      FROM public.import_recipe_drafts d
      WHERE d.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  );

GRANT ALL ON public.import_recipe_drafts TO authenticated;
GRANT ALL ON public.import_recipe_draft_components TO authenticated;

CREATE OR REPLACE FUNCTION public.get_import_recipe_draft_for_recebimento(
  p_token UUID,
  p_expense_item_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_draft RECORD;
BEGIN
  SELECT e.company_id
  INTO v_company_id
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  JOIN public.expense_items ei ON ei.expense_id = e.id
  WHERE r.token = p_token
    AND r.status <> 'received'
    AND ei.id = p_expense_item_id;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_or_item');
  END IF;

  SELECT d.*
  INTO v_draft
  FROM public.import_recipe_drafts d
  WHERE d.expense_item_id = p_expense_item_id
  ORDER BY d.created_at DESC
  LIMIT 1;

  IF v_draft.id IS NULL THEN
    RETURN json_build_object('ok', true, 'draft', NULL);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'draft', json_build_object(
      'id', v_draft.id,
      'status', v_draft.status,
      'confidence_0_1', v_draft.confidence_0_1,
      'llm_provider', v_draft.llm_provider,
      'llm_model', v_draft.llm_model,
      'reasons_json', v_draft.reasons_json,
      'approved_recipe_id', v_draft.approved_recipe_id,
      'components', COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', c.id,
              'product_id', c.product_id,
              'raw_component_name', c.raw_component_name,
              'suggested_quantity', c.suggested_quantity,
              'suggested_unit', c.suggested_unit,
              'loss_factor', c.loss_factor,
              'confidence_0_1', c.confidence_0_1,
              'match_reason', c.match_reason,
              'sort_order', c.sort_order,
              'product_name', p.name
            )
            ORDER BY c.sort_order, c.id
          )
          FROM public.import_recipe_draft_components c
          LEFT JOIN public.products p ON p.id = c.product_id
          WHERE c.draft_id = v_draft.id
        ),
        '[]'::json
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_import_recipe_draft_for_recebimento(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_import_recipe_draft_for_recebimento(
  p_token UUID,
  p_draft_id UUID,
  p_recipe_name TEXT,
  p_batch_yield NUMERIC DEFAULT 1,
  p_output_product_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_supplier_id UUID;
  v_expense_item_id UUID;
  v_item_name TEXT;
  v_item_product_id UUID;
  v_recipe_id UUID;
  v_inserted_count INTEGER := 0;
  v_draft_status TEXT;
BEGIN
  SELECT
    e.company_id,
    e.supplier_id,
    ei.id,
    ei.product_name,
    ei.product_id,
    d.status
  INTO
    v_company_id,
    v_supplier_id,
    v_expense_item_id,
    v_item_name,
    v_item_product_id,
    v_draft_status
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  JOIN public.expense_items ei ON ei.expense_id = e.id
  JOIN public.import_recipe_drafts d ON d.expense_item_id = ei.id
  WHERE r.token = p_token
    AND r.status <> 'received'
    AND d.id = p_draft_id;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_or_draft');
  END IF;

  IF v_draft_status IS DISTINCT FROM 'DRAFT' THEN
    RETURN json_build_object('ok', false, 'error', 'draft_not_pending');
  END IF;

  INSERT INTO public.recipes (
    company_id,
    name,
    output_product_id,
    batch_yield,
    active,
    recipe_type,
    version
  ) VALUES (
    v_company_id,
    COALESCE(NULLIF(btrim(p_recipe_name), ''), 'Ficha de entrada'),
    p_output_product_id,
    GREATEST(COALESCE(p_batch_yield, 1), 0.0001),
    true,
    'ENTRY_BREAKDOWN',
    1
  )
  RETURNING id INTO v_recipe_id;

  INSERT INTO public.recipe_ingredients (
    recipe_id,
    product_id,
    quantity,
    input_quantity,
    input_unit_code,
    loss_factor,
    sort_order
  )
  SELECT
    v_recipe_id,
    c.product_id,
    c.suggested_quantity,
    c.suggested_quantity,
    COALESCE(NULLIF(btrim(c.suggested_unit), ''), p.unit),
    COALESCE(c.loss_factor, 1),
    c.sort_order
  FROM public.import_recipe_draft_components c
  JOIN public.products p ON p.id = c.product_id
  WHERE c.draft_id = p_draft_id
    AND c.product_id IS NOT NULL
    AND c.suggested_quantity > 0
  ON CONFLICT (recipe_id, product_id) DO UPDATE SET
    quantity = EXCLUDED.quantity,
    input_quantity = EXCLUDED.input_quantity,
    input_unit_code = EXCLUDED.input_unit_code,
    loss_factor = EXCLUDED.loss_factor,
    sort_order = EXCLUDED.sort_order;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'draft_without_valid_components');
  END IF;

  UPDATE public.expense_items
  SET
    import_stock_resolution = 'EXPLODE_BY_RECIPE',
    resolved_entry_breakdown_recipe_id = v_recipe_id,
    import_pending_resolution = false,
    import_nature = 'EXPLODIR_POR_FICHA',
    import_engine_suggestion = 'AUTO_APPLY_EXPLODIR_FICHA'
  WHERE id = v_expense_item_id;

  UPDATE public.import_recipe_drafts
  SET
    status = 'APPROVED',
    approved_recipe_id = v_recipe_id,
    updated_at = NOW()
  WHERE id = p_draft_id;

  INSERT INTO public.import_item_resolution_audit_logs (
    company_id,
    expense_item_id,
    previous_status,
    new_status,
    applied_resolution_mode,
    applied_recipe_id,
    recipe_version,
    user_id,
    notes
  ) VALUES (
    v_company_id,
    v_expense_item_id,
    'DRAFT_PENDING',
    'DRAFT_APPROVED',
    'EXPLODE_BY_RECIPE',
    v_recipe_id,
    1,
    auth.uid(),
    'Ficha criada por aprovação de rascunho IA'
  );

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.upsert_import_item_resolution_rule(
      v_company_id,
      v_supplier_id,
      public.normalize_invoice_product_label(COALESCE(v_item_name, '')),
      'EXPLODE_BY_RECIPE',
      v_item_product_id,
      v_recipe_id,
      true,
      NULL,
      NULL
    );
  END IF;

  RETURN json_build_object('ok', true, 'recipe_id', v_recipe_id, 'components', v_inserted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_import_recipe_draft_for_recebimento(UUID, UUID, TEXT, NUMERIC, UUID) TO anon, authenticated;

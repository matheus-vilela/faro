DROP FUNCTION IF EXISTS public.preview_import_recipe_breakdown(uuid, uuid);

-- Camada de resolução de itens importados (NF-e / XML): natureza, ficha de entrada (desmonte),
-- regras aprendidas, auditoria, preview e explosão de estoque no recebimento.
--
-- Pontos críticos de negócio:
-- - Despesa (financeiro) permanece na linha comercial do XML; estoque segue import_stock_resolution.
-- - EXPLODE_BY_RECIPE usa receitas com recipe_type = ENTRY_BREAKDOWN (não confundir com SALE).
-- - Não aplicar explosão automática com receita inativa ou score abaixo do limiar (motor na borda).
-- - confirmar_recebimento aplica entrada direta OU componentes; nunca ambos para a mesma linha.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_control_type TEXT NOT NULL DEFAULT 'DIRECT'
    CHECK (stock_control_type IN ('DIRECT', 'RECIPE_CONTROLLED', 'COMPOSITE', 'SERVICE'));

COMMENT ON COLUMN public.products.stock_control_type IS
  'DIRECT = SKU de estoque; RECIPE_CONTROLLED = item operacional ligado a ficha; COMPOSITE = composto; SERVICE = sem estoque físico.';

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS recipe_type TEXT NOT NULL DEFAULT 'SALE'
    CHECK (recipe_type IN ('SALE', 'ENTRY_BREAKDOWN', 'PREP', 'PRODUCTION'));

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

COMMENT ON COLUMN public.recipes.recipe_type IS
  'SALE = baixa na venda; ENTRY_BREAKDOWN = desmonte/entrada de insumos a partir do item comprado; PREP/PRODUCTION = preparo.';

COMMENT ON COLUMN public.recipes.version IS
  'Versão lógica da ficha; auditada em import_item_resolution_audit_logs ao aplicar explosão.';

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS loss_factor NUMERIC(10, 6) NOT NULL DEFAULT 1
    CHECK (loss_factor > 0);

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.recipe_ingredients.loss_factor IS
  'Multiplicador aplicado após conversão à unidade de estoque (1 = sem perda extra).';

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS metadata_json JSONB;

COMMENT ON COLUMN public.stock_movements.metadata_json IS
  'Rastreabilidade (ex.: explosão por import, component_product_id, expense_item_id).';

CREATE TABLE IF NOT EXISTS public.import_item_resolution_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  raw_description_pattern TEXT,
  normalized_description TEXT,
  ean TEXT,
  ncm TEXT,
  resolution_mode TEXT NOT NULL
    CHECK (resolution_mode IN ('DIRECT_STOCK_ENTRY', 'EXPLODE_BY_RECIPE', 'REVIEW_REQUIRED')),
  target_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  target_recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  confidence_override NUMERIC(5, 4),
  auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
  learned_from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT import_resolution_rule_recipe_when_explode CHECK (
    (resolution_mode <> 'EXPLODE_BY_RECIPE') OR (target_recipe_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_import_resolution_rules_supplier_norm
  ON public.import_item_resolution_rules (company_id, supplier_id, normalized_description)
  WHERE supplier_id IS NOT NULL AND normalized_description IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_resolution_rules_company
  ON public.import_item_resolution_rules (company_id);

COMMENT ON TABLE public.import_item_resolution_rules IS
  'Aprendizado por fornecedor/item: reaplicar DIRECT ou EXPLODE na próxima importação quando auto_apply.';

ALTER TABLE public.import_item_resolution_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members manage import resolution rules" ON public.import_item_resolution_rules;

CREATE POLICY "Company members manage import resolution rules"
  ON public.import_item_resolution_rules FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.import_item_resolution_rules TO authenticated;

CREATE TABLE IF NOT EXISTS public.import_item_resolution_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  expense_item_id UUID NOT NULL REFERENCES public.expense_items(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT,
  applied_resolution_mode TEXT,
  applied_rule_id UUID REFERENCES public.import_item_resolution_rules(id) ON DELETE SET NULL,
  applied_recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL,
  recipe_version INTEGER,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  score_reasons_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_resolution_audit_expense_item
  ON public.import_item_resolution_audit_logs (expense_item_id);

ALTER TABLE public.import_item_resolution_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members read import resolution audit" ON public.import_item_resolution_audit_logs;

CREATE POLICY "Company members read import resolution audit"
  ON public.import_item_resolution_audit_logs FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Company members insert import resolution audit" ON public.import_item_resolution_audit_logs;

CREATE POLICY "Company members insert import resolution audit"
  ON public.import_item_resolution_audit_logs FOR INSERT
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.import_item_resolution_audit_logs TO authenticated;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_nature TEXT
    CHECK (
      import_nature IS NULL OR import_nature IN (
        'INSUMO',
        'ESTOQUE_DIRETO',
        'COMPOSTO',
        'EXPLODIR_POR_FICHA',
        'REVISAO_MANUAL'
      )
    );

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_engine_suggestion TEXT;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_confidence_0_1 NUMERIC(6, 4);

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_score_reasons_json JSONB;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_stock_resolution TEXT
    CHECK (
      import_stock_resolution IS NULL OR import_stock_resolution IN ('DIRECT', 'EXPLODE_BY_RECIPE')
    );

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS resolved_entry_breakdown_recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_pending_resolution BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_applied_rule_id UUID REFERENCES public.import_item_resolution_rules(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.expense_items.import_engine_suggestion IS
  'AUTO_MATCH_INSUMO | AUTO_MATCH_ESTOQUE_DIRETO | AUTO_SUGESTAO_EXPLODIR_FICHA | REVISAO_MANUAL';

COMMENT ON COLUMN public.expense_items.import_stock_resolution IS
  'DIRECT = entrada no product_id; EXPLODE_BY_RECIPE = entrada nos ingredientes da ficha ENTRY_BREAKDOWN.';

COMMENT ON COLUMN public.expense_items.import_pending_resolution IS
  'True quando o recebimento deve aguardar conferência humana antes de aplicar estoque.';

-- ---------------------------------------------------------------------------
-- Preview: componentes e custo rateado (teórico) para uma linha + ficha.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_import_recipe_breakdown(
  p_expense_item_id UUID,
  p_recipe_id UUID,
  p_recebimento_token UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_qty NUMERIC;
  v_stock_qty NUMERIC;
  v_uv NUMERIC;
  v_batch NUMERIC;
  v_scale NUMERIC;
  v_rec_active BOOLEAN;
  v_rec_type TEXT;
  v_rec_ver INTEGER;
  v_line_total NUMERIC;
  v_sum_need NUMERIC := 0;
  v_ing RECORD;
  v_per NUMERIC;
  v_need NUMERIC;
  v_components JSONB := '[]'::jsonb;
  v_row JSONB;
  v_token_ok BOOLEAN;
BEGIN
  SELECT e.company_id, ei.quantity, COALESCE(ei.stock_quantity, ei.quantity), ei.unit_value
  INTO v_company, v_qty, v_stock_qty, v_uv
  FROM public.expense_items ei
  JOIN public.expenses e ON e.id = ei.expense_id
  WHERE ei.id = p_expense_item_id;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expense_item_not_found');
  END IF;

  IF p_recebimento_token IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.recebimentos r
      WHERE r.token = p_recebimento_token
        AND r.expense_id = (SELECT expense_id FROM public.expense_items WHERE id = p_expense_item_id)
        AND r.status <> 'received'
    )
    INTO v_token_ok;
    IF NOT COALESCE(v_token_ok, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSIF auth.uid() IS NULL OR v_company NOT IN (
    SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT r.batch_yield, r.active, r.recipe_type, r.version
  INTO v_batch, v_rec_active, v_rec_type, v_rec_ver
  FROM public.recipes r
  WHERE r.id = p_recipe_id AND r.company_id = v_company;

  IF v_batch IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  IF v_rec_type IS DISTINCT FROM 'ENTRY_BREAKDOWN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_type_must_be_entry_breakdown');
  END IF;

  v_scale := v_stock_qty / NULLIF(v_batch, 0);
  v_line_total := COALESCE(v_qty * v_uv, 0);

  FOR v_ing IN
    SELECT
      ri.product_id,
      ri.quantity,
      ri.input_quantity,
      ri.input_unit_code,
      ri.loss_factor,
      p.name AS product_name,
      p.unit AS stock_unit
    FROM public.recipe_ingredients ri
    JOIN public.products p ON p.id = ri.product_id
    WHERE ri.recipe_id = p_recipe_id
    ORDER BY ri.sort_order, ri.id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id,
      v_ing.quantity,
      v_ing.input_quantity,
      v_ing.input_unit_code
    );
    IF v_per IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'missing_conversion',
        'product_id', v_ing.product_id,
        'product_name', v_ing.product_name
      );
    END IF;
    v_need := v_per * v_scale * COALESCE(v_ing.loss_factor, 1);
    IF v_need > 0 THEN
      v_sum_need := v_sum_need + v_need;
    END IF;
  END LOOP;

  FOR v_ing IN
    SELECT
      ri.product_id,
      ri.quantity,
      ri.input_quantity,
      ri.input_unit_code,
      ri.loss_factor,
      p.name AS product_name,
      p.unit AS stock_unit
    FROM public.recipe_ingredients ri
    JOIN public.products p ON p.id = ri.product_id
    WHERE ri.recipe_id = p_recipe_id
    ORDER BY ri.sort_order, ri.id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id,
      v_ing.quantity,
      v_ing.input_quantity,
      v_ing.input_unit_code
    );
    v_need := v_per * v_scale * COALESCE(v_ing.loss_factor, 1);
    v_row := jsonb_build_object(
      'product_id', v_ing.product_id,
      'product_name', v_ing.product_name,
      'quantity_in_stock_unit', round(v_need::numeric, 6),
      'stock_unit', v_ing.stock_unit,
      'allocated_line_cost',
      CASE
        WHEN v_sum_need > 0 AND v_line_total IS NOT NULL THEN
          round((v_line_total * (v_need / v_sum_need))::numeric, 4)
        ELSE NULL
      END,
      'unit_cost_stock_unit',
      CASE
        WHEN v_sum_need > 0 AND v_line_total IS NOT NULL AND v_need > 0 THEN
          round(((v_line_total * (v_need / v_sum_need)) / v_need)::numeric, 6)
        ELSE NULL
      END
    );
    v_components := v_components || jsonb_build_array(v_row);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', p_recipe_id,
    'recipe_active', v_rec_active,
    'recipe_version', v_rec_ver,
    'batch_yield', v_batch,
    'scale', round(v_scale::numeric, 8),
    'line_total', v_line_total,
    'components', v_components
  );
END;
$$;

COMMENT ON FUNCTION public.preview_import_recipe_breakdown(UUID, UUID, UUID) IS
  'Preview de explosão por ficha ENTRY_BREAKDOWN. Opcional p_recebimento_token para link público de recebimento (anon).';

GRANT EXECUTE ON FUNCTION public.preview_import_recipe_breakdown(UUID, UUID, UUID) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Aplica explosão (entrada nos componentes). Chamado a partir de confirmar_recebimento.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_entry_breakdown_stock_for_expense_item(
  p_expense_item_id UUID,
  p_received_line_qty NUMERIC,
  p_recipe_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_order_qty NUMERIC;
  v_stock_basis NUMERIC;
  v_uv NUMERIC;
  v_batch NUMERIC;
  v_scale NUMERIC;
  v_rec_active BOOLEAN;
  v_rec_type TEXT;
  v_line_total NUMERIC;
  v_sum_need NUMERIC := 0;
  v_ing RECORD;
  v_per NUMERIC;
  v_need NUMERIC;
  v_alloc_cost NUMERIC;
  v_unit_cost NUMERIC;
BEGIN
  SELECT e.company_id, ei.quantity, COALESCE(ei.stock_quantity, ei.quantity), ei.unit_value
  INTO v_company, v_order_qty, v_stock_basis, v_uv
  FROM public.expense_items ei
  JOIN public.expenses e ON e.id = ei.expense_id
  WHERE ei.id = p_expense_item_id;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expense_item_not_found');
  END IF;

  SELECT r.batch_yield, r.active, r.recipe_type
  INTO v_batch, v_rec_active, v_rec_type
  FROM public.recipes r
  WHERE r.id = p_recipe_id AND r.company_id = v_company;

  IF v_batch IS NULL OR v_rec_active IS NOT TRUE OR v_rec_type IS DISTINCT FROM 'ENTRY_BREAKDOWN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_recipe_for_breakdown');
  END IF;

  IF p_received_line_qty IS NULL OR p_received_line_qty <= 0 OR v_order_qty IS NULL OR v_order_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantities');
  END IF;

  v_scale := v_stock_basis * (p_received_line_qty / v_order_qty) / NULLIF(v_batch, 0);
  v_line_total := p_received_line_qty * COALESCE(v_uv, 0);

  FOR v_ing IN
    SELECT
      ri.product_id,
      ri.quantity,
      ri.input_quantity,
      ri.input_unit_code,
      ri.loss_factor
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = p_recipe_id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id,
      v_ing.quantity,
      v_ing.input_quantity,
      v_ing.input_unit_code
    );
    IF v_per IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_conversion', 'product_id', v_ing.product_id);
    END IF;
    v_need := v_per * v_scale * COALESCE(v_ing.loss_factor, 1);
    IF v_need > 0 THEN
      v_sum_need := v_sum_need + v_need;
    END IF;
  END LOOP;

  IF v_sum_need <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_breakdown');
  END IF;

  FOR v_ing IN
    SELECT
      ri.product_id,
      ri.quantity,
      ri.input_quantity,
      ri.input_unit_code,
      ri.loss_factor
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = p_recipe_id
    ORDER BY ri.sort_order, ri.id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id,
      v_ing.quantity,
      v_ing.input_quantity,
      v_ing.input_unit_code
    );
    v_need := v_per * v_scale * COALESCE(v_ing.loss_factor, 1);
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;
    v_alloc_cost := v_line_total * (v_need / v_sum_need);
    v_unit_cost := v_alloc_cost / NULLIF(v_need, 0);
    PERFORM public.adjust_product_stock(
      v_ing.product_id,
      v_need,
      'in',
      'import_breakdown',
      p_expense_item_id,
      v_unit_cost
    );
    UPDATE public.stock_movements sm
    SET metadata_json = jsonb_build_object(
      'expense_item_id', p_expense_item_id,
      'recipe_id', p_recipe_id,
      'component_product_id', v_ing.product_id
    )
    WHERE sm.id = (
      SELECT id FROM public.stock_movements
      WHERE product_id = v_ing.product_id
        AND reference_type = 'import_breakdown'
        AND reference_id = p_expense_item_id
      ORDER BY created_at DESC
      LIMIT 1
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_entry_breakdown_stock_for_expense_item(UUID, NUMERIC, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Upsert de regra aprendida (chamado após confirmação na UI).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_import_item_resolution_rule(
  p_company_id UUID,
  p_supplier_id UUID,
  p_normalized_description TEXT,
  p_resolution_mode TEXT,
  p_target_product_id UUID,
  p_target_recipe_id UUID,
  p_auto_apply BOOLEAN,
  p_ean TEXT DEFAULT NULL,
  p_ncm TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
  v_norm TEXT := NULLIF(btrim(p_normalized_description), '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_company_id NOT IN (SELECT company_id FROM public.user_companies WHERE user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_resolution_mode NOT IN ('DIRECT_STOCK_ENTRY', 'EXPLODE_BY_RECIPE', 'REVIEW_REQUIRED') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_mode');
  END IF;

  SELECT r.id INTO v_id
  FROM public.import_item_resolution_rules r
  WHERE r.company_id = p_company_id
    AND r.supplier_id IS NOT DISTINCT FROM p_supplier_id
    AND r.normalized_description IS NOT DISTINCT FROM v_norm
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.import_item_resolution_rules r
    SET
      resolution_mode = p_resolution_mode,
      target_product_id = p_target_product_id,
      target_recipe_id = p_target_recipe_id,
      auto_apply = COALESCE(p_auto_apply, false),
      ean = COALESCE(NULLIF(btrim(p_ean), ''), r.ean),
      ncm = COALESCE(NULLIF(btrim(p_ncm), ''), r.ncm),
      learned_from_user_id = v_uid,
      updated_at = NOW()
    WHERE r.id = v_id;
  ELSE
    INSERT INTO public.import_item_resolution_rules (
      company_id,
      supplier_id,
      normalized_description,
      ean,
      ncm,
      resolution_mode,
      target_product_id,
      target_recipe_id,
      auto_apply,
      learned_from_user_id
    ) VALUES (
      p_company_id,
      p_supplier_id,
      v_norm,
      NULLIF(btrim(p_ean), ''),
      NULLIF(btrim(p_ncm), ''),
      p_resolution_mode,
      p_target_product_id,
      p_target_recipe_id,
      COALESCE(p_auto_apply, false),
      v_uid
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_import_item_resolution_rule(
  UUID, UUID, TEXT, TEXT, UUID, UUID, BOOLEAN, TEXT, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Atualização da linha antes do recebimento (memorizar escolha + ficha).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_expense_item_import_resolution(
  p_expense_item_id UUID,
  p_import_stock_resolution TEXT,
  p_resolved_recipe_id UUID,
  p_target_product_id UUID,
  p_import_nature TEXT,
  p_import_engine_suggestion TEXT,
  p_import_pending_resolution BOOLEAN,
  p_import_score_reasons_json JSONB DEFAULT NULL,
  p_import_confidence_0_1 NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
BEGIN
  SELECT e.company_id
  INTO v_company
  FROM public.expense_items ei
  JOIN public.expenses e ON e.id = ei.expense_id
  WHERE ei.id = p_expense_item_id;

  IF v_company IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_company NOT IN (
    SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.expense_items ei
  SET
    import_stock_resolution = p_import_stock_resolution,
    resolved_entry_breakdown_recipe_id = p_resolved_recipe_id,
    product_id = COALESCE(p_target_product_id, ei.product_id),
    import_nature = p_import_nature,
    import_engine_suggestion = p_import_engine_suggestion,
    import_pending_resolution = COALESCE(p_import_pending_resolution, false),
    import_score_reasons_json = COALESCE(p_import_score_reasons_json, ei.import_score_reasons_json),
    import_confidence_0_1 = COALESCE(p_import_confidence_0_1, ei.import_confidence_0_1)
  WHERE ei.id = p_expense_item_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_expense_item_import_resolution(
  UUID, TEXT, UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB, NUMERIC
) TO authenticated;

-- Preview / atualização de resolução pelo link público de recebimento (valida token).
CREATE OR REPLACE FUNCTION public.preview_import_recipe_breakdown_for_recebimento(
  p_token UUID,
  p_expense_item_id UUID,
  p_recipe_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.preview_import_recipe_breakdown(p_expense_item_id, p_recipe_id, p_token);
$$;

GRANT EXECUTE ON FUNCTION public.preview_import_recipe_breakdown_for_recebimento(UUID, UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_expense_item_import_resolution_for_recebimento(
  p_token UUID,
  p_expense_item_id UUID,
  p_import_stock_resolution TEXT,
  p_resolved_recipe_id UUID,
  p_target_product_id UUID,
  p_import_nature TEXT,
  p_import_engine_suggestion TEXT,
  p_import_pending_resolution BOOLEAN,
  p_import_score_reasons_json JSONB DEFAULT NULL,
  p_import_confidence_0_1 NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.recebimentos r
    JOIN public.expense_items ei ON ei.expense_id = r.expense_id
    WHERE r.token = p_token
      AND ei.id = p_expense_item_id
      AND r.status <> 'received'
  )
  INTO v_ok;

  IF NOT COALESCE(v_ok, false) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_item_or_already_received');
  END IF;

  UPDATE public.expense_items ei
  SET
    import_stock_resolution = p_import_stock_resolution,
    resolved_entry_breakdown_recipe_id = p_resolved_recipe_id,
    product_id = COALESCE(p_target_product_id, ei.product_id),
    import_nature = p_import_nature,
    import_engine_suggestion = p_import_engine_suggestion,
    import_pending_resolution = COALESCE(p_import_pending_resolution, false),
    import_score_reasons_json = COALESCE(p_import_score_reasons_json, ei.import_score_reasons_json),
    import_confidence_0_1 = COALESCE(p_import_confidence_0_1, ei.import_confidence_0_1)
  WHERE ei.id = p_expense_item_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_expense_item_import_resolution_for_recebimento(
  UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB, NUMERIC
) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rollback de estoque gerado por uma linha de importação (direto + explosão).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollback_import_stock_for_expense_item(p_expense_item_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
  m RECORD;
  n INTEGER := 0;
BEGIN
  SELECT e.company_id
  INTO v_company
  FROM public.expense_items ei
  JOIN public.expenses e ON e.id = ei.expense_id
  WHERE ei.id = p_expense_item_id;

  IF v_company IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_company NOT IN (
    SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  FOR m IN
    SELECT sm.id, sm.product_id, sm.quantity, sm.type
    FROM public.stock_movements sm
    WHERE sm.reference_id = p_expense_item_id
      AND sm.reference_type IN ('expense_item', 'import_breakdown')
    ORDER BY sm.created_at DESC
  LOOP
    IF m.type = 'in' THEN
      PERFORM public.adjust_product_stock(
        m.product_id,
        -m.quantity,
        'out',
        'import_rollback',
        p_expense_item_id,
        NULL
      );
      n := n + 1;
    END IF;
  END LOOP;

  UPDATE public.expense_items
  SET stock_added = false
  WHERE id = p_expense_item_id;

  RETURN json_build_object('ok', true, 'movements_reversed', n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_import_stock_for_expense_item(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_recebimento_by_token: expõe campos de resolução na lista de itens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_recebimento_by_token(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', r.id,
    'expense_id', r.expense_id,
    'company_id', e.company_id,
    'supplier_id', e.supplier_id,
    'status', r.status,
    'supplier_name', e.supplier_name,
    'invoice_number', e.invoice_number,
    'notes', e.notes,
    'created_at', r.created_at,
    'assigned_company_member_id', r.assigned_company_member_id,
    'assigned_member_name', cm.name,
    'viewer_can_confirm', (r.status <> 'received'),
    'items', COALESCE(
      (SELECT json_agg(json_build_object(
        'id', ei.id,
        'product_name', ei.product_name,
        'quantity', ei.quantity,
        'unit_value', ei.unit_value,
        'product_id', ei.product_id,
        'invoice_unit', ei.invoice_unit,
        'stock_quantity', ei.stock_quantity,
        'import_nature', ei.import_nature,
        'import_engine_suggestion', ei.import_engine_suggestion,
        'import_confidence_0_1', ei.import_confidence_0_1,
        'import_score_reasons_json', ei.import_score_reasons_json,
        'import_stock_resolution', ei.import_stock_resolution,
        'resolved_entry_breakdown_recipe_id', ei.resolved_entry_breakdown_recipe_id,
        'import_pending_resolution', ei.import_pending_resolution,
        'stock_added', ei.stock_added
      ) ORDER BY ei.created_at, ei.id)
      FROM public.expense_items ei
      WHERE ei.expense_id = e.id),
      '[]'::json
    )
  )
  INTO v_result
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  LEFT JOIN public.company_members cm ON cm.id = r.assigned_company_member_id
  WHERE r.token = p_token;

  RETURN COALESCE(v_result, json_build_object('error', 'Link inválido ou expirado'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recebimento_by_token(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- confirmar_recebimento: entrada direta com stock_quantity quando houver;
-- explosão por ficha ENTRY_BREAKDOWN quando import_stock_resolution = EXPLODE_BY_RECIPE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_recebimento(
  p_token UUID,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recebimento_id UUID;
  v_status TEXT;
  v_item JSONB;
  v_expense_item_id UUID;
  v_item_status TEXT;
  v_qty_rec NUMERIC;
  v_order_qty NUMERIC;
  v_unit_value NUMERIC;
  v_product_id UUID;
  v_stock_added BOOLEAN;
  v_stock_qty NUMERIC;
  v_stored_qty NUMERIC;
  v_import_stock_resolution TEXT;
  v_resolved_recipe_id UUID;
  v_import_pending_resolution BOOLEAN;
  v_ei_stock_quantity NUMERIC;
  v_import_engine_suggestion TEXT;
  v_import_nature TEXT;
  v_import_confidence NUMERIC;
  v_import_score_reasons JSONB;
  v_import_applied_rule_id UUID;
  v_company_id UUID;
  v_stock_apply NUMERIC;
  v_break JSONB;
  v_prev_pending TEXT;
BEGIN
  SELECT r.id, r.status
  INTO v_recebimento_id, v_status
  FROM public.recebimentos r
  WHERE r.token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_expense_item_id := (v_item->>'expense_item_id')::UUID;
    v_item_status := COALESCE((v_item->>'status')::TEXT, 'received');
    IF v_item_status NOT IN ('received', 'not_received', 'partial') THEN
      RETURN json_build_object('success', false, 'error', 'Status de item inválido');
    END IF;

    SELECT
      ei.quantity,
      ei.unit_value,
      ei.product_id,
      COALESCE(ei.stock_added, false),
      ei.import_stock_resolution,
      ei.resolved_entry_breakdown_recipe_id,
      ei.import_pending_resolution,
      ei.stock_quantity,
      ei.import_engine_suggestion,
      ei.import_nature,
      ei.import_confidence_0_1,
      ei.import_score_reasons_json,
      ei.import_applied_rule_id,
      e.company_id
    INTO
      v_order_qty,
      v_unit_value,
      v_product_id,
      v_stock_added,
      v_import_stock_resolution,
      v_resolved_recipe_id,
      v_import_pending_resolution,
      v_ei_stock_quantity,
      v_import_engine_suggestion,
      v_import_nature,
      v_import_confidence,
      v_import_score_reasons,
      v_import_applied_rule_id,
      v_company_id
    FROM public.expense_items ei
    JOIN public.expenses e ON e.id = ei.expense_id
    WHERE ei.id = v_expense_item_id
      AND ei.expense_id = (SELECT expense_id FROM public.recebimentos WHERE id = v_recebimento_id);

    IF v_order_qty IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Item não pertence a este recebimento');
    END IF;

    IF COALESCE(v_import_pending_resolution, false) = true THEN
      RETURN json_build_object(
        'success', false,
        'error',
        'Existem itens pendentes de resolução de importação. Conclua a conferência antes de confirmar o recebimento.'
      );
    END IF;

    v_qty_rec := NULL;
    IF (v_item->>'quantity_received') IS NOT NULL AND length(trim(v_item->>'quantity_received')) > 0 THEN
      v_qty_rec := (v_item->>'quantity_received')::NUMERIC;
    END IF;

    IF v_item_status = 'received' THEN
      v_stored_qty := v_order_qty;
      v_stock_qty := v_order_qty;
    ELSIF v_item_status = 'not_received' THEN
      v_stored_qty := 0;
      v_stock_qty := 0;
    ELSE
      IF v_qty_rec IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Informe a quantidade recebida para itens parciais');
      END IF;
      IF v_qty_rec <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Quantidade recebida deve ser maior que zero');
      END IF;
      IF v_qty_rec > v_order_qty THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Quantidade recebida não pode ser maior que a quantidade pedida.'
        );
      END IF;
      IF v_qty_rec >= v_order_qty THEN
        v_item_status := 'received';
        v_stored_qty := v_order_qty;
        v_stock_qty := v_order_qty;
      ELSE
        v_stored_qty := v_qty_rec;
        v_stock_qty := v_qty_rec;
      END IF;
    END IF;

    INSERT INTO public.recebimento_item_status (
      recebimento_id,
      expense_item_id,
      status,
      quantity_received
    )
    VALUES (
      v_recebimento_id,
      v_expense_item_id,
      v_item_status,
      v_stored_qty
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
      status = EXCLUDED.status,
      quantity_received = EXCLUDED.quantity_received;

    IF v_stock_qty > 0 AND NOT v_stock_added THEN
      v_prev_pending := COALESCE(v_import_engine_suggestion, '');
      IF v_import_stock_resolution = 'EXPLODE_BY_RECIPE'
         AND v_resolved_recipe_id IS NOT NULL
      THEN
        v_break := public.apply_entry_breakdown_stock_for_expense_item(
          v_expense_item_id,
          v_stock_qty,
          v_resolved_recipe_id
        );
        IF COALESCE((v_break->>'ok')::boolean, false) IS NOT TRUE THEN
          RETURN json_build_object(
            'success', false,
            'error',
            COALESCE(v_break->>'error', 'Falha na explosão por ficha'),
            'detail', v_break
          );
        END IF;
        INSERT INTO public.import_item_resolution_audit_logs (
          company_id,
          expense_item_id,
          previous_status,
          new_status,
          applied_resolution_mode,
          applied_rule_id,
          applied_recipe_id,
          recipe_version,
          user_id,
          score_reasons_json
        ) VALUES (
          v_company_id,
          v_expense_item_id,
          v_prev_pending,
          'APPLIED_EXPLODE',
          'EXPLODE_BY_RECIPE',
          v_import_applied_rule_id,
          v_resolved_recipe_id,
          (SELECT version FROM public.recipes WHERE id = v_resolved_recipe_id),
          auth.uid(),
          v_import_score_reasons
        );
        UPDATE public.expense_items SET stock_added = true WHERE id = v_expense_item_id;
      ELSIF v_product_id IS NOT NULL THEN
        v_stock_apply := COALESCE(v_ei_stock_quantity, v_order_qty)
          * (v_stock_qty / NULLIF(v_order_qty, 0));
        PERFORM public.adjust_product_stock(
          v_product_id,
          v_stock_apply,
          'in',
          'expense_item',
          v_expense_item_id,
          v_unit_value
        );
        INSERT INTO public.import_item_resolution_audit_logs (
          company_id,
          expense_item_id,
          previous_status,
          new_status,
          applied_resolution_mode,
          applied_rule_id,
          applied_recipe_id,
          recipe_version,
          user_id,
          score_reasons_json
        ) VALUES (
          v_company_id,
          v_expense_item_id,
          v_prev_pending,
          'APPLIED_DIRECT',
          'DIRECT',
          v_import_applied_rule_id,
          NULL,
          NULL,
          auth.uid(),
          v_import_score_reasons
        );
        UPDATE public.expense_items SET stock_added = true WHERE id = v_expense_item_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

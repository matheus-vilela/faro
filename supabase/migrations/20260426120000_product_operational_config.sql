-- Classificação operacional de itens (onboarding + auditoria) — separado de sugestão vs decisão final.
-- Sincroniza `products.stock_control_type` quando o item fica CONFIGURADO.

CREATE TABLE IF NOT EXISTS public.product_operational_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  suggested_operational_type TEXT NOT NULL
    CHECK (suggested_operational_type IN (
      'INSUMO', 'PRODUTO_REVENDA', 'ITEM_OPERACIONAL', 'RECEITA_FICHA', 'NAO_ESTOCAVEL', 'REVISAO_PENDENTE'
    )),
  suggested_score NUMERIC(7, 4) NOT NULL DEFAULT 0
    CHECK (suggested_score >= 0::numeric AND suggested_score <= 1::numeric),
  suggestion_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_operational_type TEXT
    CHECK (final_operational_type IS NULL OR final_operational_type IN (
      'INSUMO', 'PRODUTO_REVENDA', 'ITEM_OPERACIONAL', 'RECEITA_FICHA', 'NAO_ESTOCAVEL', 'REVISAO_PENDENTE'
    )),
  final_decision_source TEXT
    CHECK (final_decision_source IS NULL OR final_decision_source IN ('AUTO', 'USER_CONFIRMED', 'USER_EDITED')),
  configuration_status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (configuration_status IN ('PENDENTE', 'PARCIAL', 'CONFIGURADO', 'BLOQUEADO', 'IGNORADO')),
  configuration_completeness JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_entry_breakdown_recipe_id UUID REFERENCES public.recipes (id) ON DELETE SET NULL,
  notes TEXT,
  ui_filter_json JSONB,
  last_opened_product_id UUID,
  last_edited_at TIMESTAMPTZ,
  last_edited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_operational_config_company
  ON public.product_operational_config (company_id);

CREATE INDEX IF NOT EXISTS idx_product_operational_config_status
  ON public.product_operational_config (company_id, configuration_status);

COMMENT ON TABLE public.product_operational_config IS
  'Parametrização operacional por item: sugestão (score) vs decisão (final_*), com status de completude para onboarding.';

ALTER TABLE public.product_operational_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage operational config in their company"
  ON public.product_operational_config;
CREATE POLICY "Users manage operational config in their company"
  ON public.product_operational_config FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_operational_config TO authenticated;

CREATE OR REPLACE FUNCTION public._map_operational_type_to_stock_control(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_type
    WHEN 'INSUMO' THEN 'SERVICE'
    WHEN 'PRODUTO_REVENDA' THEN 'DIRECT'
    WHEN 'ITEM_OPERACIONAL' THEN 'DIRECT'
    WHEN 'RECEITA_FICHA' THEN 'RECIPE_CONTROLLED'
    WHEN 'NAO_ESTOCAVEL' THEN 'SERVICE'
    WHEN 'REVISAO_PENDENTE' THEN 'DIRECT'
    ELSE 'DIRECT'
  END;
$fn$;

CREATE OR REPLACE FUNCTION public._recipe_is_active_entry_breakdown(p_recipe_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.id = p_recipe_id
      AND r.active IS TRUE
      AND r.recipe_type = 'ENTRY_BREAKDOWN'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.apply_operational_config_to_product(p_row public.product_operational_config)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_sc TEXT;
BEGIN
  IF p_row.final_operational_type IS NULL THEN
    RETURN;
  END IF;
  IF p_row.configuration_status IS DISTINCT FROM 'CONFIGURADO' THEN
    RETURN;
  END IF;

  v_sc := public._map_operational_type_to_stock_control(p_row.final_operational_type);
  IF p_row.final_operational_type = 'RECEITA_FICHA' AND NOT public._recipe_is_active_entry_breakdown(p_row.linked_entry_breakdown_recipe_id) THEN
    RETURN;
  END IF;

  UPDATE public.products
  SET
    stock_control_type = v_sc,
    updated_at = now()
  WHERE id = p_row.product_id
    AND company_id = p_row.company_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_product_operational_config_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_product_operational_config_updated ON public.product_operational_config;
CREATE TRIGGER trg_product_operational_config_updated
  BEFORE UPDATE ON public.product_operational_config
  FOR EACH ROW EXECUTE FUNCTION public.set_product_operational_config_updated();

CREATE OR REPLACE FUNCTION public.upsert_product_operational_config(
  p_product_id UUID,
  p_suggested_operational_type TEXT,
  p_suggested_score NUMERIC,
  p_suggestion_reasons JSONB,
  p_final_operational_type TEXT,
  p_final_decision_source TEXT,
  p_configuration_status TEXT,
  p_configuration_completeness JSONB,
  p_linked_entry_breakdown_recipe_id UUID,
  p_notes TEXT,
  p_ui_filter_json JSONB
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company_id UUID;
  v_uid UUID := auth.uid();
  v_row public.product_operational_config;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT p.company_id INTO v_company_id
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = v_company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_status := COALESCE(p_configuration_status, 'PENDENTE');

  IF p_final_operational_type = 'RECEITA_FICHA' THEN
    IF p_linked_entry_breakdown_recipe_id IS NULL
      OR NOT public._recipe_is_active_entry_breakdown(p_linked_entry_breakdown_recipe_id) THEN
      v_status := 'BLOQUEADO';
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.id = p_linked_entry_breakdown_recipe_id
          AND r.company_id = v_company_id
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'recipe_company_mismatch');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.product_operational_config (
    company_id, product_id,
    suggested_operational_type, suggested_score, suggestion_reasons,
    final_operational_type, final_decision_source,
    configuration_status, configuration_completeness,
    linked_entry_breakdown_recipe_id, notes, ui_filter_json,
    last_edited_at, last_edited_by
  ) VALUES (
    v_company_id, p_product_id,
    p_suggested_operational_type, COALESCE(p_suggested_score, 0::numeric), COALESCE(p_suggestion_reasons, '{}'::jsonb),
    p_final_operational_type, p_final_decision_source,
    v_status, COALESCE(p_configuration_completeness, '{}'::jsonb),
    p_linked_entry_breakdown_recipe_id, p_notes, p_ui_filter_json,
    now(), v_uid
  )
  ON CONFLICT (company_id, product_id) DO UPDATE SET
    suggested_operational_type = EXCLUDED.suggested_operational_type,
    suggested_score = EXCLUDED.suggested_score,
    suggestion_reasons = EXCLUDED.suggestion_reasons,
    final_operational_type = EXCLUDED.final_operational_type,
    final_decision_source = EXCLUDED.final_decision_source,
    configuration_status = EXCLUDED.configuration_status,
    configuration_completeness = EXCLUDED.configuration_completeness,
    linked_entry_breakdown_recipe_id = EXCLUDED.linked_entry_breakdown_recipe_id,
    notes = EXCLUDED.notes,
    ui_filter_json = COALESCE(EXCLUDED.ui_filter_json, public.product_operational_config.ui_filter_json),
    last_edited_at = now(),
    last_edited_by = v_uid
  RETURNING * INTO v_row;

  PERFORM public.apply_operational_config_to_product(v_row);

  RETURN json_build_object('ok', true, 'row', row_to_json(v_row));
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_product_operational_config(
  UUID, TEXT, NUMERIC, JSONB, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_product_operational_config(
  UUID, TEXT, NUMERIC, JSONB, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, JSONB
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_item_classification_onboarding_status(p_company_id UUID)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_total int;
  v_configured int;
  v_blocked int;
  v_incomplete int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT count(*)::int INTO v_total
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND COALESCE(p.is_active, true) IS true;

  SELECT count(*)::int INTO v_configured
  FROM public.products p
  INNER JOIN public.product_operational_config c
    ON c.product_id = p.id AND c.company_id = p.company_id
  WHERE p.company_id = p_company_id
    AND COALESCE(p.is_active, true) IS true
    AND c.configuration_status = 'CONFIGURADO';

  SELECT count(*)::int INTO v_blocked
  FROM public.product_operational_config c
  WHERE c.company_id = p_company_id
    AND c.configuration_status = 'BLOQUEADO';

  SELECT count(*)::int INTO v_incomplete
  FROM public.products p
  LEFT JOIN public.product_operational_config c
    ON c.product_id = p.id AND c.company_id = p.company_id
  WHERE p.company_id = p_company_id
    AND COALESCE(p.is_active, true) IS true
    AND (c.id IS NULL OR c.configuration_status IS DISTINCT FROM 'CONFIGURADO');

  RETURN json_build_object(
    'ok', true,
    'total_products', v_total,
    'configured', v_configured,
    'blocked', v_blocked,
    'incomplete', v_incomplete,
    'percent', CASE
      WHEN v_total <= 0 THEN 100
      ELSE round((v_configured::numeric / v_total::numeric) * 100::numeric, 2)
    END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_item_classification_onboarding_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_item_classification_onboarding_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_set_product_operational_type(
  p_company_id UUID,
  p_product_ids UUID[],
  p_final_operational_type TEXT,
  p_final_decision_source TEXT
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_pid UUID;
  v_cfg_id UUID;
  v_sug_type TEXT;
  v_sug_score NUMERIC;
  v_sug_reasons JSONB;
  v_compl JSONB;
  v_recipe UUID;
  v_notes TEXT;
  v_ui JSONB;
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  FOREACH v_pid IN ARRAY p_product_ids
  LOOP
    SELECT c.id, c.suggested_operational_type, c.suggested_score, c.suggestion_reasons,
           c.configuration_completeness, c.linked_entry_breakdown_recipe_id, c.notes, c.ui_filter_json
    INTO v_cfg_id, v_sug_type, v_sug_score, v_sug_reasons, v_compl, v_recipe, v_notes, v_ui
    FROM public.product_operational_config c
    WHERE c.company_id = p_company_id AND c.product_id = v_pid;

    IF v_cfg_id IS NULL THEN
      PERFORM public.upsert_product_operational_config(
        v_pid,
        p_final_operational_type,
        0.5,
        jsonb_build_object('bulk', true),
        p_final_operational_type,
        p_final_decision_source,
        'PARCIAL',
        jsonb_build_object('bulk', true),
        NULL, NULL, NULL
      );
    ELSE
      PERFORM public.upsert_product_operational_config(
        v_pid,
        COALESCE(v_sug_type, p_final_operational_type),
        COALESCE(v_sug_score, 0.5::numeric),
        COALESCE(v_sug_reasons, '{}'::jsonb),
        p_final_operational_type,
        p_final_decision_source,
        'PARCIAL',
        COALESCE(v_compl, '{}'::jsonb),
        v_recipe,
        v_notes,
        v_ui
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'updated', v_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.bulk_set_product_operational_type(UUID, UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_set_product_operational_type(UUID, UUID[], TEXT, TEXT) TO authenticated;

-- Catálogo inicial no onboarding: itens brutos NF-e, clusters de reconciliação e memória.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_catalog_reconciliation_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.companies.onboarding_catalog_reconciliation_completed_at IS
  'Quando preenchido, para de registrar linhas brutas extras para reconciliação e marca o onboarding de catálogo como concluído.';

CREATE TABLE IF NOT EXISTS public.onboarding_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  pipeline_version TEXT NOT NULL DEFAULT 'v1',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_runs_company
  ON public.onboarding_reconciliation_runs (company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.onboarding_import_item_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  import_job_batch_id UUID REFERENCES public.import_job_batches(id) ON DELETE SET NULL,
  import_job_file_id UUID REFERENCES public.import_job_files(id) ON DELETE SET NULL,
  import_job_item_id UUID REFERENCES public.import_job_items(id) ON DELETE SET NULL,
  description_original TEXT NOT NULL,
  description_normalized TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name_snapshot TEXT,
  xml_origem TEXT,
  unit_raw TEXT,
  quantity NUMERIC(18, 6),
  line_value NUMERIC(18, 6),
  ean TEXT,
  ncm TEXT,
  detected_brand TEXT,
  detected_volume TEXT,
  detected_packaging TEXT,
  extracted_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'IMPORTED'
    CHECK (reconciliation_status IN (
      'IMPORTED', 'IN_CLUSTER', 'MERGED', 'KEPT_SEPARATE', 'SKIPPED'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_raw_company_norm
  ON public.onboarding_import_item_raw (company_id, description_normalized);

CREATE INDEX IF NOT EXISTS idx_onboarding_raw_company_ean
  ON public.onboarding_import_item_raw (company_id, ean)
  WHERE ean IS NOT NULL AND trim(ean) <> '';

CREATE INDEX IF NOT EXISTS idx_onboarding_raw_company_product
  ON public.onboarding_import_item_raw (company_id, created_product_id);

CREATE TABLE IF NOT EXISTS public.onboarding_product_cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reconciliation_run_id UUID REFERENCES public.onboarding_reconciliation_runs(id) ON DELETE SET NULL,
  canonical_name_suggested TEXT NOT NULL,
  primary_unit_suggested TEXT,
  merge_strength TEXT NOT NULL DEFAULT 'MEDIUM_CONFIDENCE_REVIEW'
    CHECK (merge_strength IN (
      'HIGH_CONFIDENCE_AUTO',
      'MEDIUM_CONFIDENCE_REVIEW',
      'LOW_CONFIDENCE_REVIEW'
    )),
  aggregate_confidence NUMERIC(6, 4) NOT NULL DEFAULT 0
    CHECK (aggregate_confidence >= 0::numeric AND aggregate_confidence <= 1::numeric),
  occurrence_count INTEGER NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  brands_found TEXT[] NOT NULL DEFAULT '{}',
  ai_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_cluster_company_status
  ON public.onboarding_product_cluster (company_id, status, merge_strength);

CREATE TABLE IF NOT EXISTS public.onboarding_product_cluster_member (
  cluster_id UUID NOT NULL REFERENCES public.onboarding_product_cluster(id) ON DELETE CASCADE,
  raw_item_id UUID NOT NULL REFERENCES public.onboarding_import_item_raw(id) ON DELETE CASCADE,
  linked_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ai_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (cluster_id, raw_item_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_cluster_member_raw
  ON public.onboarding_product_cluster_member (raw_item_id);

CREATE TABLE IF NOT EXISTS public.onboarding_catalog_decision_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  decision_kind TEXT NOT NULL
    CHECK (decision_kind IN (
      'MERGE_APPROVED',
      'SEPARATION_APPROVED',
      'CANONICAL_OVERRIDE',
      'BULK_APPROVE_HIGH'
    )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_onboarding_memory_company
  ON public.onboarding_catalog_decision_memory (company_id, created_at DESC);

ALTER TABLE public.onboarding_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_import_item_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_product_cluster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_product_cluster_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_catalog_decision_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage onboarding reconciliation runs"
  ON public.onboarding_reconciliation_runs;
CREATE POLICY "Users manage onboarding reconciliation runs"
  ON public.onboarding_reconciliation_runs FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage onboarding import raw"
  ON public.onboarding_import_item_raw;
CREATE POLICY "Users manage onboarding import raw"
  ON public.onboarding_import_item_raw FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage onboarding clusters"
  ON public.onboarding_product_cluster;
CREATE POLICY "Users manage onboarding clusters"
  ON public.onboarding_product_cluster FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage onboarding cluster members"
  ON public.onboarding_product_cluster_member;
CREATE POLICY "Users manage onboarding cluster members"
  ON public.onboarding_product_cluster_member FOR ALL
  USING (
    cluster_id IN (
      SELECT c.id FROM public.onboarding_product_cluster c
      WHERE c.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    cluster_id IN (
      SELECT c.id FROM public.onboarding_product_cluster c
      WHERE c.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users manage onboarding catalog memory"
  ON public.onboarding_catalog_decision_memory;
CREATE POLICY "Users manage onboarding catalog memory"
  ON public.onboarding_catalog_decision_memory FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

GRANT ALL ON public.onboarding_reconciliation_runs TO authenticated;
GRANT ALL ON public.onboarding_import_item_raw TO authenticated;
GRANT ALL ON public.onboarding_product_cluster TO authenticated;
GRANT ALL ON public.onboarding_product_cluster_member TO authenticated;
GRANT ALL ON public.onboarding_catalog_decision_memory TO authenticated;

-- Consolida dois produtos da mesma empresa (reponta FKs comuns e soma estoque).
CREATE OR REPLACE FUNCTION public.merge_onboarding_products(
  p_company_id UUID,
  p_winner_id UUID,
  p_loser_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_win_company UUID;
  v_lose_company UUID;
  v_qty_win NUMERIC;
  v_qty_lose NUMERIC;
BEGIN
  IF p_winner_id = p_loser_id THEN
    RETURN;
  END IF;

  SELECT company_id, current_quantity INTO v_win_company, v_qty_win
  FROM products WHERE id = p_winner_id FOR UPDATE;
  SELECT company_id, current_quantity INTO v_lose_company, v_qty_lose
  FROM products WHERE id = p_loser_id FOR UPDATE;

  IF v_win_company IS NULL OR v_lose_company IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;
  IF v_win_company <> p_company_id OR v_lose_company <> p_company_id THEN
    RAISE EXCEPTION 'Produtos não pertencem à empresa informada';
  END IF;

  DELETE FROM public.product_operational_config
  WHERE company_id = p_company_id AND product_id = p_loser_id;

  DELETE FROM public.product_category_assignments WHERE product_id = p_loser_id;

  UPDATE public.product_import_equivalences SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  DELETE FROM public.product_unit_rules r
  WHERE r.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_unit_rules w
      WHERE w.company_id = r.company_id AND w.product_id = p_winner_id
        AND w.from_unit_normalized = r.from_unit_normalized
    );

  UPDATE public.product_unit_rules SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  DELETE FROM public.product_invoice_line_aliases l
  WHERE l.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_invoice_line_aliases w
      WHERE w.company_id = l.company_id AND w.product_id = p_winner_id
        AND w.normalized_label = l.normalized_label
    );

  UPDATE public.product_invoice_line_aliases SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.expense_items SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.stock_movements SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.revenue_entries SET product_id = p_winner_id WHERE product_id = p_loser_id;

  UPDATE public.purchase_order_items SET product_id = p_winner_id WHERE product_id = p_loser_id;

  DELETE FROM public.product_unit_conversions c
  WHERE c.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_unit_conversions w
      WHERE w.product_id = p_winner_id AND w.secondary_unit_id = c.secondary_unit_id
    );

  UPDATE public.product_unit_conversions SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.inventory_count_listings SET product_id = p_winner_id WHERE product_id = p_loser_id;

  UPDATE public.import_item_resolution_rules SET target_product_id = p_winner_id WHERE target_product_id = p_loser_id;

  UPDATE public.import_recipe_draft_components SET product_id = p_winner_id WHERE product_id = p_loser_id;

  DELETE FROM public.recipe_ingredients ri
  WHERE ri.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.recipe_ingredients z
      WHERE z.recipe_id = ri.recipe_id AND z.product_id = p_winner_id
    );

  UPDATE public.recipe_ingredients SET product_id = p_winner_id WHERE product_id = p_loser_id;

  UPDATE public.recipes SET output_product_id = p_winner_id
  WHERE output_product_id = p_loser_id;

  UPDATE public.products SET
    current_quantity = COALESCE(v_qty_win, 0) + COALESCE(v_qty_lose, 0),
    updated_at = NOW()
  WHERE id = p_winner_id;

  DELETE FROM public.products WHERE id = p_loser_id;
END;
$$;

COMMENT ON FUNCTION public.merge_onboarding_products(UUID, UUID, UUID) IS
  'Une p_loser em p_winner para a empresa; atualiza vínculos usuais e soma estoque.';

GRANT EXECUTE ON FUNCTION public.merge_onboarding_products(UUID, UUID, UUID) TO authenticated;

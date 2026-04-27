-- Base mestre de classificação (referência global) + overrides por empresa + aprendizado.
-- A aplicação usa principalmente a cópia em `web/src/lib/masterItemCatalog/seedRegistry.ts`;
-- estas tabelas permitem evolução, relatórios e futura sincronização.

CREATE TABLE IF NOT EXISTS public.master_item_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key TEXT UNIQUE,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  concept_item_type TEXT NOT NULL,
  operational_type TEXT NOT NULL
    CHECK (operational_type IN (
      'INSUMO', 'PRODUTO_REVENDA', 'ITEM_OPERACIONAL', 'RECEITA_FICHA',
      'NAO_ESTOCAVEL', 'REVISAO_PENDENTE'
    )),
  family TEXT,
  subfamily TEXT,
  default_unit TEXT,
  purchase_units TEXT[] NOT NULL DEFAULT '{}',
  suggested_category_key TEXT,
  recipe_candidate BOOLEAN NOT NULL DEFAULT false,
  never_recipe BOOLEAN NOT NULL DEFAULT false,
  base_confidence NUMERIC(7, 4) NOT NULL
    CHECK (base_confidence >= 0::numeric AND base_confidence <= 1::numeric),
  keywords_positive TEXT[] NOT NULL DEFAULT '{}',
  keywords_negative TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_item_catalog_normalized
  ON public.master_item_catalog (normalized_name) WHERE active IS true;
CREATE INDEX IF NOT EXISTS idx_master_item_catalog_concept
  ON public.master_item_catalog (concept_item_type) WHERE active IS true;

CREATE TABLE IF NOT EXISTS public.master_item_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_item_id UUID NOT NULL REFERENCES public.master_item_catalog (id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL
    CHECK (alias_type IN (
      'ABBREVIATION', 'SYNONYM', 'POPULAR_NAME', 'SUPPLIER_VARIATION', 'REGEX_HINT'
    )),
  weight NUMERIC(5, 4) NOT NULL
    CHECK (weight > 0::numeric AND weight <= 1::numeric),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT master_item_alias_unique UNIQUE (master_item_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_master_item_alias_norm
  ON public.master_item_alias (normalized_alias) WHERE active IS true;

CREATE TABLE IF NOT EXISTS public.company_master_catalog_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  master_item_id UUID REFERENCES public.master_item_catalog (id) ON DELETE SET NULL,
  custom_name TEXT,
  custom_alias TEXT,
  override_concept_type TEXT,
  override_operational_type TEXT
    CHECK (override_operational_type IS NULL OR override_operational_type IN (
      'INSUMO', 'PRODUTO_REVENDA', 'ITEM_OPERACIONAL', 'RECEITA_FICHA',
      'NAO_ESTOCAVEL', 'REVISAO_PENDENTE'
    )),
  override_family TEXT,
  override_subfamily TEXT,
  override_default_unit TEXT,
  override_recipe_candidate BOOLEAN,
  override_never_recipe BOOLEAN,
  score_adjustment NUMERIC(5, 4)
    CHECK (score_adjustment IS NULL OR (score_adjustment >= -1::numeric AND score_adjustment <= 1::numeric)),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_master_catalog_co
  ON public.company_master_catalog_override (company_id) WHERE active IS true;

CREATE TABLE IF NOT EXISTS public.company_item_classification_learning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  normalized_input TEXT NOT NULL,
  chosen_operational_type TEXT NOT NULL
    CHECK (chosen_operational_type IN (
      'INSUMO', 'PRODUTO_REVENDA', 'ITEM_OPERACIONAL', 'RECEITA_FICHA',
      'NAO_ESTOCAVEL', 'REVISAO_PENDENTE'
    )),
  chosen_family TEXT,
  chosen_subfamily TEXT,
  chosen_category_id UUID REFERENCES public.company_product_categories (id) ON DELETE SET NULL,
  chosen_unit TEXT,
  chosen_master_item_id UUID REFERENCES public.master_item_catalog (id) ON DELETE SET NULL,
  confidence NUMERIC(7, 4),
  source TEXT NOT NULL
    CHECK (source IN (
      'XML_IMPORT', 'ONBOARDING_CONFIRMATION', 'RECEIVING_CONFIRMATION', 'MANUAL'
    )),
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_class_learning_co_norm
  ON public.company_item_classification_learning (company_id, normalized_input);

ALTER TABLE public.master_item_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_item_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_master_catalog_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_item_classification_learning ENABLE ROW LEVEL SECURITY;

-- Catálogo global: leitura para utilizadores autenticados; escrita só via migrations/serviço.
CREATE POLICY "master_item_catalog_select_authenticated"
  ON public.master_item_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "master_item_alias_select_authenticated"
  ON public.master_item_alias FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "company_master_catalog_override_all_member"
  ON public.company_master_catalog_override FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "company_item_class_learning_all_member"
  ON public.company_item_classification_learning FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.master_item_catalog TO authenticated;
GRANT ALL ON public.master_item_alias TO authenticated;
GRANT ALL ON public.company_master_catalog_override TO authenticated;
GRANT ALL ON public.company_item_classification_learning TO authenticated;

COMMENT ON TABLE public.master_item_catalog IS
  'Base mestre de classificação (hospitalidade). Espelha conhecimento padrão; motor TS em lib/masterItemCatalog.';
COMMENT ON TABLE public.company_item_classification_learning IS
  'Decisões confirmadas do utilizador para aprendizado futuro (fase 2).';

-- Amostra mínima (a lista completa vive no código em seedRegistry).
INSERT INTO public.master_item_catalog (
  external_key, canonical_name, normalized_name, concept_item_type, operational_type,
  family, subfamily, default_unit, base_confidence, never_recipe, recipe_candidate, keywords_positive, keywords_negative
) VALUES
  (
    'mc-beb-cerveja-estilos', 'Cerveja e estilos (revenda)', 'cerveja e estilos revenda', 'BEBIDA_REVENDA', 'PRODUTO_REVENDA',
    'Bebidas alcoólicas', 'Cervejas', 'un', 0.9, true, false, ARRAY['lata','barril','chope']::text[], ARRAY[]::text[]
  ),
  (
    'mc-limpeza', 'Produtos de limpeza', 'produtos de limpeza', 'LIMPEZA', 'ITEM_OPERACIONAL',
    'Limpeza', 'Químicos', 'un', 0.87, true, false, ARRAY[]::text[], ARRAY[]::text[]
  )
ON CONFLICT (external_key) DO NOTHING;

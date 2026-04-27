-- Base mestre de fichas técnicas (referência global)
-- Integrada com master_item_catalog e preparada para derivação por tenant.

CREATE TABLE IF NOT EXISTS public.master_recipe_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key TEXT UNIQUE,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  recipe_type TEXT NOT NULL,
  family TEXT,
  subcategory TEXT,
  description TEXT,
  default_yield_quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
  default_yield_unit TEXT NOT NULL DEFAULT 'un',
  default_portion_quantity NUMERIC(12, 4) NOT NULL DEFAULT 1,
  default_portion_unit TEXT NOT NULL DEFAULT 'un',
  servings_count INTEGER NOT NULL DEFAULT 1,
  prep_time_minutes INTEGER NOT NULL DEFAULT 0,
  recipe_candidate_score NUMERIC(7, 4) NOT NULL DEFAULT 0.5
    CHECK (recipe_candidate_score >= 0::numeric AND recipe_candidate_score <= 1::numeric),
  status TEXT NOT NULL DEFAULT 'CURATED'
    CHECK (status IN ('DRAFT', 'CURATED', 'DEPRECATED')),
  curation_status TEXT NOT NULL DEFAULT 'RECOMMENDED'
    CHECK (curation_status IN ('RECOMMENDED', 'UNDER_REVIEW', 'OBSOLETE')),
  origin TEXT NOT NULL DEFAULT 'SYSTEM_DEFAULT'
    CHECK (origin IN ('SYSTEM_DEFAULT', 'TENANT_DERIVED', 'USER_CREATED')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_recipe_catalog_norm
  ON public.master_recipe_catalog (normalized_name) WHERE is_active IS true;
CREATE INDEX IF NOT EXISTS idx_master_recipe_catalog_type
  ON public.master_recipe_catalog (recipe_type) WHERE is_active IS true;

CREATE TABLE IF NOT EXISTS public.master_recipe_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_recipe_id UUID NOT NULL REFERENCES public.master_recipe_catalog (id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  weight NUMERIC(5, 4) NOT NULL DEFAULT 0.8
    CHECK (weight > 0::numeric AND weight <= 1::numeric),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT master_recipe_alias_unique UNIQUE (master_recipe_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_master_recipe_alias_norm
  ON public.master_recipe_alias (normalized_alias) WHERE active IS true;

CREATE TABLE IF NOT EXISTS public.master_recipe_component (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_recipe_id UUID NOT NULL REFERENCES public.master_recipe_catalog (id) ON DELETE CASCADE,
  component_kind TEXT NOT NULL CHECK (component_kind IN ('MASTER_ITEM', 'MASTER_RECIPE')),
  component_master_item_id UUID REFERENCES public.master_item_catalog (id) ON DELETE SET NULL,
  component_master_recipe_id UUID REFERENCES public.master_recipe_catalog (id) ON DELETE SET NULL,
  quantity NUMERIC(12, 4) NOT NULL DEFAULT 0,
  unit_code TEXT NOT NULL DEFAULT 'un',
  yield_factor NUMERIC(12, 6) NOT NULL DEFAULT 1,
  waste_factor NUMERIC(12, 6) NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 1,
  is_optional BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT master_recipe_component_ref_ck CHECK (
    (component_kind = 'MASTER_ITEM' AND component_master_item_id IS NOT NULL AND component_master_recipe_id IS NULL)
    OR
    (component_kind = 'MASTER_RECIPE' AND component_master_item_id IS NULL AND component_master_recipe_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_master_recipe_component_recipe
  ON public.master_recipe_component (master_recipe_id, sort_order);

CREATE TABLE IF NOT EXISTS public.tenant_recipe_template_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.recipes (id) ON DELETE CASCADE,
  master_recipe_id UUID REFERENCES public.master_recipe_catalog (id) ON DELETE SET NULL,
  source_master_version INTEGER,
  override_notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_recipe_template_override_company
  ON public.tenant_recipe_template_override (company_id) WHERE active IS true;

ALTER TABLE public.master_recipe_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_recipe_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_recipe_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_recipe_template_override ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "master_recipe_catalog_select_authenticated"
  ON public.master_recipe_catalog;
DROP POLICY IF EXISTS "master_recipe_alias_select_authenticated"
  ON public.master_recipe_alias;
DROP POLICY IF EXISTS "master_recipe_component_select_authenticated"
  ON public.master_recipe_component;
DROP POLICY IF EXISTS "tenant_recipe_template_override_all_member"
  ON public.tenant_recipe_template_override;

CREATE POLICY "master_recipe_catalog_select_authenticated"
  ON public.master_recipe_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "master_recipe_alias_select_authenticated"
  ON public.master_recipe_alias FOR SELECT TO authenticated USING (true);
CREATE POLICY "master_recipe_component_select_authenticated"
  ON public.master_recipe_component FOR SELECT TO authenticated USING (true);
CREATE POLICY "tenant_recipe_template_override_all_member"
  ON public.tenant_recipe_template_override FOR ALL
  TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.master_recipe_catalog TO authenticated;
GRANT ALL ON public.master_recipe_alias TO authenticated;
GRANT ALL ON public.master_recipe_component TO authenticated;
GRANT ALL ON public.tenant_recipe_template_override TO authenticated;

INSERT INTO public.master_recipe_catalog (
  external_key, canonical_name, normalized_name, recipe_type, family, subcategory,
  description, default_yield_quantity, default_yield_unit, default_portion_quantity, default_portion_unit,
  servings_count, prep_time_minutes, recipe_candidate_score, status, curation_status, origin, is_active, version
) VALUES
  (
    'mr-drink-caipirinha-tradicional', 'Caipirinha tradicional', 'caipirinha tradicional', 'DRINK_RECIPE',
    'Drinks', 'Caipirinhas', 'Drink clássico com limão, açúcar e cachaça.',
    1, 'un', 1, 'un', 1, 4, 0.95, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  ),
  (
    'mr-drink-caipivodka', 'Caipivodka', 'caipivodka', 'DRINK_RECIPE',
    'Drinks', 'Caipis', 'Variação da caipirinha com vodka.',
    1, 'un', 1, 'un', 1, 4, 0.93, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  ),
  (
    'mr-drink-gin-tonica', 'Gin tônica', 'gin tonica', 'DRINK_RECIPE',
    'Drinks', 'Highball', 'Drink com gin e água tônica.',
    1, 'un', 1, 'un', 1, 3, 0.94, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  ),
  (
    'mr-base-xarope-simples', 'Xarope simples', 'xarope simples', 'SAUCE_BASE_RECIPE',
    'Bases de bar', 'Xaropes', 'Calda base de açúcar e água.',
    1, 'l', 0.03, 'l', 30, 10, 0.92, 'CURATED', 'RECOMMENDED', 'SYSTEM_DEFAULT', true, 1
  )
ON CONFLICT (external_key) DO NOTHING;

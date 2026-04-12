-- Unidades por empresa e conversões a partir da unidade principal (estoque).

CREATE TABLE IF NOT EXISTS public.company_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_units_company_code_unique UNIQUE (company_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_units_one_primary_per_company
  ON public.company_units (company_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_company_units_company
  ON public.company_units (company_id);

COMMENT ON TABLE public.company_units IS
  'Unidades de medida por empresa; exatamente uma is_primary (base de estoque e conversões).';

CREATE TABLE IF NOT EXISTS public.company_unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  primary_qty NUMERIC(18, 8) NOT NULL CHECK (primary_qty > 0),
  primary_unit_id UUID NOT NULL REFERENCES public.company_units(id) ON DELETE CASCADE,
  secondary_qty NUMERIC(18, 8) NOT NULL CHECK (secondary_qty > 0),
  secondary_unit_id UUID NOT NULL REFERENCES public.company_units(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_unit_conversions_distinct_units CHECK (primary_unit_id <> secondary_unit_id),
  CONSTRAINT company_unit_conversions_company_pair_unique UNIQUE (company_id, secondary_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_company_unit_conversions_company
  ON public.company_unit_conversions (company_id);

COMMENT ON TABLE public.company_unit_conversions IS
  'Equivalência: primary_qty da unidade principal = secondary_qty da unidade secundária.';

CREATE OR REPLACE FUNCTION public.touch_company_units_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_units_updated_at ON public.company_units;
CREATE TRIGGER tr_company_units_updated_at
  BEFORE UPDATE ON public.company_units
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_company_units_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_conversion_primary_is_company_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_primary UUID;
BEGIN
  SELECT id INTO v_primary
  FROM public.company_units
  WHERE company_id = NEW.company_id AND is_primary;

  IF v_primary IS NULL THEN
    RAISE EXCEPTION 'Empresa sem unidade principal definida';
  END IF;

  IF NEW.primary_unit_id IS DISTINCT FROM v_primary THEN
    RAISE EXCEPTION 'Conversão deve usar a unidade principal atual da empresa';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_units su
    WHERE su.id = NEW.secondary_unit_id AND su.is_primary
  ) THEN
    RAISE EXCEPTION 'Unidade secundária não pode ser a principal';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_unit_conversions_primary_check
  ON public.company_unit_conversions;
CREATE TRIGGER tr_company_unit_conversions_primary_check
  BEFORE INSERT OR UPDATE OF primary_unit_id, secondary_unit_id, company_id
  ON public.company_unit_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_conversion_primary_is_company_primary();

CREATE OR REPLACE FUNCTION public.seed_default_company_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_units (company_id, code, label, sort_order, is_primary)
  VALUES (NEW.id, 'un', 'Unidade', 0, TRUE)
  ON CONFLICT (company_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_seed_default_unit ON public.companies;
CREATE TRIGGER tr_companies_seed_default_unit
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_company_unit();

INSERT INTO public.company_units (company_id, code, label, sort_order, is_primary)
SELECT c.id, 'un', 'Unidade', 0, TRUE
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_units u WHERE u.company_id = c.id AND u.is_primary
);

ALTER TABLE public.company_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_unit_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage company units"
  ON public.company_units FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage company unit conversions"
  ON public.company_unit_conversions FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_units TO anon, authenticated;
GRANT ALL ON public.company_unit_conversions TO anon, authenticated;

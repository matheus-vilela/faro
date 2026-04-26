-- Unidades personalizadas por empresa (nome + abreviação) com aplicação em massa.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.company_custom_unit_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  source_hint TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_custom_unit_aliases_code_not_empty CHECK (btrim(unit_code) <> ''),
  CONSTRAINT company_custom_unit_aliases_label_not_empty CHECK (btrim(unit_label) <> ''),
  CONSTRAINT company_custom_unit_aliases_code_format CHECK (unit_code ~ '^[a-z0-9_]{1,24}$'),
  UNIQUE (company_id, unit_code)
);

CREATE INDEX IF NOT EXISTS idx_company_custom_unit_aliases_company
  ON public.company_custom_unit_aliases(company_id, unit_code);

ALTER TABLE public.company_custom_unit_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users manage custom unit aliases" ON public.company_custom_unit_aliases;
CREATE POLICY "Company users manage custom unit aliases"
  ON public.company_custom_unit_aliases FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_custom_unit_aliases TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_unit_alias_text(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT regexp_replace(lower(extensions.unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.register_company_custom_unit_alias(
  p_company_id UUID,
  p_unit_label TEXT,
  p_unit_code TEXT,
  p_source_hint TEXT DEFAULT NULL,
  p_apply_to_existing BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT := lower(btrim(coalesce(p_unit_code, '')));
  v_label TEXT := btrim(coalesce(p_unit_label, ''));
  v_hint TEXT := NULLIF(btrim(coalesce(p_source_hint, '')), '');
  v_hint_norm TEXT := public.normalize_unit_alias_text(v_hint);
  v_label_norm TEXT := public.normalize_unit_alias_text(v_label);
  v_code_norm TEXT := public.normalize_unit_alias_text(v_code);
  v_updated INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_company_id NOT IN (SELECT company_id FROM public.user_companies WHERE user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF v_code = '' OR v_label = '' THEN
    RETURN json_build_object('ok', false, 'error', 'unit_code_and_label_required');
  END IF;
  IF v_code !~ '^[a-z0-9_]{1,24}$' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_unit_code_format');
  END IF;

  INSERT INTO public.company_custom_unit_aliases (
    company_id,
    unit_code,
    unit_label,
    source_hint,
    created_by
  ) VALUES (
    p_company_id,
    v_code,
    v_label,
    v_hint,
    v_uid
  )
  ON CONFLICT (company_id, unit_code)
  DO UPDATE SET
    unit_label = EXCLUDED.unit_label,
    source_hint = COALESCE(EXCLUDED.source_hint, company_custom_unit_aliases.source_hint),
    updated_at = NOW();

  IF coalesce(p_apply_to_existing, true) THEN
    UPDATE public.products p
    SET
      unit = v_code,
      import_unit_needs_review = false,
      import_unit_raw = NULL
    WHERE p.company_id = p_company_id
      AND (
        (v_hint_norm IS NOT NULL AND public.normalize_unit_alias_text(p.import_unit_raw) = v_hint_norm)
        OR (v_hint_norm IS NOT NULL AND public.normalize_unit_alias_text(p.unit) = v_hint_norm)
        OR public.normalize_unit_alias_text(p.import_unit_raw) = v_code_norm
        OR public.normalize_unit_alias_text(p.import_unit_raw) = v_label_norm
        OR public.normalize_unit_alias_text(p.unit) = v_code_norm
        OR public.normalize_unit_alias_text(p.unit) = v_label_norm
      );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'unit_code', v_code,
    'unit_label', v_label,
    'updated_products', v_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_company_custom_unit_alias(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

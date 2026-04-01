-- Categorias e subcategorias personalizadas por empresa (ex.: classificação de contas, produtos).
CREATE TABLE IF NOT EXISTS public.company_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.company_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_categories_name_not_empty CHECK (btrim(name) <> '')
);

COMMENT ON TABLE public.company_categories IS
  'Categorias (parent_id NULL) e subcategorias (parent_id aponta para categoria de primeiro nível).';

CREATE INDEX IF NOT EXISTS idx_company_categories_company
  ON public.company_categories (company_id);

CREATE INDEX IF NOT EXISTS idx_company_categories_parent
  ON public.company_categories (company_id, parent_id);

CREATE OR REPLACE FUNCTION public.company_categories_validate_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_company UUID;
  v_parent_parent UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id, parent_id
  INTO v_parent_company, v_parent_parent
  FROM public.company_categories
  WHERE id = NEW.parent_id;

  IF v_parent_company IS NULL THEN
    RAISE EXCEPTION 'Categoria pai não encontrada';
  END IF;

  IF v_parent_company <> NEW.company_id THEN
    RAISE EXCEPTION 'Subcategoria deve pertencer à mesma empresa da categoria pai';
  END IF;

  IF v_parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'Apenas um nível de subcategoria é permitido';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_categories_validate_parent ON public.company_categories;
CREATE TRIGGER tr_company_categories_validate_parent
  BEFORE INSERT OR UPDATE OF parent_id, company_id ON public.company_categories
  FOR EACH ROW EXECUTE PROCEDURE public.company_categories_validate_parent();

DROP TRIGGER IF EXISTS tr_company_categories_updated_at ON public.company_categories;
CREATE TRIGGER tr_company_categories_updated_at
  BEFORE UPDATE ON public.company_categories
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.company_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their company categories"
  ON public.company_categories FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_categories TO anon, authenticated;

-- Categorias de produto (catálogo / etiquetas) — independentes das categorias financeiras (CMV).

CREATE TABLE IF NOT EXISTS public.company_product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_product_categories_company_name_unique UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_company_product_categories_company
  ON public.company_product_categories (company_id);

CREATE TABLE IF NOT EXISTS public.product_category_assignments (
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.company_product_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_product_category_assignments_category
  ON public.product_category_assignments (category_id);

COMMENT ON TABLE public.company_product_categories IS
  'Categorias de catálogo de produtos (organização interna); distinto de company_categories (financeiro).';

COMMENT ON TABLE public.product_category_assignments IS
  'Vínculo N:N entre produtos e categorias de produto da mesma empresa.';

CREATE OR REPLACE FUNCTION public.enforce_product_category_same_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cat_company UUID;
  v_prod_company UUID;
BEGIN
  SELECT company_id INTO v_cat_company
  FROM public.company_product_categories
  WHERE id = NEW.category_id;

  SELECT company_id INTO v_prod_company
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_cat_company IS DISTINCT FROM v_prod_company THEN
    RAISE EXCEPTION 'Categoria de produto e produto devem ser da mesma empresa';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_product_category_assignments_same_company
  ON public.product_category_assignments;
CREATE TRIGGER tr_product_category_assignments_same_company
  BEFORE INSERT OR UPDATE OF category_id, product_id ON public.product_category_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_category_same_company();

CREATE OR REPLACE FUNCTION public.touch_company_product_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_product_categories_updated_at
  ON public.company_product_categories;
CREATE TRIGGER tr_company_product_categories_updated_at
  BEFORE UPDATE ON public.company_product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_company_product_categories_updated_at();

CREATE OR REPLACE FUNCTION public.seed_company_product_categories(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_product_categories (company_id, name, sort_order)
  SELECT p_company_id, v.name, v.ord
  FROM (
    VALUES
      ('Aditivos', 0),
      ('Alcoólicos', 1),
      ('Bebidas', 2),
      ('Bolinhos', 3),
      ('Caldos', 4),
      ('Cervejas', 5),
      ('Comidas prontas', 6),
      ('Condimentos', 7),
      ('Congelados', 8),
      ('Conservas', 9),
      ('Cozinha', 10),
      ('Descartáveis', 11),
      ('Diversos', 12),
      ('Doces', 13),
      ('Embalagens', 14),
      ('Espetos', 15),
      ('Etiquetas', 16),
      ('Farináceos e Fermentos', 17),
      ('Gás', 18),
      ('Gelo', 19),
      ('Grãos', 20),
      ('Hortifruti', 21),
      ('Itens Salão', 22),
      ('Leite e Bebidas vegetais', 23),
      ('Mercearia', 24),
      ('Mini', 25),
      ('Molhos', 26),
      ('Oleaginosas', 27),
      ('Pastel', 28),
      ('Óleos e Gorduras', 29),
      ('Porção', 30),
      ('Produtos de Limpeza', 31),
      ('Proteínas', 32),
      ('Pães', 33),
      ('Queijo e Laticínios', 34),
      ('Sacolas', 35),
      ('Salgados', 36),
      ('Utensílios', 37),
      ('Vinhos', 38)
  ) AS v(name, ord)
  ON CONFLICT ON CONSTRAINT company_product_categories_company_name_unique DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_company_product_categories(UUID) IS
  'Insere categorias iniciais de produto para uma empresa (idempotente).';

CREATE OR REPLACE FUNCTION public.tr_companies_seed_product_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_company_product_categories(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_seed_product_categories ON public.companies;
CREATE TRIGGER tr_companies_seed_product_categories
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.tr_companies_seed_product_categories();

INSERT INTO public.company_product_categories (company_id, name, sort_order)
SELECT c.id, v.name, v.ord
FROM public.companies c
CROSS JOIN (
  VALUES
    ('Aditivos', 0),
    ('Alcoólicos', 1),
    ('Bebidas', 2),
    ('Bolinhos', 3),
    ('Caldos', 4),
    ('Cervejas', 5),
    ('Comidas prontas', 6),
    ('Condimentos', 7),
    ('Congelados', 8),
    ('Conservas', 9),
    ('Cozinha', 10),
    ('Descartáveis', 11),
    ('Diversos', 12),
    ('Doces', 13),
    ('Embalagens', 14),
    ('Espetos', 15),
    ('Etiquetas', 16),
    ('Farináceos e Fermentos', 17),
    ('Gás', 18),
    ('Gelo', 19),
    ('Grãos', 20),
    ('Hortifruti', 21),
    ('Itens Salão', 22),
    ('Leite e Bebidas vegetais', 23),
    ('Mercearia', 24),
    ('Mini', 25),
    ('Molhos', 26),
    ('Oleaginosas', 27),
    ('Pastel', 28),
    ('Óleos e Gorduras', 29),
    ('Porção', 30),
    ('Produtos de Limpeza', 31),
    ('Proteínas', 32),
    ('Pães', 33),
    ('Queijo e Laticínios', 34),
    ('Sacolas', 35),
    ('Salgados', 36),
    ('Utensílios', 37),
    ('Vinhos', 38)
) AS v(name, ord)
ON CONFLICT ON CONSTRAINT company_product_categories_company_name_unique DO NOTHING;

ALTER TABLE public.company_product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_category_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage company product categories"
  ON public.company_product_categories;
CREATE POLICY "Users can manage company product categories"
  ON public.company_product_categories FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage product category assignments"
  ON public.product_category_assignments;
CREATE POLICY "Users can manage product category assignments"
  ON public.product_category_assignments FOR ALL
  USING (
    product_id IN (
      SELECT id FROM public.products
      WHERE company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    product_id IN (
      SELECT id FROM public.products
      WHERE company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
    )
  );

GRANT ALL ON public.company_product_categories TO anon, authenticated;
GRANT ALL ON public.product_category_assignments TO anon, authenticated;

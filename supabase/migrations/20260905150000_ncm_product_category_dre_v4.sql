-- NCM liga categoria de produto; Conta do DRE vem da categoria.
-- Plano DRE v4 (11 contas) só em empresa nova. Catálogo CMV+limpeza em todas;
-- regras NCM unívocas só na criação da empresa.

ALTER TABLE public.company_product_categories
  ADD COLUMN IF NOT EXISTS default_dre_category_id UUID
    REFERENCES public.company_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS padrao_sistema BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.company_product_categories.default_dre_category_id IS
  'Folha de company_categories (Conta do DRE) sugerida para compras desta categoria de produto.';
COMMENT ON COLUMN public.company_product_categories.padrao_sistema IS
  'Categoria do catálogo padrão: owner pode desativar, não apagar.';
COMMENT ON COLUMN public.company_product_categories.ativo IS
  'False arquiva a categoria no picker; padrao_sistema continua no banco.';

CREATE INDEX IF NOT EXISTS idx_company_product_categories_default_dre
  ON public.company_product_categories (default_dre_category_id)
  WHERE default_dre_category_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.company_product_categories_validate_dre()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cat RECORD;
  v_has_child BOOLEAN;
BEGIN
  IF NEW.default_dre_category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, company_id, natureza, ativo
  INTO v_cat
  FROM public.company_categories
  WHERE id = NEW.default_dre_category_id;

  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Conta do DRE não encontrada';
  END IF;
  IF v_cat.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Conta do DRE deve ser da mesma empresa';
  END IF;
  IF v_cat.natureza IS DISTINCT FROM 'DESPESA' THEN
    RAISE EXCEPTION 'Conta do DRE da categoria de produto deve ser despesa';
  END IF;
  IF v_cat.ativo IS FALSE THEN
    RAISE EXCEPTION 'Conta do DRE inativa';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.company_categories c
    WHERE c.parent_id = NEW.default_dre_category_id
  ) INTO v_has_child;
  IF v_has_child THEN
    RAISE EXCEPTION 'Selecione uma Conta do DRE folha (sem subcategorias)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_product_categories_validate_dre
  ON public.company_product_categories;
CREATE TRIGGER tr_company_product_categories_validate_dre
  BEFORE INSERT OR UPDATE OF default_dre_category_id, company_id
  ON public.company_product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.company_product_categories_validate_dre();

CREATE OR REPLACE FUNCTION public.company_product_categories_prevent_delete_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.company_delete_cascade', true), '') = 'true' THEN
    RETURN OLD;
  END IF;

  IF COALESCE(OLD.padrao_sistema, false) THEN
    RAISE EXCEPTION 'Categoria de produto padrão não pode ser excluída. Desative (ativo = false).';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_product_categories_prevent_delete
  ON public.company_product_categories;
CREATE TRIGGER tr_company_product_categories_prevent_delete
  BEFORE DELETE ON public.company_product_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.company_product_categories_prevent_delete_default();

-- Regras NCM passam a apontar para categoria de produto (não mais para DRE).
DROP TRIGGER IF EXISTS tr_company_ncm_category_rules_validate
  ON public.company_ncm_category_rules;

DELETE FROM public.company_ncm_category_rules;

ALTER TABLE public.company_ncm_category_rules
  DROP CONSTRAINT IF EXISTS company_ncm_category_rules_company_category_id_fkey;

DROP INDEX IF EXISTS idx_company_ncm_category_rules_category;

ALTER TABLE public.company_ncm_category_rules
  DROP COLUMN IF EXISTS company_category_id;

ALTER TABLE public.company_ncm_category_rules
  ADD COLUMN product_category_id UUID NOT NULL
    REFERENCES public.company_product_categories(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_company_ncm_category_rules_product_category
  ON public.company_ncm_category_rules (product_category_id);

COMMENT ON TABLE public.company_ncm_category_rules IS
  'Vínculo NCM (8 dígitos) → categoria de produto. A Conta do DRE da linha vem de company_product_categories.default_dre_category_id.';

CREATE OR REPLACE FUNCTION public.company_ncm_category_rules_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cat RECORD;
BEGIN
  NEW.ncm := public.normalize_ncm_8(NEW.ncm);
  IF NEW.ncm IS NULL THEN
    RAISE EXCEPTION 'NCM inválido';
  END IF;

  SELECT id, company_id, ativo
  INTO v_cat
  FROM public.company_product_categories
  WHERE id = NEW.product_category_id;

  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Categoria de produto não encontrada';
  END IF;
  IF v_cat.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Categoria de produto deve ser da mesma empresa';
  END IF;
  IF v_cat.ativo IS FALSE THEN
    RAISE EXCEPTION 'Categoria de produto inativa';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_ncm_category_rules_validate
  ON public.company_ncm_category_rules;
CREATE TRIGGER tr_company_ncm_category_rules_validate
  BEFORE INSERT OR UPDATE OF ncm, company_id, product_category_id
  ON public.company_ncm_category_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.company_ncm_category_rules_validate();

CREATE OR REPLACE FUNCTION public.lookup_company_dre_leaf(
  p_company_id UUID,
  p_names TEXT[]
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cc.id
  FROM unnest(p_names) WITH ORDINALITY AS n(name, ord)
  JOIN public.company_categories cc
    ON cc.company_id = p_company_id
   AND cc.name = n.name
   AND COALESCE(cc.ativo, true) = true
   AND NOT EXISTS (
     SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id
   )
  ORDER BY n.ord
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.lookup_company_dre_leaf(UUID, TEXT[]) IS
  'Primeira folha ativa cujo nome está na lista (ordem de prioridade). Não devolve grupos.';

CREATE OR REPLACE FUNCTION public.seed_financial_categories_v4(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_categories
    WHERE company_id = p_company_id AND COALESCE(padrao_sistema, false) = true
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.company_categories (
    company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema,
    incluir_no_dre, papel_receita_dre
  ) VALUES
    (p_company_id, NULL, 'Receita Bruta de Vendas', 10, 'RECEITA', 'OPERACIONAL', true, true, true, 'BRUTA'),
    (p_company_id, NULL, 'Outras Receitas', 20, 'RECEITA', 'NAO_OPERACIONAL', true, true, true, NULL),
    (p_company_id, NULL, 'Deduções de Receita', 30, 'RECEITA', 'OPERACIONAL', true, true, true, 'DEDUCAO'),
    (p_company_id, NULL, 'Impostos', 40, 'DESPESA', 'IMPOSTOS', true, true, true, NULL),
    (p_company_id, NULL, 'Outros Tributos', 50, 'DESPESA', 'IMPOSTOS', true, true, true, NULL),
    (p_company_id, NULL, 'Despesas de Vendas e Marketing', 60, 'DESPESA', 'FIXA', true, true, true, NULL),
    (p_company_id, NULL, 'Despesas com Pessoal', 70, 'DESPESA', 'FIXA', true, true, true, NULL),
    (p_company_id, NULL, 'Despesas Administrativas', 80, 'DESPESA', 'FIXA', true, true, true, NULL),
    (p_company_id, NULL, 'Despesas Variáveis', 90, 'DESPESA', 'VARIAVEL', true, true, true, NULL),
    (p_company_id, NULL, 'Despesas Financeiras', 100, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true, NULL),
    (p_company_id, NULL, 'Ativos', 110, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, false, NULL);
END;
$$;

COMMENT ON FUNCTION public.seed_financial_categories_v4(UUID) IS
  '11 contas do DRE (planilha Eulália). Idempotente se a empresa já tem padrao_sistema.';

CREATE OR REPLACE FUNCTION public.seed_company_product_categories(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_var UUID;
  v_adm UUID;
BEGIN
  INSERT INTO public.company_product_categories (
    company_id, name, sort_order, padrao_sistema, exclude_from_sales, ativo
  )
  SELECT p_company_id, v.name, v.ord, true, v.excl, true
  FROM (
    VALUES
      ('Hortifruti', 0, false),
      ('Salgados e Pré Prontos', 1, false),
      ('Congelados', 2, false),
      ('Laticínios/Frios', 3, false),
      ('Proteínas', 4, false),
      ('Não perecíveis', 5, false),
      ('Pães', 6, false),
      ('Sobremesas', 7, false),
      ('Mercado', 8, false),
      ('Carvão', 9, false),
      ('Gás', 10, true),
      ('Coleta de óleo', 11, true),
      ('Destilados', 12, false),
      ('Cervejas', 13, false),
      ('Vinhos', 14, false),
      ('Soft Drink', 15, false),
      ('Gelo', 16, false),
      ('Utensílios Bar', 17, false),
      ('Insumos - Drinks', 18, false),
      ('Insumos - Bar', 19, false),
      ('Embalagens e descartáveis', 20, false),
      ('Produtos licenciados', 21, false),
      ('Material de Limpeza', 22, true),
      ('Diversos', 23, false)
  ) AS v(name, ord, excl)
  ON CONFLICT ON CONSTRAINT company_product_categories_company_name_unique DO NOTHING;

  UPDATE public.company_product_categories c
  SET padrao_sistema = true
  WHERE c.company_id = p_company_id
    AND c.name IN (
      'Hortifruti', 'Salgados e Pré Prontos', 'Congelados', 'Laticínios/Frios',
      'Proteínas', 'Não perecíveis', 'Pães', 'Sobremesas', 'Mercado', 'Carvão',
      'Gás', 'Coleta de óleo', 'Destilados', 'Cervejas', 'Vinhos', 'Soft Drink',
      'Gelo', 'Utensílios Bar', 'Insumos - Drinks', 'Insumos - Bar',
      'Embalagens e descartáveis', 'Produtos licenciados', 'Material de Limpeza',
      'Diversos'
    );

  UPDATE public.company_product_categories c
  SET exclude_from_sales = true
  WHERE c.company_id = p_company_id
    AND c.name IN ('Gás', 'Coleta de óleo', 'Material de Limpeza');

  v_var := public.lookup_company_dre_leaf(
    p_company_id,
    ARRAY['Despesas Variáveis', 'Outras - Variáveis']
  );
  v_adm := public.lookup_company_dre_leaf(
    p_company_id,
    ARRAY['Despesas Administrativas', 'Material e serviços de limpeza']
  );

  IF v_var IS NOT NULL THEN
    UPDATE public.company_product_categories c
    SET default_dre_category_id = v_var
    WHERE c.company_id = p_company_id
      AND c.default_dre_category_id IS NULL
      AND c.name IN (
        'Hortifruti', 'Salgados e Pré Prontos', 'Congelados', 'Laticínios/Frios',
        'Proteínas', 'Não perecíveis', 'Pães', 'Sobremesas', 'Mercado', 'Carvão',
        'Gás', 'Coleta de óleo', 'Destilados', 'Cervejas', 'Vinhos', 'Soft Drink',
        'Gelo', 'Utensílios Bar', 'Insumos - Drinks', 'Insumos - Bar',
        'Embalagens e descartáveis', 'Produtos licenciados', 'Diversos'
      );
  END IF;

  IF v_adm IS NOT NULL THEN
    UPDATE public.company_product_categories c
    SET default_dre_category_id = v_adm
    WHERE c.company_id = p_company_id
      AND c.default_dre_category_id IS NULL
      AND c.name = 'Material de Limpeza';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_company_ncm_category_rules(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_ncm_category_rules WHERE company_id = p_company_id LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.company_ncm_category_rules (company_id, ncm, product_category_id)
  SELECT p_company_id, v.ncm, c.id
  FROM (
    VALUES
('02023000', 'Proteínas'),
    ('02032200', 'Proteínas'),
    ('02071411', 'Proteínas'),
    ('02071412', 'Proteínas'),
    ('02071419', 'Proteínas'),
    ('02071422', 'Proteínas'),
    ('02101200', 'Proteínas'),
    ('02101900', 'Proteínas'),
    ('04015021', 'Laticínios/Frios'),
    ('04029900', 'Laticínios/Frios'),
    ('04061010', 'Laticínios/Frios'),
    ('04072100', 'Proteínas'),
    ('04090000', 'Insumos - Drinks'),
    ('07019000', 'Hortifruti'),
    ('07020000', 'Hortifruti'),
    ('07031019', 'Hortifruti'),
    ('07039090', 'Hortifruti'),
    ('07049000', 'Hortifruti'),
    ('07051900', 'Hortifruti'),
    ('07095100', 'Hortifruti'),
    ('07096000', 'Não perecíveis'),
    ('07133399', 'Não perecíveis'),
    ('08044000', 'Insumos - Drinks'),
    ('08051000', 'Hortifruti'),
    ('08055000', 'Insumos - Drinks'),
    ('08059000', 'Insumos - Drinks'),
    ('08061000', 'Insumos - Drinks'),
    ('08081000', 'Hortifruti'),
    ('08101000', 'Insumos - Drinks'),
    ('08105000', 'Insumos - Drinks'),
    ('08111000', 'Insumos - Drinks'),
    ('08112000', 'Insumos - Drinks'),
    ('09012100', 'Insumos - Drinks'),
    ('09041100', 'Não perecíveis'),
    ('09042200', 'Não perecíveis'),
    ('09061100', 'Insumos - Drinks'),
    ('09061900', 'Insumos - Drinks'),
    ('09071000', 'Insumos - Drinks'),
    ('09101100', 'Hortifruti'),
    ('09109900', 'Insumos - Drinks'),
    ('10063021', 'Não perecíveis'),
    ('11010010', 'Não perecíveis'),
    ('11062000', 'Não perecíveis'),
    ('12024200', 'Não perecíveis'),
    ('15079011', 'Não perecíveis'),
    ('15079019', 'Não perecíveis'),
    ('15122910', 'Não perecíveis'),
    ('15171000', 'Laticínios/Frios'),
    ('15179090', 'Não perecíveis'),
    ('16023230', 'Congelados'),
    ('16041410', 'Não perecíveis'),
    ('17011400', 'Não perecíveis'),
    ('17019900', 'Não perecíveis'),
    ('19019090', 'Não perecíveis'),
    ('19052090', 'Sobremesas'),
    ('19059090', 'Não perecíveis'),
    ('20041000', 'Congelados'),
    ('20081100', 'Não perecíveis'),
    ('20089100', 'Não perecíveis'),
    ('20089900', 'Insumos - Drinks'),
    ('20098990', 'Laticínios/Frios'),
    ('20099000', 'Insumos - Drinks'),
    ('21012010', 'Insumos - Drinks'),
    ('21032010', 'Não perecíveis'),
    ('21032090', 'Não perecíveis'),
    ('21033021', 'Não perecíveis'),
    ('21039011', 'Não perecíveis'),
    ('21039019', 'Não perecíveis'),
    ('21039021', 'Não perecíveis'),
    ('21039091', 'Não perecíveis'),
    ('21039099', 'Não perecíveis'),
    ('21069029', 'Insumos - Drinks'),
    ('22011000', 'Soft Drink'),
    ('22019000', 'Gelo'),
    ('22021000', 'Soft Drink'),
    ('22029100', 'Cervejas'),
    ('22029900', 'Soft Drink'),
    ('22030000', 'Cervejas'),
    ('22041010', 'Destilados'),
    ('22041090', 'Destilados'),
    ('22042100', 'Destilados'),
    ('22051000', 'Destilados'),
    ('22060090', 'Destilados'),
    ('22072019', 'Material de Limpeza'),
    ('22083020', 'Destilados'),
    ('22084000', 'Destilados'),
    ('22085000', 'Congelados'),
    ('22086000', 'Destilados'),
    ('22087000', 'Destilados'),
    ('22089000', 'Destilados'),
    ('25010020', 'Não perecíveis'),
    ('28112100', 'Cervejas'),
    ('28112990', 'Insumos - Bar'),
    ('28289011', 'Material de Limpeza'),
    ('32081010', 'Insumos - Drinks'),
    ('34013000', 'Material de Limpeza'),
    ('34029039', 'Material de Limpeza'),
    ('38089919', 'Material de Limpeza'),
    ('38249941', 'Material de Limpeza'),
    ('39201010', 'Embalagens e descartáveis'),
    ('39201099', 'Embalagens e descartáveis'),
    ('39231090', 'Embalagens e descartáveis'),
    ('39232910', 'Material de Limpeza'),
    ('39241000', 'Embalagens e descartáveis'),
    ('39249000', 'Material de Limpeza'),
    ('40151900', 'Material de Limpeza'),
    ('42029200', 'Embalagens e descartáveis'),
    ('48101399', 'Embalagens e descartáveis'),
    ('48119019', 'Embalagens e descartáveis'),
    ('48194000', 'Embalagens e descartáveis'),
    ('48236900', 'Embalagens e descartáveis'),
    ('48237000', 'Embalagens e descartáveis'),
    ('56039240', 'Embalagens e descartáveis'),
    ('63071000', 'Material de Limpeza'),
    ('65050090', 'Embalagens e descartáveis'),
    ('65069900', 'Embalagens e descartáveis'),
    ('68053090', 'Material de Limpeza'),
    ('70132800', 'Insumos - Bar'),
    ('70133700', 'Insumos - Bar'),
    ('76071990', 'Embalagens e descartáveis'),
    ('96039000', 'Material de Limpeza')
  ) AS v(ncm, cat_name)
  JOIN public.company_product_categories c
    ON c.company_id = p_company_id AND c.name = v.cat_name
  ON CONFLICT ON CONSTRAINT company_ncm_category_rules_company_ncm_unique DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_company_ncm_category_rules(UUID) IS
  'Copia NCMs unívocos da planilha de estoque. Só preenche se a empresa ainda não tem regras.';

CREATE OR REPLACE FUNCTION public.seed_default_company_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_financial_categories_v4(NEW.id);
  PERFORM public.seed_company_product_categories(NEW.id);
  PERFORM public.seed_company_ncm_category_rules(NEW.id);
  RETURN NEW;
END;
$$;

-- Empresas já existentes: catálogo novo sem trocar o plano DRE nem despejar NCMs.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies
  LOOP
    PERFORM public.seed_company_product_categories(r.id);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.list_company_ncms(UUID);

CREATE FUNCTION public.list_company_ncms(p_company_id UUID)
RETURNS TABLE (
  ncm TEXT,
  product_count BIGINT,
  expense_item_count BIGINT,
  sample_product_names TEXT[],
  product_category_id UUID,
  dre_category_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  WITH observed AS (
    SELECT
      public.normalize_ncm_8(p.ncm) AS ncm,
      p.name AS sample_name,
      1 AS product_hit,
      0 AS item_hit
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND public.normalize_ncm_8(p.ncm) IS NOT NULL
    UNION ALL
    SELECT
      public.normalize_ncm_8(ei.ncm),
      ei.product_name,
      0,
      1
    FROM public.expense_items ei
    WHERE ei.company_id = p_company_id
      AND public.normalize_ncm_8(ei.ncm) IS NOT NULL
    UNION ALL
    SELECT
      r.ncm,
      NULL,
      0,
      0
    FROM public.company_ncm_category_rules r
    WHERE r.company_id = p_company_id
  ),
  agg AS (
    SELECT
      o.ncm,
      SUM(o.product_hit)::BIGINT AS product_count,
      SUM(o.item_hit)::BIGINT AS expense_item_count,
      COALESCE(
        (
          array_agg(DISTINCT NULLIF(btrim(o.sample_name), '') ORDER BY NULLIF(btrim(o.sample_name), ''))
          FILTER (WHERE NULLIF(btrim(o.sample_name), '') IS NOT NULL)
        )[1:3],
        ARRAY[]::TEXT[]
      ) AS sample_product_names
    FROM observed o
    WHERE o.ncm IS NOT NULL
    GROUP BY o.ncm
  )
  SELECT
    a.ncm,
    a.product_count,
    a.expense_item_count,
    a.sample_product_names,
    r.product_category_id,
    pc.default_dre_category_id
  FROM agg a
  LEFT JOIN public.company_ncm_category_rules r
    ON r.company_id = p_company_id AND r.ncm = a.ncm
  LEFT JOIN public.company_product_categories pc
    ON pc.id = r.product_category_id
  ORDER BY (r.product_category_id IS NULL) DESC, a.ncm;
END;
$$;

COMMENT ON FUNCTION public.list_company_ncms(UUID) IS
  'NCMs da empresa com categoria de produto e Conta do DRE derivada, se houver.';

GRANT EXECUTE ON FUNCTION public.list_company_ncms(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_product_with_stock_in(
  p_company_id UUID,
  p_product JSONB,
  p_quantity NUMERIC,
  p_unit_value NUMERIC DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'nfe_product_create',
  p_reference_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_name TEXT;
  v_unit TEXT;
  v_qty NUMERIC;
  v_unit_value NUMERIC;
  v_default_cat UUID;
  v_product_cat UUID;
  v_composes BOOLEAN;
  v_cat_name TEXT;
  v_dre UUID;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'create_product_with_stock_in: company_id obrigatório';
  END IF;

  v_qty := COALESCE(p_quantity, 0);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'create_product_with_stock_in: quantidade de entrada deve ser > 0 (recebido %)', v_qty;
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_product ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'create_product_with_stock_in: name obrigatório';
  END IF;

  v_unit := COALESCE(NULLIF(btrim(COALESCE(p_product ->> 'unit', '')), ''), 'un');
  v_unit_value := CASE
    WHEN p_unit_value IS NOT NULL AND p_unit_value > 0 THEN p_unit_value
    ELSE NULL
  END;
  v_default_cat := NULLIF(btrim(COALESCE(p_product ->> 'default_expense_category_id', '')), '')::UUID;
  v_product_cat := NULLIF(btrim(COALESCE(p_product ->> 'product_category_id', '')), '')::UUID;

  IF v_product_cat IS NOT NULL THEN
    SELECT name, default_dre_category_id
    INTO v_cat_name, v_dre
    FROM public.company_product_categories
    WHERE id = v_product_cat AND company_id = p_company_id;
    IF v_cat_name IS NULL THEN
      v_product_cat := NULL;
    ELSIF v_default_cat IS NULL THEN
      v_default_cat := v_dre;
    END IF;
  END IF;

  v_composes := COALESCE((p_product ->> 'composes_cmv')::BOOLEAN, true);
  IF p_product ? 'composes_cmv' THEN
    v_composes := COALESCE((p_product ->> 'composes_cmv')::BOOLEAN, true);
  ELSIF v_cat_name IN ('Gás', 'Coleta de óleo', 'Material de Limpeza') THEN
    v_composes := false;
  END IF;

  INSERT INTO public.products (
    company_id,
    name,
    unit,
    ncm,
    cfop,
    csosn,
    ean,
    min_quantity,
    current_quantity,
    canonical_name,
    is_active,
    stock_control_type,
    unit_conversions,
    last_unit_value,
    last_unit_value_unit_code,
    last_unit_value_stock,
    average_cost,
    default_expense_category_id,
    composes_cmv
  ) VALUES (
    p_company_id,
    left(v_name, 512),
    left(v_unit, 32),
    NULLIF(btrim(COALESCE(p_product ->> 'ncm', '')), ''),
    NULLIF(btrim(COALESCE(p_product ->> 'cfop', '')), ''),
    NULLIF(btrim(COALESCE(p_product ->> 'csosn', '')), ''),
    NULLIF(btrim(COALESCE(p_product ->> 'ean', '')), ''),
    COALESCE((p_product ->> 'min_quantity')::NUMERIC, 0),
    0,
    NULLIF(btrim(COALESCE(p_product ->> 'canonical_name', '')), ''),
    COALESCE((p_product ->> 'is_active')::BOOLEAN, true),
    COALESCE(NULLIF(btrim(COALESCE(p_product ->> 'stock_control_type', '')), ''), 'DIRECT'),
    CASE
      WHEN jsonb_typeof(p_product -> 'unit_conversions') = 'array'
        THEN p_product -> 'unit_conversions'
      ELSE '[]'::jsonb
    END,
    v_unit_value,
    CASE WHEN v_unit_value IS NOT NULL THEN left(v_unit, 32) ELSE NULL END,
    v_unit_value,
    v_unit_value,
    v_default_cat,
    v_composes
  )
  RETURNING id INTO v_product_id;

  IF v_product_cat IS NOT NULL THEN
    INSERT INTO public.product_category_assignments (company_id, product_id, category_id)
    VALUES (p_company_id, v_product_id, v_product_cat)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.adjust_product_stock(
    v_product_id,
    v_qty,
    'in',
    COALESCE(NULLIF(btrim(p_reference_type), ''), 'nfe_product_create'),
    p_reference_id,
    v_unit_value
  );

  RETURN v_product_id;
END;
$$;

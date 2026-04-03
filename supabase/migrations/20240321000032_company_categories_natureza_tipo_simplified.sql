-- Simplificação do módulo de categorias financeiras:
-- - remove tipo_receita/tipo_despesa (e campos intermediários de grupo)
-- - usa apenas natureza + tipo
-- - hierarquia livre pai-filho via parent_id
-- - validações fortes no banco e regras de uso em boletos

ALTER TABLE public.company_categories
  ADD COLUMN IF NOT EXISTS natureza TEXT,
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS ordem INT NOT NULL DEFAULT 0;

UPDATE public.company_categories
SET ordem = COALESCE(sort_order, ordem, 0);

-- Migração de dados legados para natureza/tipo
UPDATE public.company_categories c
SET
  natureza = CASE
    WHEN COALESCE(c.macro_grupo, 'despesa') = 'receita' THEN 'RECEITA'
    ELSE 'DESPESA'
  END,
  tipo = CASE
    WHEN COALESCE(c.macro_grupo, 'despesa') = 'receita' THEN
      CASE COALESCE(c.tipo_receita, 'operacional')
        WHEN 'operacional' THEN 'OPERACIONAL'
        WHEN 'nao_operacional' THEN 'NAO_OPERACIONAL'
        ELSE 'OPERACIONAL'
      END
    ELSE
      CASE COALESCE(c.tipo_despesa, 'variavel')
        WHEN 'cmv' THEN 'CMV'
        WHEN 'variavel' THEN 'VARIAVEL'
        WHEN 'fixa' THEN 'FIXA'
        WHEN 'investimentos_financiamentos' THEN 'INVESTIMENTOS_FINANCIAMENTOS'
        WHEN 'impostos' THEN 'IMPOSTOS'
        ELSE 'VARIAVEL'
      END
  END
WHERE c.natureza IS NULL OR c.tipo IS NULL;

ALTER TABLE public.company_categories
  ALTER COLUMN natureza SET NOT NULL,
  ALTER COLUMN tipo SET NOT NULL;

ALTER TABLE public.company_categories
  DROP CONSTRAINT IF EXISTS company_categories_natureza_check;
ALTER TABLE public.company_categories
  ADD CONSTRAINT company_categories_natureza_check
  CHECK (natureza IN ('RECEITA', 'DESPESA'));

ALTER TABLE public.company_categories
  DROP CONSTRAINT IF EXISTS company_categories_tipo_check;
ALTER TABLE public.company_categories
  ADD CONSTRAINT company_categories_tipo_check
  CHECK (
    tipo IN (
      'OPERACIONAL',
      'NAO_OPERACIONAL',
      'CMV',
      'VARIAVEL',
      'FIXA',
      'IMPOSTOS',
      'INVESTIMENTOS_FINANCIAMENTOS'
    )
  );

ALTER TABLE public.company_categories
  DROP CONSTRAINT IF EXISTS company_categories_natureza_tipo_combo_check;
ALTER TABLE public.company_categories
  ADD CONSTRAINT company_categories_natureza_tipo_combo_check
  CHECK (
    (natureza = 'RECEITA' AND tipo IN ('OPERACIONAL', 'NAO_OPERACIONAL'))
    OR
    (natureza = 'DESPESA' AND tipo IN ('CMV', 'VARIAVEL', 'FIXA', 'IMPOSTOS', 'INVESTIMENTOS_FINANCIAMENTOS'))
  );

-- Pai deve ser da mesma empresa e mesma natureza; impede ciclos
CREATE OR REPLACE FUNCTION public.company_categories_validate_parent_simple()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_company UUID;
  v_parent_natureza TEXT;
  v_cycle_found BOOLEAN;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT company_id, natureza
  INTO v_parent_company, v_parent_natureza
  FROM public.company_categories
  WHERE id = NEW.parent_id;

  IF v_parent_company IS NULL THEN
    RAISE EXCEPTION 'Categoria pai não encontrada';
  END IF;

  IF v_parent_company <> NEW.company_id THEN
    RAISE EXCEPTION 'Categoria pai deve ser da mesma empresa';
  END IF;

  IF v_parent_natureza <> NEW.natureza THEN
    RAISE EXCEPTION 'Categoria pai deve ter a mesma natureza da categoria filha';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id
      FROM public.company_categories
      WHERE id = NEW.parent_id
      UNION ALL
      SELECT c.id, c.parent_id
      FROM public.company_categories c
      JOIN ancestry a ON c.id = a.parent_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestry WHERE id = NEW.id)
    INTO v_cycle_found;

    IF v_cycle_found THEN
      RAISE EXCEPTION 'Hierarquia inválida: ciclo detectado';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_categories_validate_hierarchy ON public.company_categories;
DROP TRIGGER IF EXISTS tr_company_categories_validate_parent_simple ON public.company_categories;
CREATE TRIGGER tr_company_categories_validate_parent_simple
  BEFORE INSERT OR UPDATE OF parent_id, company_id, natureza
  ON public.company_categories
  FOR EACH ROW
  EXECUTE PROCEDURE public.company_categories_validate_parent_simple();

-- Regra de delete: padrão e categorias em uso não podem ser excluídas
CREATE OR REPLACE FUNCTION public.company_categories_prevent_delete_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(OLD.padrao_sistema, false) THEN
    RAISE EXCEPTION 'Categoria padrão não pode ser excluída fisicamente. Use ativo = false.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.boletos b WHERE b.company_category_id = OLD.id) THEN
    RAISE EXCEPTION 'Categoria em uso por lançamentos. Arquive (ativo = false).';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_categories_prevent_delete ON public.company_categories;
CREATE TRIGGER tr_company_categories_prevent_delete
  BEFORE DELETE ON public.company_categories
  FOR EACH ROW
  EXECUTE PROCEDURE public.company_categories_prevent_delete_default();

-- Boletos: somente categorias de DESPESA ativas e folhas (sem filhos)
CREATE OR REPLACE FUNCTION public.boletos_company_category_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_category_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_categories cc
    WHERE cc.id = NEW.company_category_id
      AND cc.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'A categoria deve pertencer à mesma empresa do boleto';
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND NEW.company_category_id IS DISTINCT FROM OLD.company_category_id) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.company_categories cc
      WHERE cc.id = NEW.company_category_id
        AND cc.natureza = 'DESPESA'
        AND COALESCE(cc.ativo, true) = true
        AND NOT EXISTS (
          SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id
        )
    ) THEN
      RAISE EXCEPTION 'Boletos exigem categoria de DESPESA ativa e sem filhos';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Seed simplificado (árvore pai-filho; sem campos de grupo/subgrupo)
DROP FUNCTION IF EXISTS public.seed_financial_categories_v2(UUID);
CREATE OR REPLACE FUNCTION public.seed_financial_categories_v3(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_op UUID;
  r_nop UUID;
  d_cmv UUID;
  d_var UUID;
  d_fix UUID;
  d_fix_estrutura UUID;
  d_fix_gente UUID;
  d_fix_adm UUID;
  d_fix_mkt UUID;
  d_inv UUID;
  d_imp UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_categories
    WHERE company_id = p_company_id AND COALESCE(padrao_sistema, false) = true
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'Receita Operacional', 10, 'RECEITA', 'OPERACIONAL', true, true, true)
  RETURNING id INTO r_op;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, r_op, 'Vendas de produtos', 0, 'RECEITA', 'OPERACIONAL', true, true, true),
    (p_company_id, r_op, 'Vendas de bebidas', 1, 'RECEITA', 'OPERACIONAL', true, true, true),
    (p_company_id, r_op, 'Taxa de serviço', 2, 'RECEITA', 'OPERACIONAL', true, true, true),
    (p_company_id, r_op, 'Receita de delivery', 3, 'RECEITA', 'OPERACIONAL', true, true, true),
    (p_company_id, r_op, 'Outras receitas operacionais', 4, 'RECEITA', 'OPERACIONAL', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'Receitas Não Operacionais', 20, 'RECEITA', 'NAO_OPERACIONAL', true, true, true)
  RETURNING id INTO r_nop;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, r_nop, 'Rendimentos financeiros', 0, 'RECEITA', 'NAO_OPERACIONAL', true, true, true),
    (p_company_id, r_nop, 'Bonificações e incentivos', 1, 'RECEITA', 'NAO_OPERACIONAL', true, true, true),
    (p_company_id, r_nop, 'Outras receitas não operacionais', 2, 'RECEITA', 'NAO_OPERACIONAL', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'CMV', 30, 'DESPESA', 'CMV', true, true, true)
  RETURNING id INTO d_cmv;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_cmv, 'Alimentos', 0, 'DESPESA', 'CMV', true, true, true),
    (p_company_id, d_cmv, 'Bebidas', 1, 'DESPESA', 'CMV', true, true, true),
    (p_company_id, d_cmv, 'Embalagens e descartáveis', 2, 'DESPESA', 'CMV', true, true, true),
    (p_company_id, d_cmv, 'Outras - CMV', 3, 'DESPESA', 'CMV', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'Despesas Variáveis', 40, 'DESPESA', 'VARIAVEL', true, true, true)
  RETURNING id INTO d_var;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_var, 'Custos de franquia', 0, 'DESPESA', 'VARIAVEL', true, true, true),
    (p_company_id, d_var, 'Comissão de vendas', 1, 'DESPESA', 'VARIAVEL', true, true, true),
    (p_company_id, d_var, 'Entregadores e frete', 2, 'DESPESA', 'VARIAVEL', true, true, true),
    (p_company_id, d_var, 'Taxas de marketplace', 3, 'DESPESA', 'VARIAVEL', true, true, true),
    (p_company_id, d_var, 'Taxas de meios de pagamento', 4, 'DESPESA', 'VARIAVEL', true, true, true),
    (p_company_id, d_var, 'Outras - Variáveis', 5, 'DESPESA', 'VARIAVEL', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'Despesas Fixas', 50, 'DESPESA', 'FIXA', true, true, true)
  RETURNING id INTO d_fix;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, d_fix, 'Estrutura e manutenção', 0, 'DESPESA', 'FIXA', true, true, true)
  RETURNING id INTO d_fix_estrutura;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_fix_estrutura, 'Aluguel, IPTU, condomínio e outros', 0, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_estrutura, 'Energia, gás, água e outros', 1, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_estrutura, 'Material e serviços de limpeza', 2, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_estrutura, 'Manutenção', 3, 'DESPESA', 'FIXA', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, d_fix, 'Gente e gestão', 1, 'DESPESA', 'FIXA', true, true, true)
  RETURNING id INTO d_fix_gente;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_fix_gente, 'Salários, encargos e benefícios', 0, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_gente, 'Pró-labore', 1, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_gente, 'Serviços profissionais, consultorias e cursos', 2, 'DESPESA', 'FIXA', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, d_fix, 'Despesas administrativas gerais', 2, 'DESPESA', 'FIXA', true, true, true)
  RETURNING id INTO d_fix_adm;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_fix_adm, 'Sistemas e tecnologia', 0, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_adm, 'Telefone e internet', 1, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_adm, 'Material de escritório', 2, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_adm, 'Serviços bancários', 3, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_adm, 'Outras - despesas fixas', 4, 'DESPESA', 'FIXA', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, d_fix, 'Marketing e Publicidade', 3, 'DESPESA', 'FIXA', true, true, true)
  RETURNING id INTO d_fix_mkt;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_fix_mkt, 'Tráfego pago', 0, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_mkt, 'Redes sociais e conteúdo', 1, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_mkt, 'Impressos e divulgação local', 2, 'DESPESA', 'FIXA', true, true, true),
    (p_company_id, d_fix_mkt, 'Outras - marketing', 3, 'DESPESA', 'FIXA', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'Investimentos e Financiamentos', 60, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true)
  RETURNING id INTO d_inv;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre) VALUES
    (p_company_id, d_inv, 'Equipamento e infraestrutura', 0, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true),
    (p_company_id, d_inv, 'Reforma e melhorias', 1, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true),
    (p_company_id, d_inv, 'Pagamento de empréstimos e juros', 2, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true),
    (p_company_id, d_inv, 'Aquisição de ativos', 3, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true),
    (p_company_id, d_inv, 'Outras - investimentos e financiamentos', 4, 'DESPESA', 'INVESTIMENTOS_FINANCIAMENTOS', true, true, true);

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, NULL, 'Impostos', 70, 'DESPESA', 'IMPOSTOS', true, true, true)
  RETURNING id INTO d_imp;

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre)
  VALUES (p_company_id, d_imp, 'DAS - Imposto sobre faturamento', 0, 'DESPESA', 'IMPOSTOS', true, true, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_default_company_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_financial_categories_v3(NEW.id);
  RETURN NEW;
END;
$$;

-- Garantir plano padrão nas empresas já existentes sem categorias padrão
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies
  LOOP
    PERFORM public.seed_financial_categories_v3(r.id);
  END LOOP;
END $$;

-- Campos antigos removidos do modelo simplificado
ALTER TABLE public.company_categories
  DROP COLUMN IF EXISTS tipo_receita,
  DROP COLUMN IF EXISTS tipo_despesa,
  DROP COLUMN IF EXISTS macro_grupo,
  DROP COLUMN IF EXISTS grupo_principal,
  DROP COLUMN IF EXISTS subgrupo,
  DROP COLUMN IF EXISTS is_grouping;

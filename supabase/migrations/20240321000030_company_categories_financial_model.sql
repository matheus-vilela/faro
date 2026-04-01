-- Plano financeiro: colunas macro Receita/Despesa, tipos, pastas vs folhas, índices, função de seed.
-- Validações rígidas e gatilhos em boletos entram em 20240321000031 (após migração de dados).

ALTER TABLE public.company_categories
  ADD COLUMN IF NOT EXISTS macro_grupo TEXT NOT NULL DEFAULT 'despesa'
    CHECK (macro_grupo IN ('receita', 'despesa')),
  ADD COLUMN IF NOT EXISTS tipo_receita TEXT
    CHECK (tipo_receita IS NULL OR tipo_receita IN ('operacional', 'nao_operacional')),
  ADD COLUMN IF NOT EXISTS tipo_despesa TEXT
    CHECK (
      tipo_despesa IS NULL
      OR tipo_despesa IN (
        'cmv',
        'variavel',
        'fixa',
        'investimentos_financiamentos',
        'impostos'
      )
    ),
  ADD COLUMN IF NOT EXISTS grupo_principal TEXT,
  ADD COLUMN IF NOT EXISTS subgrupo TEXT,
  ADD COLUMN IF NOT EXISTS is_grouping BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS padrao_sistema BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incluir_no_dre BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.company_categories.macro_grupo IS 'receita: recebimentos (futuro); despesa: contas a pagar.';
COMMENT ON COLUMN public.company_categories.is_grouping IS 'true = grupo/subgrupo; false = folha para lançamento.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_categories_root_name
  ON public.company_categories (company_id, lower(trim(name)))
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_categories_child_name
  ON public.company_categories (company_id, parent_id, lower(trim(name)))
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_categories_despesa_folhas_ativas
  ON public.company_categories (company_id, ativo)
  WHERE macro_grupo = 'despesa' AND is_grouping = false;

DROP TRIGGER IF EXISTS tr_company_categories_validate_parent ON public.company_categories;
DROP FUNCTION IF EXISTS public.company_categories_validate_parent();

CREATE OR REPLACE FUNCTION public.company_categories_validate_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_company UUID;
  v_parent_grouping BOOLEAN;
  v_parent_macro TEXT;
  v_tr TEXT;
  v_td TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    IF EXISTS (
      SELECT 1 FROM public.company_categories c
      WHERE c.parent_id = OLD.id AND c.company_id = OLD.company_id
    ) THEN
      RAISE EXCEPTION 'Não é possível alterar o pai enquanto existirem filhos.';
    END IF;
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT company_id, is_grouping, macro_grupo, tipo_receita, tipo_despesa
    INTO v_parent_company, v_parent_grouping, v_parent_macro, v_tr, v_td
    FROM public.company_categories
    WHERE id = NEW.parent_id;

    IF v_parent_company IS NULL THEN
      RAISE EXCEPTION 'Categoria pai não encontrada';
    END IF;

    IF v_parent_company <> NEW.company_id THEN
      RAISE EXCEPTION 'O pai deve pertencer à mesma empresa';
    END IF;

    IF v_parent_grouping = false THEN
      RAISE EXCEPTION 'Apenas grupos ou subgrupos podem ter filhos';
    END IF;

    NEW.macro_grupo := v_parent_macro;
    IF v_parent_macro = 'receita' THEN
      NEW.tipo_receita := v_tr;
      NEW.tipo_despesa := NULL;
    ELSE
      NEW.tipo_despesa := v_td;
      NEW.tipo_receita := NULL;
    END IF;
  END IF;

  IF NEW.macro_grupo = 'receita' THEN
    IF NEW.tipo_receita IS NULL THEN
      RAISE EXCEPTION 'Receita exige tipo_receita';
    END IF;
    IF NEW.tipo_despesa IS NOT NULL THEN
      RAISE EXCEPTION 'Receita não pode ter tipo_despesa';
    END IF;
  ELSIF NEW.macro_grupo = 'despesa' THEN
    IF NEW.tipo_despesa IS NULL THEN
      RAISE EXCEPTION 'Despesa exige tipo_despesa';
    END IF;
    IF NEW.tipo_receita IS NOT NULL THEN
      RAISE EXCEPTION 'Despesa não pode ter tipo_receita';
    END IF;
  END IF;

  IF NEW.parent_id IS NULL AND NEW.is_grouping = false THEN
    RAISE EXCEPTION 'Na raiz só são permitidos grupos principais (pastas)';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.company_categories_prevent_delete_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.padrao_sistema = true THEN
    RAISE EXCEPTION 'Categoria padrão não pode ser excluída fisicamente. Desative (ativo = false).';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.boletos b WHERE b.company_category_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Categoria em uso em contas a pagar: use ativo = false para arquivar.';
  END IF;
  RETURN OLD;
END;
$$;

-- Conteúdo da seed (definido aqui; executada por empresa em 00031 e em novas empresas via trigger)
CREATE OR REPLACE FUNCTION public.seed_financial_categories_v2(p_company_id UUID)
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
  fe UUID;
  fg UUID;
  fa UUID;
  fm UUID;
  d_inv UUID;
  d_imp UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.company_categories
    WHERE company_id = p_company_id AND padrao_sistema = true
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'Receita Operacional', 10,
    'receita', 'operacional', NULL, 'Receita Operacional', NULL,
    true, true, true, true
  ) RETURNING id INTO r_op;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, r_op, 'Vendas de produtos', 0, 'receita', 'operacional', NULL, 'Receita Operacional', NULL, false, true, true, true),
    (p_company_id, r_op, 'Vendas de bebidas', 1, 'receita', 'operacional', NULL, 'Receita Operacional', NULL, false, true, true, true),
    (p_company_id, r_op, 'Taxa de serviço', 2, 'receita', 'operacional', NULL, 'Receita Operacional', NULL, false, true, true, true),
    (p_company_id, r_op, 'Receita de delivery', 3, 'receita', 'operacional', NULL, 'Receita Operacional', NULL, false, true, true, true),
    (p_company_id, r_op, 'Outras receitas operacionais', 4, 'receita', 'operacional', NULL, 'Receita Operacional', NULL, false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'Receitas Não Operacionais', 20,
    'receita', 'nao_operacional', NULL, 'Receitas Não Operacionais', NULL,
    true, true, true, true
  ) RETURNING id INTO r_nop;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, r_nop, 'Rendimentos financeiros', 0, 'receita', 'nao_operacional', NULL, 'Receitas Não Operacionais', NULL, false, true, true, true),
    (p_company_id, r_nop, 'Bonificações e incentivos', 1, 'receita', 'nao_operacional', NULL, 'Receitas Não Operacionais', NULL, false, true, true, true),
    (p_company_id, r_nop, 'Outras receitas não operacionais', 2, 'receita', 'nao_operacional', NULL, 'Receitas Não Operacionais', NULL, false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'CMV', 30,
    'despesa', NULL, 'cmv', 'CMV', NULL,
    true, true, true, true
  ) RETURNING id INTO d_cmv;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, d_cmv, 'Alimentos', 0, 'despesa', NULL, 'cmv', 'CMV', NULL, false, true, true, true),
    (p_company_id, d_cmv, 'Bebidas', 1, 'despesa', NULL, 'cmv', 'CMV', NULL, false, true, true, true),
    (p_company_id, d_cmv, 'Embalagens e descartáveis', 2, 'despesa', NULL, 'cmv', 'CMV', NULL, false, true, true, true),
    (p_company_id, d_cmv, 'Outras - CMV', 3, 'despesa', NULL, 'cmv', 'CMV', NULL, false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'Despesas Variáveis', 40,
    'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL,
    true, true, true, true
  ) RETURNING id INTO d_var;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, d_var, 'Custos de franquia', 0, 'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL, false, true, true, true),
    (p_company_id, d_var, 'Comissão de vendas', 1, 'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL, false, true, true, true),
    (p_company_id, d_var, 'Entregadores e frete', 2, 'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL, false, true, true, true),
    (p_company_id, d_var, 'Taxas de marketplace', 3, 'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL, false, true, true, true),
    (p_company_id, d_var, 'Taxas de meios de pagamento', 4, 'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL, false, true, true, true),
    (p_company_id, d_var, 'Outras - Variáveis', 5, 'despesa', NULL, 'variavel', 'Despesas Variáveis', NULL, false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'Despesas Fixas', 50,
    'despesa', NULL, 'fixa', 'Despesas Fixas', NULL,
    true, true, true, true
  ) RETURNING id INTO d_fix;

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, d_fix, 'Estrutura e manutenção', 0,
    'despesa', NULL, 'fixa', 'Despesas Fixas', 'Estrutura e manutenção',
    true, true, true, true
  ) RETURNING id INTO fe;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, fe, 'Aluguel, IPTU, condomínio e outros', 0, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Estrutura e manutenção', false, true, true, true),
    (p_company_id, fe, 'Energia, gás, água e outros', 1, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Estrutura e manutenção', false, true, true, true),
    (p_company_id, fe, 'Material e serviços de limpeza', 2, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Estrutura e manutenção', false, true, true, true),
    (p_company_id, fe, 'Manutenção', 3, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Estrutura e manutenção', false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, d_fix, 'Gente e gestão', 1,
    'despesa', NULL, 'fixa', 'Despesas Fixas', 'Gente e gestão',
    true, true, true, true
  ) RETURNING id INTO fg;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, fg, 'Salários, encargos e benefícios', 0, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Gente e gestão', false, true, true, true),
    (p_company_id, fg, 'Pró-labore', 1, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Gente e gestão', false, true, true, true),
    (p_company_id, fg, 'Serviços profissionais, consultorias e cursos', 2, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Gente e gestão', false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, d_fix, 'Despesas administrativas gerais', 2,
    'despesa', NULL, 'fixa', 'Despesas Fixas', 'Despesas administrativas gerais',
    true, true, true, true
  ) RETURNING id INTO fa;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, fa, 'Sistemas e tecnologia', 0, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Despesas administrativas gerais', false, true, true, true),
    (p_company_id, fa, 'Telefone e internet', 1, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Despesas administrativas gerais', false, true, true, true),
    (p_company_id, fa, 'Material de escritório', 2, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Despesas administrativas gerais', false, true, true, true),
    (p_company_id, fa, 'Serviços bancários', 3, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Despesas administrativas gerais', false, true, true, true),
    (p_company_id, fa, 'Outras - despesas fixas', 4, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Despesas administrativas gerais', false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, d_fix, 'Marketing e Publicidade', 3,
    'despesa', NULL, 'fixa', 'Despesas Fixas', 'Marketing e Publicidade',
    true, true, true, true
  ) RETURNING id INTO fm;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, fm, 'Tráfego pago', 0, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Marketing e Publicidade', false, true, true, true),
    (p_company_id, fm, 'Redes sociais e conteúdo', 1, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Marketing e Publicidade', false, true, true, true),
    (p_company_id, fm, 'Impressos e divulgação local', 2, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Marketing e Publicidade', false, true, true, true),
    (p_company_id, fm, 'Outras - marketing', 3, 'despesa', NULL, 'fixa', 'Despesas Fixas', 'Marketing e Publicidade', false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'Investimentos e Financiamentos', 60,
    'despesa', NULL, 'investimentos_financiamentos', 'Investimentos e Financiamentos', NULL,
    true, true, true, true
  ) RETURNING id INTO d_inv;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, d_inv, 'Equipamento e infraestrutura', 0, 'despesa', NULL, 'investimentos_financiamentos', 'Investimentos e Financiamentos', NULL, false, true, true, true),
    (p_company_id, d_inv, 'Reforma e melhorias', 1, 'despesa', NULL, 'investimentos_financiamentos', 'Investimentos e Financiamentos', NULL, false, true, true, true),
    (p_company_id, d_inv, 'Pagamento de empréstimos e juros', 2, 'despesa', NULL, 'investimentos_financiamentos', 'Investimentos e Financiamentos', NULL, false, true, true, true),
    (p_company_id, d_inv, 'Aquisição de ativos', 3, 'despesa', NULL, 'investimentos_financiamentos', 'Investimentos e Financiamentos', NULL, false, true, true, true),
    (p_company_id, d_inv, 'Outras - investimentos e financiamentos', 4, 'despesa', NULL, 'investimentos_financiamentos', 'Investimentos e Financiamentos', NULL, false, true, true, true);

  INSERT INTO public.company_categories (
    company_id, parent_id, name, sort_order,
    macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo,
    is_grouping, padrao_sistema, incluir_no_dre, ativo
  ) VALUES (
    p_company_id, NULL, 'Impostos', 70,
    'despesa', NULL, 'impostos', 'Impostos', NULL,
    true, true, true, true
  ) RETURNING id INTO d_imp;

  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order, macro_grupo, tipo_receita, tipo_despesa, grupo_principal, subgrupo, is_grouping, padrao_sistema, incluir_no_dre, ativo) VALUES
    (p_company_id, d_imp, 'DAS - Imposto sobre faturamento', 0, 'despesa', NULL, 'impostos', 'Impostos', NULL, false, true, true, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_default_company_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_financial_categories_v2(NEW.id);
  RETURN NEW;
END;
$$;

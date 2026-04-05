-- Plano padrão: inclui folha de dedução da receita (DRE) em novas empresas.
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

  INSERT INTO public.company_categories (company_id, parent_id, name, ordem, natureza, tipo, ativo, padrao_sistema, incluir_no_dre, papel_receita_dre)
  VALUES (p_company_id, r_op, 'Deduções da receita / despesas sobre vendas', 5, 'RECEITA', 'OPERACIONAL', true, true, true, 'DEDUCAO');

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

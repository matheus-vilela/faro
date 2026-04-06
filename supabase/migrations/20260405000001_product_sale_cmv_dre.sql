-- Venda pontual: registrar CMV no DRE (boleto a pagar na folha CMV), alinhado ao custo da baixa de estoque.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cmv_category_id UUID REFERENCES public.company_categories(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.cmv_category_id IS
  'Folha DESPESA tipo CMV para classificar o custo da mercadoria vendida na venda pontual; se nulo, usa folha padrao (ex.: Outras - CMV).';

CREATE OR REPLACE FUNCTION public.create_revenue_entry(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_company_id UUID := (p_payload->>'company_id')::uuid;
  v_entry_date DATE := (p_payload->>'entry_date')::date;
  v_title TEXT := trim(p_payload->>'title');
  v_entry_mode TEXT := p_payload->>'entry_mode';
  v_revenue_type TEXT := p_payload->>'revenue_type';
  v_category_id UUID := nullif(p_payload->>'category_id', '')::uuid;
  v_subcategory_id UUID := (p_payload->>'subcategory_id')::uuid;
  v_product_id UUID := nullif(p_payload->>'product_id', '')::uuid;
  v_quantity DECIMAL(14, 4);
  v_pricing_mode TEXT := p_payload->>'pricing_mode';
  v_unit_value DECIMAL(14, 2);
  v_gross DECIMAL(14, 2) := (p_payload->>'gross_amount')::decimal;
  v_tax_type TEXT := p_payload->>'tax_type';
  v_tax_input DECIMAL(14, 4) := coalesce((p_payload->>'tax_value')::decimal, 0);
  v_tax_amount DECIMAL(14, 2);
  v_net DECIMAL(14, 2);
  v_cat_tipo TEXT;
  v_nat TEXT;
  v_cc_company UUID;
  v_deduction_cat_id UUID;
  v_entry_id UUID;
  v_stock NUMERIC;
  v_prod_company UUID;
  v_prod_rev_cat UUID;
  v_prod_avg DECIMAL(12, 4);
  v_prod_last DECIMAL(12, 4);
  v_prod_cmv_cat UUID;
  v_unit_cost_base DECIMAL(14, 6);
  v_cmv_amount DECIMAL(14, 2);
  v_cmv_cat_id UUID;
  v_desc TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  IF v_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  IF v_entry_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data da receita';
  END IF;

  IF v_title IS NULL OR v_title = '' THEN
    RAISE EXCEPTION 'Informe o titulo da receita';
  END IF;

  IF v_entry_mode NOT IN ('manual', 'product_sale') THEN
    RAISE EXCEPTION 'Modo de lancamento invalido';
  END IF;

  IF v_entry_mode = 'manual' AND (
    p_payload->>'subcategory_id' IS NULL OR btrim(p_payload->>'subcategory_id') = ''
  ) THEN
    RAISE EXCEPTION 'Selecione a categoria';
  END IF;

  IF v_revenue_type NOT IN ('operational', 'non_operational') THEN
    RAISE EXCEPTION 'Tipo de receita invalido';
  END IF;

  IF v_entry_mode = 'product_sale' AND v_revenue_type <> 'operational' THEN
    RAISE EXCEPTION 'Venda pontual de produto deve ser classificada como receita operacional';
  END IF;

  IF v_tax_type NOT IN ('currency', 'percentage') THEN
    RAISE EXCEPTION 'Tipo de taxa invalido';
  END IF;

  IF v_gross IS NULL OR v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor bruto deve ser maior que zero';
  END IF;

  v_cmv_amount := 0;
  v_cmv_cat_id := NULL;

  IF v_entry_mode = 'product_sale' THEN
    v_quantity := (p_payload->>'quantity')::decimal;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Informe a quantidade vendida';
    END IF;
    IF v_pricing_mode NOT IN ('unit', 'total') THEN
      RAISE EXCEPTION 'Modo de preco invalido';
    END IF;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o produto';
    END IF;

    SELECT
      p.company_id,
      p.current_quantity,
      p.revenue_category_id,
      p.average_cost,
      p.last_unit_value,
      p.cmv_category_id
    INTO
      v_prod_company,
      v_stock,
      v_prod_rev_cat,
      v_prod_avg,
      v_prod_last,
      v_prod_cmv_cat
    FROM public.products p
    WHERE p.id = v_product_id
    FOR UPDATE;

    IF v_prod_company IS NULL THEN
      RAISE EXCEPTION 'Produto nao encontrado';
    END IF;
    IF v_prod_company <> v_company_id THEN
      RAISE EXCEPTION 'Produto nao pertence a empresa';
    END IF;
    IF v_stock < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para a quantidade informada';
    END IF;

    v_unit_cost_base := coalesce(v_prod_avg, v_prod_last, 0);
    v_cmv_amount := round(v_quantity * v_unit_cost_base, 2);

    IF v_prod_cmv_cat IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.company_categories cc
        WHERE cc.id = v_prod_cmv_cat
          AND cc.company_id = v_company_id
          AND cc.natureza = 'DESPESA'
          AND cc.tipo = 'CMV'
          AND coalesce(cc.ativo, true)
          AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ) THEN
        RAISE EXCEPTION 'A categoria de CMV do produto deve ser uma folha DESPESA tipo CMV desta empresa';
      END IF;
      v_cmv_cat_id := v_prod_cmv_cat;
    END IF;

    IF v_prod_rev_cat IS NOT NULL THEN
      v_subcategory_id := v_prod_rev_cat;
    ELSE
      SELECT cc.id INTO v_subcategory_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'RECEITA'
        AND cc.tipo = 'OPERACIONAL'
        AND coalesce(cc.ativo, true)
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE WHEN lower(cc.name) LIKE '%vendas%' AND lower(cc.name) LIKE '%produt%' THEN 0 ELSE 1 END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;
      IF v_subcategory_id IS NULL THEN
        RAISE EXCEPTION 'Defina uma categoria de receita no cadastro do produto ou cadastre categorias de receita operacional';
      END IF;
    END IF;

    IF v_pricing_mode = 'unit' THEN
      v_unit_value := (p_payload->>'unit_value')::decimal;
      IF v_unit_value IS NULL OR v_unit_value < 0 THEN
        RAISE EXCEPTION 'Valor unitario invalido';
      END IF;
    END IF;
  ELSE
    v_quantity := NULL;
    v_pricing_mode := NULL;
    v_unit_value := NULL;
    v_product_id := NULL;
  END IF;

  -- Imposto / deducao (recalculado no servidor)
  IF v_tax_type = 'percentage' THEN
    v_tax_amount := round(v_gross * v_tax_input / 100.0, 2);
  ELSE
    v_tax_amount := least(greatest(v_tax_input, 0), v_gross);
  END IF;
  v_net := v_gross - v_tax_amount;
  IF v_net < 0 THEN
    RAISE EXCEPTION 'Valor liquido invalido';
  END IF;

  SELECT cc.natureza, cc.company_id, cc.tipo
  INTO v_nat, v_cc_company, v_cat_tipo
  FROM public.company_categories cc
  WHERE cc.id = v_subcategory_id;

  IF v_nat IS NULL THEN
    RAISE EXCEPTION 'Categoria invalida';
  END IF;
  IF v_cc_company <> v_company_id THEN
    RAISE EXCEPTION 'Categoria nao pertence a empresa';
  END IF;
  IF v_nat <> 'RECEITA' THEN
    RAISE EXCEPTION 'Use uma categoria de receita (folha)';
  END IF;

  IF (v_revenue_type = 'operational' AND v_cat_tipo <> 'OPERACIONAL')
     OR (v_revenue_type = 'non_operational' AND v_cat_tipo <> 'NAO_OPERACIONAL') THEN
    RAISE EXCEPTION 'A categoria nao corresponde ao tipo operacional / nao operacional selecionado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = v_subcategory_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria de receita (folha)';
  END IF;

  INSERT INTO public.revenue_entries (
    company_id, created_by, entry_date, title, entry_mode, revenue_type,
    category_id, subcategory_id, product_id, quantity, pricing_mode, unit_value,
    gross_amount, tax_type, tax_value, tax_amount, net_amount, source
  ) VALUES (
    v_company_id, v_uid, v_entry_date, v_title, v_entry_mode, v_revenue_type,
    v_category_id, v_subcategory_id, v_product_id, v_quantity, v_pricing_mode, v_unit_value,
    v_gross, v_tax_type, v_tax_input, v_tax_amount, v_net,
    CASE WHEN v_entry_mode = 'product_sale' THEN 'product_sale' ELSE 'manual' END
  )
  RETURNING id INTO v_entry_id;

  v_desc := 'Receita: ' || left(v_title, 200);

  -- Boletos a receber (competencia = data da receita)
  IF v_revenue_type = 'operational' THEN
    IF v_tax_amount > 0 THEN
      SELECT cc.id INTO v_deduction_cat_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'RECEITA'
        AND cc.tipo = 'OPERACIONAL'
        AND cc.papel_receita_dre = 'DEDUCAO'
        AND coalesce(cc.ativo, true)
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE
          WHEN cc.name = 'Deducoes da receita / despesas sobre vendas' THEN 0
          WHEN cc.name ILIKE 'deducoes da receita%' THEN 1
          ELSE 2
        END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;

      IF v_deduction_cat_id IS NULL THEN
        RAISE EXCEPTION 'Nao foi encontrada a categoria de deducoes da receita (DRE). Execute a migracao do sistema ou cadastre a folha padrao.';
      END IF;

      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );

      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc || ' - Taxas/deducoes', v_entry_date, v_tax_amount, 'pending',
        'payable', v_deduction_cat_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    ELSE
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    END IF;
  ELSE
    -- Nao operacional: mesmo bucket DRE - bruto e deducao na mesma folha
    IF v_tax_amount > 0 THEN
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc || ' - Taxas/deducoes', v_entry_date, -v_tax_amount, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    ELSE
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    END IF;
  END IF;

  -- CMV no DRE (mesma competencia da receita), antes da baixa de estoque
  IF v_entry_mode = 'product_sale'
     AND v_revenue_type = 'operational'
     AND v_cmv_amount > 0 THEN
    IF v_cmv_cat_id IS NULL THEN
      SELECT cc.id INTO v_cmv_cat_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'DESPESA'
        AND cc.tipo = 'CMV'
        AND coalesce(cc.ativo, true)
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE WHEN cc.name ILIKE '%outras%' THEN 0 ELSE 1 END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;
    END IF;
    IF v_cmv_cat_id IS NULL THEN
      RAISE EXCEPTION 'Cadastre uma subcategoria de CMV (despesa) ou defina a categoria de CMV no produto para registrar o custo da venda no DRE';
    END IF;

    INSERT INTO public.boletos (
      company_id, expense_id, description, due_date, amount, status,
      flow_type, company_category_id, revenue_entry_id,
      payment_type, barcode, provider, pix_key_type, pix_key,
      bank_name, bank_code, agency, account, account_type
    ) VALUES (
      v_company_id, NULL, v_desc || ' - CMV', v_entry_date, v_cmv_amount, 'pending',
      'payable', v_cmv_cat_id, v_entry_id,
      'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
  END IF;

  IF v_entry_mode = 'product_sale' AND v_product_id IS NOT NULL THEN
    PERFORM public.adjust_product_stock(
      v_product_id,
      -v_quantity,
      'out',
      'revenue_entry',
      v_entry_id
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.create_revenue_entry(jsonb) IS
  'Insere lancamento de receita, boletos a receber para DRE, CMV da venda pontual (contas a pagar) e baixa de estoque.';

CREATE OR REPLACE FUNCTION public.update_revenue_entry(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_entry_id UUID := (p_payload->>'entry_id')::uuid;
  v_old public.revenue_entries%ROWTYPE;
  v_company_id UUID;
  v_entry_date DATE := (p_payload->>'entry_date')::date;
  v_title TEXT := trim(p_payload->>'title');
  v_entry_mode TEXT := p_payload->>'entry_mode';
  v_revenue_type TEXT := p_payload->>'revenue_type';
  v_category_id UUID := nullif(p_payload->>'category_id', '')::uuid;
  v_subcategory_id UUID := (p_payload->>'subcategory_id')::uuid;
  v_product_id UUID := nullif(p_payload->>'product_id', '')::uuid;
  v_quantity DECIMAL(14, 4);
  v_pricing_mode TEXT := p_payload->>'pricing_mode';
  v_unit_value DECIMAL(14, 2);
  v_gross DECIMAL(14, 2) := (p_payload->>'gross_amount')::decimal;
  v_tax_type TEXT := p_payload->>'tax_type';
  v_tax_input DECIMAL(14, 4) := coalesce((p_payload->>'tax_value')::decimal, 0);
  v_tax_amount DECIMAL(14, 2);
  v_net DECIMAL(14, 2);
  v_cat_tipo TEXT;
  v_nat TEXT;
  v_cc_company UUID;
  v_deduction_cat_id UUID;
  v_stock NUMERIC;
  v_prod_company UUID;
  v_prod_rev_cat UUID;
  v_prod_avg DECIMAL(12, 4);
  v_prod_last DECIMAL(12, 4);
  v_prod_cmv_cat UUID;
  v_unit_cost_base DECIMAL(14, 6);
  v_cmv_amount DECIMAL(14, 2);
  v_cmv_cat_id UUID;
  v_desc TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  IF p_payload->>'entry_id' IS NULL OR btrim(p_payload->>'entry_id') = '' THEN
    RAISE EXCEPTION 'Informe o lancamento';
  END IF;

  SELECT * INTO v_old FROM public.revenue_entries WHERE id = v_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lancamento nao encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = v_old.company_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  v_company_id := v_old.company_id;

  IF v_old.entry_mode = 'product_sale'
     AND v_old.product_id IS NOT NULL
     AND coalesce(v_old.quantity, 0) > 0 THEN
    PERFORM public.adjust_product_stock(
      v_old.product_id,
      v_old.quantity,
      'in',
      'revenue_entry_update',
      v_entry_id
    );
  END IF;

  DELETE FROM public.boletos WHERE revenue_entry_id = v_entry_id;

  IF v_entry_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data da receita';
  END IF;

  IF v_title IS NULL OR v_title = '' THEN
    RAISE EXCEPTION 'Informe o titulo da receita';
  END IF;

  IF v_entry_mode NOT IN ('manual', 'product_sale') THEN
    RAISE EXCEPTION 'Modo de lancamento invalido';
  END IF;

  IF v_entry_mode = 'manual' AND (
    p_payload->>'subcategory_id' IS NULL OR btrim(p_payload->>'subcategory_id') = ''
  ) THEN
    RAISE EXCEPTION 'Selecione a categoria';
  END IF;

  IF v_revenue_type NOT IN ('operational', 'non_operational') THEN
    RAISE EXCEPTION 'Tipo de receita invalido';
  END IF;

  IF v_entry_mode = 'product_sale' AND v_revenue_type <> 'operational' THEN
    RAISE EXCEPTION 'Venda pontual de produto deve ser classificada como receita operacional';
  END IF;

  IF v_tax_type NOT IN ('currency', 'percentage') THEN
    RAISE EXCEPTION 'Tipo de taxa invalido';
  END IF;

  IF v_gross IS NULL OR v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor bruto deve ser maior que zero';
  END IF;

  v_cmv_amount := 0;
  v_cmv_cat_id := NULL;

  IF v_entry_mode = 'product_sale' THEN
    v_quantity := (p_payload->>'quantity')::decimal;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Informe a quantidade vendida';
    END IF;
    IF v_pricing_mode NOT IN ('unit', 'total') THEN
      RAISE EXCEPTION 'Modo de preco invalido';
    END IF;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o produto';
    END IF;

    SELECT
      p.company_id,
      p.current_quantity,
      p.revenue_category_id,
      p.average_cost,
      p.last_unit_value,
      p.cmv_category_id
    INTO
      v_prod_company,
      v_stock,
      v_prod_rev_cat,
      v_prod_avg,
      v_prod_last,
      v_prod_cmv_cat
    FROM public.products p
    WHERE p.id = v_product_id
    FOR UPDATE;

    IF v_prod_company IS NULL THEN
      RAISE EXCEPTION 'Produto nao encontrado';
    END IF;
    IF v_prod_company <> v_company_id THEN
      RAISE EXCEPTION 'Produto nao pertence a empresa';
    END IF;
    IF v_stock < v_quantity THEN
      RAISE EXCEPTION 'Estoque insuficiente para a quantidade informada';
    END IF;

    v_unit_cost_base := coalesce(v_prod_avg, v_prod_last, 0);
    v_cmv_amount := round(v_quantity * v_unit_cost_base, 2);

    IF v_prod_cmv_cat IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.company_categories cc
        WHERE cc.id = v_prod_cmv_cat
          AND cc.company_id = v_company_id
          AND cc.natureza = 'DESPESA'
          AND cc.tipo = 'CMV'
          AND coalesce(cc.ativo, true)
          AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ) THEN
        RAISE EXCEPTION 'A categoria de CMV do produto deve ser uma folha DESPESA tipo CMV desta empresa';
      END IF;
      v_cmv_cat_id := v_prod_cmv_cat;
    END IF;

    IF v_prod_rev_cat IS NOT NULL THEN
      v_subcategory_id := v_prod_rev_cat;
    ELSE
      SELECT cc.id INTO v_subcategory_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'RECEITA'
        AND cc.tipo = 'OPERACIONAL'
        AND coalesce(cc.ativo, true)
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE WHEN lower(cc.name) LIKE '%vendas%' AND lower(cc.name) LIKE '%produt%' THEN 0 ELSE 1 END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;
      IF v_subcategory_id IS NULL THEN
        RAISE EXCEPTION 'Defina uma categoria de receita no cadastro do produto ou cadastre categorias de receita operacional';
      END IF;
    END IF;

    IF v_pricing_mode = 'unit' THEN
      v_unit_value := (p_payload->>'unit_value')::decimal;
      IF v_unit_value IS NULL OR v_unit_value < 0 THEN
        RAISE EXCEPTION 'Valor unitario invalido';
      END IF;
    END IF;
  ELSE
    v_quantity := NULL;
    v_pricing_mode := NULL;
    v_unit_value := NULL;
    v_product_id := NULL;
  END IF;

  IF v_tax_type = 'percentage' THEN
    v_tax_amount := round(v_gross * v_tax_input / 100.0, 2);
  ELSE
    v_tax_amount := least(greatest(v_tax_input, 0), v_gross);
  END IF;
  v_net := v_gross - v_tax_amount;
  IF v_net < 0 THEN
    RAISE EXCEPTION 'Valor liquido invalido';
  END IF;

  SELECT cc.natureza, cc.company_id, cc.tipo
  INTO v_nat, v_cc_company, v_cat_tipo
  FROM public.company_categories cc
  WHERE cc.id = v_subcategory_id;

  IF v_nat IS NULL THEN
    RAISE EXCEPTION 'Categoria invalida';
  END IF;
  IF v_cc_company <> v_company_id THEN
    RAISE EXCEPTION 'Categoria nao pertence a empresa';
  END IF;
  IF v_nat <> 'RECEITA' THEN
    RAISE EXCEPTION 'Use uma categoria de receita (folha)';
  END IF;

  IF (v_revenue_type = 'operational' AND v_cat_tipo <> 'OPERACIONAL')
     OR (v_revenue_type = 'non_operational' AND v_cat_tipo <> 'NAO_OPERACIONAL') THEN
    RAISE EXCEPTION 'A categoria nao corresponde ao tipo operacional / nao operacional selecionado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = v_subcategory_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria de receita (folha)';
  END IF;

  UPDATE public.revenue_entries SET
    entry_date = v_entry_date,
    title = v_title,
    entry_mode = v_entry_mode,
    revenue_type = v_revenue_type,
    category_id = v_category_id,
    subcategory_id = v_subcategory_id,
    product_id = v_product_id,
    quantity = v_quantity,
    pricing_mode = v_pricing_mode,
    unit_value = v_unit_value,
    gross_amount = v_gross,
    tax_type = v_tax_type,
    tax_value = v_tax_input,
    tax_amount = v_tax_amount,
    net_amount = v_net,
    source = CASE WHEN v_entry_mode = 'product_sale' THEN 'product_sale' ELSE 'manual' END,
    updated_at = NOW()
  WHERE id = v_entry_id;

  v_desc := 'Receita: ' || left(v_title, 200);

  IF v_revenue_type = 'operational' THEN
    IF v_tax_amount > 0 THEN
      SELECT cc.id INTO v_deduction_cat_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'RECEITA'
        AND cc.tipo = 'OPERACIONAL'
        AND cc.papel_receita_dre = 'DEDUCAO'
        AND coalesce(cc.ativo, true)
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE
          WHEN cc.name = 'Deducoes da receita / despesas sobre vendas' THEN 0
          WHEN cc.name ILIKE 'deducoes da receita%' THEN 1
          ELSE 2
        END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;

      IF v_deduction_cat_id IS NULL THEN
        RAISE EXCEPTION 'Nao foi encontrada a categoria de deducoes da receita (DRE). Execute a migracao do sistema ou cadastre a folha padrao.';
      END IF;

      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );

      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc || ' - Taxas/deducoes', v_entry_date, v_tax_amount, 'pending',
        'payable', v_deduction_cat_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    ELSE
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    END IF;
  ELSE
    IF v_tax_amount > 0 THEN
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc || ' - Taxas/deducoes', v_entry_date, -v_tax_amount, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    ELSE
      INSERT INTO public.boletos (
        company_id, expense_id, description, due_date, amount, status,
        flow_type, company_category_id, revenue_entry_id,
        payment_type, barcode, provider, pix_key_type, pix_key,
        bank_name, bank_code, agency, account, account_type
      ) VALUES (
        v_company_id, NULL, v_desc, v_entry_date, v_gross, 'pending',
        'receivable', v_subcategory_id, v_entry_id,
        'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
    END IF;
  END IF;

  IF v_entry_mode = 'product_sale'
     AND v_revenue_type = 'operational'
     AND v_cmv_amount > 0 THEN
    IF v_cmv_cat_id IS NULL THEN
      SELECT cc.id INTO v_cmv_cat_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'DESPESA'
        AND cc.tipo = 'CMV'
        AND coalesce(cc.ativo, true)
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE WHEN cc.name ILIKE '%outras%' THEN 0 ELSE 1 END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;
    END IF;
    IF v_cmv_cat_id IS NULL THEN
      RAISE EXCEPTION 'Cadastre uma subcategoria de CMV (despesa) ou defina a categoria de CMV no produto para registrar o custo da venda no DRE';
    END IF;

    INSERT INTO public.boletos (
      company_id, expense_id, description, due_date, amount, status,
      flow_type, company_category_id, revenue_entry_id,
      payment_type, barcode, provider, pix_key_type, pix_key,
      bank_name, bank_code, agency, account, account_type
    ) VALUES (
      v_company_id, NULL, v_desc || ' - CMV', v_entry_date, v_cmv_amount, 'pending',
      'payable', v_cmv_cat_id, v_entry_id,
      'boleto', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
  END IF;

  IF v_entry_mode = 'product_sale' AND v_product_id IS NOT NULL THEN
    PERFORM public.adjust_product_stock(
      v_product_id,
      -v_quantity,
      'out',
      'revenue_entry',
      v_entry_id
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.update_revenue_entry(jsonb) IS
  'Atualiza receita, recria boletos (receita, deducoes, CMV da venda pontual) e ajusta estoque.';

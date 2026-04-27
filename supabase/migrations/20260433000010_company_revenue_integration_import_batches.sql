-- Lotes de importacao automatica de receitas (revenue_entries) por integracao, unidade e dia de referencia.

CREATE TABLE IF NOT EXISTS public.company_revenue_integration_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  reference_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  revenue_entry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_revenue_import_batches_company_provider_date
  ON public.company_revenue_integration_import_batches (company_id, provider, reference_date DESC);

COMMENT ON TABLE public.company_revenue_integration_import_batches IS
  'Controlo de execucoes de import automatico de receitas: um registro por lote (ex.: um dia de referencia). provider alinha-se a company_integrations.provider.';

COMMENT ON COLUMN public.company_revenue_integration_import_batches.reference_date IS
  'Dia de negocio ao qual o bloco importado se refere.';

ALTER TABLE public.revenue_entries
  ADD COLUMN IF NOT EXISTS integration_import_batch_id UUID
  REFERENCES public.company_revenue_integration_import_batches(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.revenue_entries.integration_import_batch_id IS
  'Lote de importacao automatico que originou o lancamento, quando aplicavel.';

CREATE INDEX IF NOT EXISTS idx_revenue_entries_integration_import_batch_id
  ON public.revenue_entries (integration_import_batch_id)
  WHERE integration_import_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.revenue_entries_bump_integration_import_batch_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_revenue_integration_import_batches
  SET revenue_entry_count = revenue_entry_count + 1,
      updated_at = NOW()
  WHERE id = NEW.integration_import_batch_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_revenue_entries_bump_integration_import_batch ON public.revenue_entries;
CREATE TRIGGER tr_revenue_entries_bump_integration_import_batch
  AFTER INSERT ON public.revenue_entries
  FOR EACH ROW
  WHEN (NEW.integration_import_batch_id IS NOT NULL)
  EXECUTE FUNCTION public.revenue_entries_bump_integration_import_batch_count();

ALTER TABLE public.company_revenue_integration_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage company revenue integration import batches"
  ON public.company_revenue_integration_import_batches;
CREATE POLICY "Users can manage company revenue integration import batches"
  ON public.company_revenue_integration_import_batches
  FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT ALL ON public.company_revenue_integration_import_batches TO authenticated, service_role;
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
  v_subcategory_id UUID := CASE
    WHEN p_payload->>'subcategory_id' IS NULL OR btrim(p_payload->>'subcategory_id') = '' THEN NULL
    ELSE (p_payload->>'subcategory_id')::uuid
  END;
  v_product_id UUID := nullif(p_payload->>'product_id', '')::uuid;
  v_recipe_id UUID := nullif(p_payload->>'recipe_id', '')::uuid;
  v_quantity DECIMAL(14, 4);
  v_pricing_mode TEXT := p_payload->>'pricing_mode';
  v_unit_value DECIMAL(14, 2);
  v_gross DECIMAL(14, 2) := (p_payload->>'gross_amount')::decimal;
  v_tax_type TEXT;
  v_tax_input DECIMAL(14, 4);
  v_tax_amount DECIMAL(14, 2);
  v_net DECIMAL(14, 2);
  v_cat_tipo TEXT;
  v_nat TEXT;
  v_cc_company UUID;
  v_deduction_cat_id UUID;
  v_entry_id UUID;
  v_stock NUMERIC;
  v_prod_company UUID;
  v_prod_avg DECIMAL(12, 4);
  v_prod_last DECIMAL(12, 4);
  v_composes_cmv BOOLEAN;
  v_unit_cost_base DECIMAL(14, 6);
  v_cmv_amount DECIMAL(14, 2);
  v_cmv_cat_id UUID;
  v_desc TEXT;
  v_tax_payable_desc TEXT;
  v_cmv_payable_desc TEXT;
  v_rec RECORD;
  v_ri RECORD;
  v_scale_r NUMERIC;
  v_need_r NUMERIC;
  v_consume JSON;
  v_integration_import_batch_id UUID := CASE
    WHEN p_payload->>'integration_import_batch_id' IS NULL OR btrim(p_payload->>'integration_import_batch_id') = '' THEN NULL
    ELSE (p_payload->>'integration_import_batch_id')::uuid
  END;
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

  IF v_integration_import_batch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_revenue_integration_import_batches b
      WHERE b.id = v_integration_import_batch_id AND b.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'Lote de importacao automatico nao encontrado ou nao pertence a empresa';
    END IF;
  END IF;

  IF v_entry_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data da receita';
  END IF;

  IF v_title IS NULL OR v_title = '' THEN
    RAISE EXCEPTION 'Informe o titulo da receita';
  END IF;

  IF v_entry_mode NOT IN ('manual', 'product_sale', 'recipe_sale') THEN
    RAISE EXCEPTION 'Modo de lancamento invalido';
  END IF;

  IF v_entry_mode = 'manual' AND (
    p_payload->>'subcategory_id' IS NULL OR btrim(p_payload->>'subcategory_id') = ''
  ) THEN
    RAISE EXCEPTION 'Selecione a categoria';
  END IF;

  IF v_entry_mode IN ('product_sale', 'recipe_sale') AND (
    p_payload->>'subcategory_id' IS NULL OR btrim(p_payload->>'subcategory_id') = ''
  ) THEN
    RAISE EXCEPTION 'Selecione a categoria da venda';
  END IF;

  IF v_revenue_type NOT IN ('operational', 'non_operational') THEN
    RAISE EXCEPTION 'Tipo de receita invalido';
  END IF;

  IF v_entry_mode IN ('product_sale', 'recipe_sale') AND v_revenue_type <> 'operational' THEN
    RAISE EXCEPTION 'Venda pontual deve ser classificada como receita operacional';
  END IF;

  IF v_gross IS NULL OR v_gross <= 0 THEN
    RAISE EXCEPTION 'Valor bruto deve ser maior que zero';
  END IF;

  v_cmv_amount := 0;
  v_cmv_cat_id := NULL;

  IF v_entry_mode = 'product_sale' THEN
    v_recipe_id := NULL;
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
      p.average_cost,
      p.last_unit_value,
      coalesce(p.composes_cmv, true)
    INTO
      v_prod_company,
      v_stock,
      v_prod_avg,
      v_prod_last,
      v_composes_cmv
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

    IF NOT v_composes_cmv THEN
      v_cmv_cat_id := NULL;
      v_cmv_amount := 0;
    ELSE
      SELECT cc.id INTO v_cmv_cat_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'DESPESA'
        AND cc.tipo = 'CMV'
        AND coalesce(cc.ativo, true)
        AND cc.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE WHEN cc.name ILIKE '%outras%' THEN 0 ELSE 1 END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;

      IF v_cmv_cat_id IS NULL THEN
        RAISE EXCEPTION 'Cadastre uma subcategoria de despesa CMV em Configuracoes (folha sob o grupo CMV).';
      END IF;

      v_unit_cost_base := coalesce(v_prod_avg, v_prod_last, 0);
      v_cmv_amount := round(v_quantity * v_unit_cost_base, 2);
    END IF;

    IF v_pricing_mode = 'unit' THEN
      v_unit_value := (p_payload->>'unit_value')::decimal;
      IF v_unit_value IS NULL OR v_unit_value < 0 THEN
        RAISE EXCEPTION 'Valor unitario invalido';
      END IF;
    END IF;
  ELSIF v_entry_mode = 'recipe_sale' THEN
    v_product_id := NULL;
    v_quantity := 1;
    IF v_recipe_id IS NULL THEN
      RAISE EXCEPTION 'Selecione a receita';
    END IF;
    IF v_pricing_mode NOT IN ('unit', 'total') THEN
      RAISE EXCEPTION 'Modo de preco invalido';
    END IF;

    SELECT r.id, r.company_id, r.batch_yield, r.active
    INTO v_rec
    FROM public.recipes r
    WHERE r.id = v_recipe_id
    FOR UPDATE;

    IF v_rec.id IS NULL THEN
      RAISE EXCEPTION 'Receita nao encontrada';
    END IF;
    IF v_rec.company_id <> v_company_id THEN
      RAISE EXCEPTION 'Receita nao pertence a empresa';
    END IF;
    IF v_rec.active IS NOT TRUE THEN
      RAISE EXCEPTION 'Receita inativa';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.recipe_ingredients ri WHERE ri.recipe_id = v_recipe_id) THEN
      RAISE EXCEPTION 'Receita sem ingredientes';
    END IF;

    v_scale_r := v_quantity / v_rec.batch_yield;

    FOR v_ri IN
      SELECT ri.product_id, ri.quantity, ri.input_quantity, ri.input_unit_code
      FROM public.recipe_ingredients ri
      WHERE ri.recipe_id = v_recipe_id
    LOOP
      v_need_r := public.recipe_ingredient_qty_in_stock_unit(
        v_ri.product_id, v_ri.quantity, v_ri.input_quantity, v_ri.input_unit_code
      );
      IF v_need_r IS NULL THEN
        RAISE EXCEPTION 'Ingrediente com unidade sem conversao para o estoque do produto';
      END IF;
      v_need_r := v_need_r * v_scale_r;
      SELECT p.current_quantity INTO v_stock
      FROM public.products p
      WHERE p.id = v_ri.product_id
      FOR UPDATE;
      IF v_stock IS NULL THEN
        RAISE EXCEPTION 'Ingrediente nao encontrado';
      END IF;
      IF v_stock < v_need_r THEN
        RAISE EXCEPTION 'Estoque insuficiente para produzir a receita';
      END IF;
    END LOOP;

    v_cmv_amount := 0;
    FOR v_ri IN
      SELECT
        ri.product_id,
        ri.quantity,
        ri.input_quantity,
        ri.input_unit_code,
        coalesce(p.composes_cmv, true) AS composes,
        p.average_cost,
        p.last_unit_value
      FROM public.recipe_ingredients ri
      JOIN public.products p ON p.id = ri.product_id
      WHERE ri.recipe_id = v_recipe_id
    LOOP
      v_need_r := public.recipe_ingredient_qty_in_stock_unit(
        v_ri.product_id, v_ri.quantity, v_ri.input_quantity, v_ri.input_unit_code
      );
      IF v_need_r IS NULL THEN
        RAISE EXCEPTION 'Ingrediente com unidade sem conversao para o estoque do produto';
      END IF;
      v_need_r := v_need_r * v_scale_r;
      IF v_ri.composes THEN
        v_unit_cost_base := coalesce(v_ri.average_cost, v_ri.last_unit_value, 0);
        v_cmv_amount := v_cmv_amount + round(v_need_r * v_unit_cost_base, 2);
      END IF;
    END LOOP;

    v_cmv_cat_id := NULL;
    IF v_cmv_amount > 0 THEN
      SELECT cc.id INTO v_cmv_cat_id
      FROM public.company_categories cc
      WHERE cc.company_id = v_company_id
        AND cc.natureza = 'DESPESA'
        AND cc.tipo = 'CMV'
        AND coalesce(cc.ativo, true)
        AND cc.parent_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id)
      ORDER BY
        CASE WHEN cc.name ILIKE '%outras%' THEN 0 ELSE 1 END,
        coalesce(cc.ordem, cc.sort_order, 0),
        cc.name
      LIMIT 1;

      IF v_cmv_cat_id IS NULL THEN
        RAISE EXCEPTION 'Cadastre uma subcategoria de despesa CMV em Configuracoes (folha sob o grupo CMV).';
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
    v_recipe_id := NULL;
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

  SELECT t.tax_type, t.tax_value
  INTO v_tax_type, v_tax_input
  FROM public.company_revenue_category_tax_settings t
  WHERE t.company_id = v_company_id AND t.category_id = v_subcategory_id;

  IF NOT FOUND THEN
    v_tax_type := 'percentage';
    v_tax_input := 0;
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

  INSERT INTO public.revenue_entries (
    company_id, created_by, entry_date, title, entry_mode, revenue_type,
    category_id, subcategory_id, product_id, recipe_id, quantity, pricing_mode, unit_value,
    gross_amount, tax_type, tax_value, tax_amount, net_amount, source,
    integration_import_batch_id
  ) VALUES (
    v_company_id, v_uid, v_entry_date, v_title, v_entry_mode, v_revenue_type,
    v_category_id, v_subcategory_id, v_product_id, v_recipe_id, v_quantity, v_pricing_mode, v_unit_value,
    v_gross, v_tax_type, v_tax_input, v_tax_amount, v_net,
    v_entry_mode,
    v_integration_import_batch_id
  )
  RETURNING id INTO v_entry_id;

  v_desc := 'Receita: ' || left(v_title, 200);
  v_tax_payable_desc :=
    'Despesa: Taxas/DeduÃ§Ãµes - ' ||
    CASE
      WHEN v_entry_mode = 'product_sale' THEN 'Venda produtos'
      WHEN v_entry_mode = 'recipe_sale' THEN 'Venda por receita'
      ELSE left(v_title, 200)
    END;
  v_cmv_payable_desc := 'Despesa: CMV - Venda produtos';

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
        v_company_id, NULL, v_tax_payable_desc, v_entry_date, v_tax_amount, 'pending',
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

  IF v_entry_mode IN ('product_sale', 'recipe_sale')
     AND v_revenue_type = 'operational'
     AND v_cmv_amount > 0 THEN
    IF v_cmv_cat_id IS NULL THEN
      RAISE EXCEPTION 'Cadastre uma subcategoria de despesa CMV em Configuracoes (folha sob o grupo CMV).';
    END IF;

    INSERT INTO public.boletos (
      company_id, expense_id, description, due_date, amount, status,
      flow_type, company_category_id, revenue_entry_id,
      payment_type, barcode, provider, pix_key_type, pix_key,
      bank_name, bank_code, agency, account, account_type
    ) VALUES (
      v_company_id, NULL, v_cmv_payable_desc, v_entry_date, v_cmv_amount, 'pending',
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

  IF v_entry_mode = 'recipe_sale' AND v_recipe_id IS NOT NULL THEN
    v_consume := public.consume_recipe_stock(v_recipe_id, v_quantity, 'revenue_entry', v_entry_id);
    IF coalesce((v_consume->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Falha ao baixar estoque da receita';
    END IF;
  END IF;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.create_revenue_entry(jsonb) IS
  'Insere receita, boletos (DRE) e baixa de estoque em venda. Payload opcional: integration_import_batch_id (uuid de company_revenue_integration_import_batches da mesma empresa).';


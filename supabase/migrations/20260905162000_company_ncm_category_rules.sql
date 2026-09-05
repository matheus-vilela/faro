-- Regras NCM → categoria financeira de despesa, por empresa.
-- A lista da tela agrega NCMs já vistos (produtos + linhas de NF) com left join nesta tabela.

CREATE OR REPLACE FUNCTION public.normalize_ncm_8(p_ncm TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN d IS NULL OR length(d) < 1 OR d ~ '^0+$' THEN NULL
    WHEN length(d) < 8 THEN lpad(d, 8, '0')
    ELSE left(d, 8)
  END
  FROM (
    SELECT NULLIF(regexp_replace(coalesce(p_ncm, ''), '[^0-9]', '', 'g'), '') AS d
  ) s;
$$;

COMMENT ON FUNCTION public.normalize_ncm_8(TEXT) IS
  'NCM com 8 dígitos; vazio ou só zeros → NULL.';

CREATE TABLE IF NOT EXISTS public.company_ncm_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ncm TEXT NOT NULL,
  company_category_id UUID NOT NULL REFERENCES public.company_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_ncm_category_rules_ncm_8 CHECK (ncm ~ '^[0-9]{8}$'),
  CONSTRAINT company_ncm_category_rules_company_ncm_unique UNIQUE (company_id, ncm)
);

CREATE INDEX IF NOT EXISTS idx_company_ncm_category_rules_company
  ON public.company_ncm_category_rules (company_id);

CREATE INDEX IF NOT EXISTS idx_company_ncm_category_rules_category
  ON public.company_ncm_category_rules (company_category_id);

CREATE INDEX IF NOT EXISTS idx_expense_items_company_ncm
  ON public.expense_items (company_id, ncm)
  WHERE ncm IS NOT NULL;

COMMENT ON TABLE public.company_ncm_category_rules IS
  'Vínculo NCM (8 dígitos) → folha de despesa do plano. Usado para classificar linhas de NF sem categoria no produto.';

CREATE OR REPLACE FUNCTION public.company_ncm_category_rules_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cat RECORD;
  v_has_child BOOLEAN;
BEGIN
  NEW.ncm := public.normalize_ncm_8(NEW.ncm);
  IF NEW.ncm IS NULL THEN
    RAISE EXCEPTION 'NCM inválido';
  END IF;

  SELECT id, company_id, natureza, ativo
  INTO v_cat
  FROM public.company_categories
  WHERE id = NEW.company_category_id;

  IF v_cat.id IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF v_cat.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Categoria deve ser da mesma empresa';
  END IF;
  IF v_cat.natureza IS DISTINCT FROM 'DESPESA' THEN
    RAISE EXCEPTION 'NCM só pode vincular categoria de despesa';
  END IF;
  IF v_cat.ativo IS FALSE THEN
    RAISE EXCEPTION 'Categoria inativa';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.company_categories c
    WHERE c.parent_id = NEW.company_category_id
  ) INTO v_has_child;
  IF v_has_child THEN
    RAISE EXCEPTION 'Selecione uma categoria folha (sem subcategorias)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_company_ncm_category_rules_validate
  ON public.company_ncm_category_rules;
CREATE TRIGGER tr_company_ncm_category_rules_validate
  BEFORE INSERT OR UPDATE OF ncm, company_id, company_category_id
  ON public.company_ncm_category_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.company_ncm_category_rules_validate();

DROP TRIGGER IF EXISTS tr_company_ncm_category_rules_updated_at
  ON public.company_ncm_category_rules;
CREATE TRIGGER tr_company_ncm_category_rules_updated_at
  BEFORE UPDATE ON public.company_ncm_category_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_ncm_category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read ncm category rules"
  ON public.company_ncm_category_rules;
CREATE POLICY "Members can read ncm category rules"
  ON public.company_ncm_category_rules FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners can write ncm category rules"
  ON public.company_ncm_category_rules;
CREATE POLICY "Owners can write ncm category rules"
  ON public.company_ncm_category_rules FOR INSERT
  WITH CHECK (public.user_is_company_owner(auth.uid(), company_id));

CREATE POLICY "Owners can update ncm category rules"
  ON public.company_ncm_category_rules FOR UPDATE
  USING (public.user_is_company_owner(auth.uid(), company_id))
  WITH CHECK (public.user_is_company_owner(auth.uid(), company_id));

CREATE POLICY "Owners can delete ncm category rules"
  ON public.company_ncm_category_rules FOR DELETE
  USING (public.user_is_company_owner(auth.uid(), company_id));

GRANT SELECT ON public.company_ncm_category_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.company_ncm_category_rules TO authenticated;
GRANT ALL ON public.company_ncm_category_rules TO service_role;

CREATE OR REPLACE FUNCTION public.list_company_ncms(p_company_id UUID)
RETURNS TABLE (
  ncm TEXT,
  product_count BIGINT,
  expense_item_count BIGINT,
  sample_product_names TEXT[],
  category_id UUID
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
    r.company_category_id
  FROM agg a
  LEFT JOIN public.company_ncm_category_rules r
    ON r.company_id = p_company_id AND r.ncm = a.ncm
  ORDER BY (r.company_category_id IS NULL) DESC, a.ncm;
END;
$$;

COMMENT ON FUNCTION public.list_company_ncms(UUID) IS
  'NCMs da empresa (produtos, linhas de NF e regras manuais) com categoria vinculada, se houver.';

CREATE OR REPLACE FUNCTION public.list_company_ncm_products(
  p_company_id UUID,
  p_ncm TEXT
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  unit TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ncm TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  v_ncm := public.normalize_ncm_8(p_ncm);
  IF v_ncm IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.unit
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND public.normalize_ncm_8(p.ncm) = v_ncm
  ORDER BY p.name
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_ncm_8(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_ncms(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_ncm_products(UUID, TEXT) TO authenticated, service_role;

-- Produto criado via NF-e pode herdar a categoria da regra do NCM.
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
    default_expense_category_id
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
    v_default_cat
  )
  RETURNING id INTO v_product_id;

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

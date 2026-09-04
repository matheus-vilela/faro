-- Marca manual: este produto não é agrupamento de venda.
-- Some a tag "Possível agrupamento" e o sync não a recoloca.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS not_sale_grouping BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.not_sale_grouping IS
  'Usuário informou que o item não é agrupamento de venda. Esconde a tag de possível agrupamento.';

CREATE OR REPLACE FUNCTION public.promote_product_to_sale_family(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET
    stock_control_type = 'SALE_FAMILY',
    listed_in_product_catalog = false,
    composes_cmv = false,
    not_sale_grouping = false,
    updated_at = now()
  WHERE id = p_product_id
    AND stock_control_type IS DISTINCT FROM 'RECIPE_CONTROLLED';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_not_sale_grouping(
  p_product_id UUID,
  p_not_grouping BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company_id UUID;
  v_sct TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  SELECT p.company_id, p.stock_control_type
  INTO v_company_id, v_sct
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Produto nao encontrado';
  END IF;
  IF NOT public.user_has_company_access(v_uid, v_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF v_sct = 'SALE_FAMILY' THEN
    RAISE EXCEPTION 'Deixe de ser agrupamento antes de marcar como item comum.';
  END IF;

  UPDATE public.products
  SET
    not_sale_grouping = coalesce(p_not_grouping, true),
    updated_at = now()
  WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.demote_product_from_sale_family(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company_id UUID;
  v_sct TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  SELECT p.company_id, p.stock_control_type
  INTO v_company_id, v_sct
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Produto nao encontrado';
  END IF;
  IF NOT public.user_has_company_access(v_uid, v_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF v_sct IS DISTINCT FROM 'SALE_FAMILY' THEN
    RAISE EXCEPTION 'Este produto nao e um agrupamento.';
  END IF;

  DELETE FROM public.product_sale_family_members
  WHERE company_id = v_company_id
    AND family_product_id = p_product_id;

  UPDATE public.products
  SET
    stock_control_type = 'DIRECT',
    listed_in_product_catalog = true,
    not_sale_grouping = true,
    updated_at = now()
  WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_not_sale_grouping(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demote_product_from_sale_family(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_product_not_sale_grouping(UUID, BOOLEAN)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.demote_product_from_sale_family(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_product_to_sale_family(UUID)
  TO authenticated, service_role;

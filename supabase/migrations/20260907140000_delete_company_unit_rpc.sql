-- Excluir unidade: DELETE direto em companies falha com RLS no CASCADE
-- (user_companies some e as filhas recusam o delete) e com FKs RESTRICT
-- (família de venda, receita × categoria, extrato × conta).

CREATE OR REPLACE FUNCTION public.delete_company_unit(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida';
  END IF;
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Unidade inválida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Unidade não encontrada';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.companies c
      JOIN public.company_groups g ON g.id = c.group_id
      WHERE c.id = p_company_id
        AND g.owner_user_id = v_uid
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE uc.company_id = p_company_id
        AND uc.user_id = v_uid
        AND uc.role = 'owner'
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para excluir esta unidade';
  END IF;

  PERFORM set_config('app.company_delete_cascade', 'true', true);

  IF to_regclass('public.product_sale_family_members') IS NOT NULL THEN
    DELETE FROM public.product_sale_family_members
    WHERE company_id = p_company_id;
  END IF;

  IF to_regclass('public.bank_statement_lines') IS NOT NULL THEN
    DELETE FROM public.bank_statement_lines
    WHERE company_id = p_company_id;
  END IF;

  IF to_regclass('public.bank_statement_imports') IS NOT NULL THEN
    DELETE FROM public.bank_statement_imports
    WHERE company_id = p_company_id;
  END IF;

  IF to_regclass('public.revenue_entries') IS NOT NULL THEN
    DELETE FROM public.revenue_entries
    WHERE company_id = p_company_id;
  END IF;

  DELETE FROM public.companies WHERE id = p_company_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.delete_company_unit(uuid) IS
  'Exclui a unidade e dados vinculados. Dono do grupo, dono da unidade ou admin Faro.';

REVOKE ALL ON FUNCTION public.delete_company_unit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_company_unit(uuid) TO authenticated;

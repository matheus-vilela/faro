-- Apaga em massa receitas criadas pela importacao automatica (ligadas a
-- company_revenue_integration_import_batches), reutilizando delete_revenue_entry
-- por linha (estorno de estoque em venda de produto, boletos em cascade).

CREATE OR REPLACE FUNCTION public.count_revenue_entries_from_integration_import(
  p_company_id UUID,
  p_provider TEXT DEFAULT 'epoc'
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'Informe o provedor da integracao';
  END IF;

  RETURN (
    SELECT count(*)::bigint
    FROM public.revenue_entries re
    INNER JOIN public.company_revenue_integration_import_batches b
      ON b.id = re.integration_import_batch_id
    WHERE re.company_id = p_company_id
      AND b.provider = p_provider
  );
END;
$$;

COMMENT ON FUNCTION public.count_revenue_entries_from_integration_import(UUID, TEXT) IS
  'Conta receitas da empresa ligadas a lotes de importacao automatica (provider).';

GRANT EXECUTE ON FUNCTION public.count_revenue_entries_from_integration_import(UUID, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_revenue_entries_from_integration_import(
  p_company_id UUID,
  p_provider TEXT DEFAULT 'epoc'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'Informe o provedor da integracao';
  END IF;

  FOR r IN
    SELECT re.id
    FROM public.revenue_entries re
    INNER JOIN public.company_revenue_integration_import_batches b
      ON b.id = re.integration_import_batch_id
    WHERE re.company_id = p_company_id
      AND b.provider = p_provider
    ORDER BY re.id
  LOOP
    PERFORM public.delete_revenue_entry(r.id);
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.company_revenue_integration_import_batches b
  WHERE b.company_id = p_company_id
    AND b.provider = p_provider;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.delete_revenue_entries_from_integration_import(UUID, TEXT) IS
  'Remove todas as receitas da empresa associadas a lotes do provider (ex.: epoc) e apaga os lotes.';

GRANT EXECUTE ON FUNCTION public.delete_revenue_entries_from_integration_import(UUID, TEXT) TO authenticated;

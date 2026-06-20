-- =============================================================================
-- PURGA: todas as despesas de uma unidade (company_id)
-- =============================================================================
-- DESTRUTIVO. Não há undo. Use só em dev/staging ou com backup.
--
-- Apaga linhas em public.expenses; o PostgreSQL propaga CASCADE para, entre
-- outras: expense_items, recebimentos, expense_resolution_logs,
-- expense_xml_item_motor_pass, import_review_pending (expense_id), etc.
-- Boletos e company_nfe_import_logs ficam com expense_id = NULL (SET NULL).
--
-- Como executar (Supabase Dashboard → SQL Editor):
--   1. Substitua o UUID em v_company abaixo.
--   2. Execute o bloco inteiro.
--
-- Como executar (psql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/purge-company-expenses.sql
--   (edite o UUID no ficheiro antes)
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_company uuid := '9399b80c-2cd5-4651-b58c-6ee6a044b71a'::uuid; -- <-- ALTERE AQUI
  n int;
BEGIN
  IF v_company = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Defina v_company com o UUID real da unidade antes de executar.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company) THEN
    RAISE EXCEPTION 'company_id % não existe em public.companies', v_company;
  END IF;

  DELETE FROM public.expenses e WHERE e.company_id = v_company;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Despesas removidas: %', n;
END $$;

COMMIT;

-- =============================================================================
-- PURGA: todos os produtos de uma unidade (company_id)
-- =============================================================================
-- DESTRUTIVO. Não há undo. Use só em dev/staging ou com backup.
--
-- Apaga linhas em public.products. CASCADE remove/atualiza dependentes, por ex.:
--   recipe_ingredients, product_unit_conversions, product_operational_config,
--   product_invoice_line_aliases, product_category_assignments, etc.
-- Receitas (recipes) mantêm-se com output_product_id = NULL se apontavam ao produto.
-- revenue_entries: FK é ON DELETE SET NULL, mas product_sale exige product_id NOT NULL
-- (revenue_entries_sale_fields_check). Por isso apagamos primeiro os lançamentos ligados aos
-- produtos da unidade. onboarding_import_item_raw.created_product_id continua SET NULL.
--
-- Recomendação: apague primeiro as despesas (purge-company-expenses.sql) se quiser
-- um reset completo da unidade; caso contrário expense_items ficam sem product_id.
--
-- Como executar (Supabase Dashboard → SQL Editor):
--   1. Substitua o UUID em v_company abaixo.
--   2. Execute o bloco inteiro.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_company uuid := '9399b80c-2cd5-4651-b58c-6ee6a044b71a'::uuid;  -- <-- ALTERE AQUI
  n int;
  n_revenue int;
BEGIN
  IF v_company = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Defina v_company com o UUID real da unidade antes de executar.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company) THEN
    RAISE EXCEPTION 'company_id % não existe em public.companies', v_company;
  END IF;

  DELETE FROM public.revenue_entries re
  WHERE re.company_id = v_company
    AND re.product_id IN (
      SELECT p.id FROM public.products p WHERE p.company_id = v_company
    );
  GET DIAGNOSTICS n_revenue = ROW_COUNT;
  RAISE NOTICE 'Lançamentos de receita (venda de produto) removidos: %', n_revenue;

  DELETE FROM public.products p WHERE p.company_id = v_company;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Produtos removidos: %', n;
END $$;

COMMIT;

-- RPCs de produto intermediário nasceram depois do patch
-- 20260802230000 e ainda recusavam admin Faro (só user_companies).

DO $$
DECLARE
  r record;
  def text;
  new_def text;
  updated int := 0;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'get_product_technical_sheet',
        'upsert_product_technical_sheet',
        'produce_intermediate_product'
      )
      AND pg_get_functiondef(p.oid) ~* 'user_companies'
      AND pg_get_functiondef(p.oid) !~* 'user_has_company_access\s*\('
  LOOP
    def := pg_get_functiondef(r.oid);
    new_def := regexp_replace(
      def,
      'IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+uc\s+WHERE\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s+AND\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)',
      'IF NOT public.user_has_company_access(\1, \2)',
      'gi'
    );

    IF new_def IS DISTINCT FROM def THEN
      EXECUTE new_def;
      updated := updated + 1;
      RAISE NOTICE 'admin access patched: public.%(%)', r.proname, r.args;
    END IF;
  END LOOP;

  RAISE NOTICE 'intermediate_rpc_company_access: % funções atualizadas', updated;
END $$;

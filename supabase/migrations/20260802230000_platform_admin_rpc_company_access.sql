-- Admin Faro (profiles.is_admin) passa a ter acesso em RPCs que ainda
-- checavam só membership em user_companies (ex.: merge_company_products).

CREATE OR REPLACE FUNCTION public.user_has_company_access(
  p_user_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND p_company_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_user_id
          AND p.is_admin = true
      )
      OR (
        p_user_id = auth.uid()
        AND public.is_platform_admin()
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_companies uc
        WHERE uc.user_id = p_user_id
          AND uc.company_id = p_company_id
      )
    );
$$;

COMMENT ON FUNCTION public.user_has_company_access(uuid, uuid) IS
  'True se o utilizador é membro da unidade ou admin global Faro (profiles.is_admin).';

REVOKE ALL ON FUNCTION public.user_has_company_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(uuid, uuid) TO service_role;

-- Atalho para o utilizador autenticado.
CREATE OR REPLACE FUNCTION public.user_has_company_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_company_access(auth.uid(), p_company_id);
$$;

COMMENT ON FUNCTION public.user_has_company_access(uuid) IS
  'Atalho: user_has_company_access(auth.uid(), p_company_id).';

REVOKE ALL ON FUNCTION public.user_has_company_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(uuid) TO service_role;

-- Reescreve checagens legadas IF NOT EXISTS (user_companies …) → user_has_company_access.
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
      AND p.proname NOT IN (
        'user_has_company_access',
        'is_platform_admin',
        'user_accessible_company_ids',
        'user_visible_company_group_ids'
      )
      AND pg_get_functiondef(p.oid) ~* 'user_companies'
      AND pg_get_functiondef(p.oid) !~* 'user_has_company_access\s*\('
  LOOP
    def := pg_get_functiondef(r.oid);
    new_def := def;

    -- IF NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = X AND uc.company_id = Y)
    new_def := regexp_replace(
      new_def,
      'IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+uc\s+WHERE\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s+AND\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)',
      'IF NOT public.user_has_company_access(\1, \2)',
      'gi'
    );

    -- ordem invertida: company_id primeiro
    new_def := regexp_replace(
      new_def,
      'IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+uc\s+WHERE\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+AND\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s*\)',
      'IF NOT public.user_has_company_access(\2, \1)',
      'gi'
    );

    -- sem alias na tabela
    new_def := regexp_replace(
      new_def,
      'IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+WHERE\s+user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s+AND\s+company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)',
      'IF NOT public.user_has_company_access(\1, \2)',
      'gi'
    );

    -- Forma: IF NOT ( EXISTS (user_companies…) ) sem is_platform_admin no mesmo IF
    -- (já coberto pelos padrões acima na maioria dos casos)

    -- Forma OR EXISTS pura em blocos que ainda não usam admin:
    -- IF NOT ( EXISTS (…user_companies…) ) → user_has_company_access
    new_def := regexp_replace(
      new_def,
      'IF\s+NOT\s*\(\s*EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+uc\s+WHERE\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s+AND\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\)',
      'IF NOT public.user_has_company_access(\1, \2)',
      'gi'
    );

    -- Forma já parcialmente admin: IF NOT ( is_platform_admin() OR EXISTS(user_companies) )
    new_def := regexp_replace(
      new_def,
      'IF\s+NOT\s*\(\s*public\.is_platform_admin\s*\(\s*\)\s*OR\s*EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+uc\s+WHERE\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\)|p_user_id)\s+AND\s+uc\.company_id\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\)',
      'IF NOT public.user_has_company_access(\1, \2)',
      'gi'
    );

    IF new_def IS DISTINCT FROM def THEN
      BEGIN
        EXECUTE new_def;
        updated := updated + 1;
        RAISE NOTICE 'admin access patched: %.%(%)', 'public', r.proname, r.args;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'falha ao patchar %.%(%): %', 'public', r.proname, r.args, SQLERRM;
      END;
    END IF;
  END LOOP;

  RAISE NOTICE 'platform_admin_rpc_company_access: % funções atualizadas', updated;
END $$;

-- Garante merge/undo mesmo se o rewrite automático não pegar o body atual.
DO $$
DECLARE
  r record;
  def text;
  new_def text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('merge_company_products', 'undo_product_merge')
      AND p.prokind = 'f'
  LOOP
    def := pg_get_functiondef(r.oid);
    IF def ~* 'user_has_company_access\s*\(' THEN
      RAISE NOTICE '%: já usa user_has_company_access', r.proname;
      CONTINUE;
    END IF;

    new_def := regexp_replace(
      def,
      'IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_companies\s+uc\s+WHERE\s+uc\.user_id\s*=\s*(v_uid|auth\.uid\(\))\s+AND\s+uc\.company_id\s*=\s*p_company_id\s*\)',
      'IF NOT public.user_has_company_access(\1, p_company_id)',
      'gi'
    );

    IF new_def IS DISTINCT FROM def THEN
      EXECUTE new_def;
      RAISE NOTICE '%: acesso admin aplicado', r.proname;
    ELSE
      RAISE WARNING '%: padrão de membership não encontrado — revise manualmente', r.proname;
    END IF;
  END LOOP;
END $$;

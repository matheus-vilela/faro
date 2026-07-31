-- Acesso de administrador global (profiles.is_admin) a todos os grupos/unidades
-- e dados tenant, sem precisar ser membro em user_companies.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT p.is_admin
      FROM public.profiles p
      WHERE p.id = auth.uid()
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True se profiles.is_admin do usuário autenticado. SECURITY DEFINER para uso em RLS.';

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.user_accessible_company_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.companies c
  WHERE public.is_platform_admin()
  UNION
  SELECT uc.company_id
  FROM public.user_companies uc
  WHERE uc.user_id = auth.uid();
$$;

COMMENT ON FUNCTION public.user_accessible_company_ids() IS
  'company_ids visíveis: todas se is_platform_admin(); senão membership em user_companies.';

REVOKE ALL ON FUNCTION public.user_accessible_company_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_accessible_company_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.user_visible_company_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.group_id
  FROM public.companies c
  WHERE public.is_platform_admin()
    AND c.group_id IS NOT NULL
  UNION
  SELECT c.group_id
  FROM public.companies c
  INNER JOIN public.user_companies uc ON uc.company_id = c.id
  WHERE uc.user_id = auth.uid()
    AND c.group_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.user_visible_company_group_ids() IS
  'group_ids visíveis via membership ou admin global; usada em RLS de company_groups.';

-- companies: admin vê/atualiza qualquer unidade
DROP POLICY IF EXISTS "platform_admins_companies" ON public.companies;
CREATE POLICY "platform_admins_companies"
  ON public.companies
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- company_groups: admin vê qualquer grupo
DROP POLICY IF EXISTS "platform_admins_company_groups" ON public.company_groups;
CREATE POLICY "platform_admins_company_groups"
  ON public.company_groups
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Tabelas tenant com company_id: política adicional para admin
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname NOT IN ('companies') -- já tem política dedicada
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS platform_admins_all ON public.%I',
      r.table_name
    );
    EXECUTE format(
      'CREATE POLICY platform_admins_all ON public.%I
         FOR ALL TO authenticated
         USING (public.is_platform_admin())
         WITH CHECK (public.is_platform_admin())',
      r.table_name
    );
  END LOOP;
END $$;

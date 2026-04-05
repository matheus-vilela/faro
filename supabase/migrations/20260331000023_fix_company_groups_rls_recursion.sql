-- Evita recursão infinita entre políticas de companies e company_groups:
-- INSERT em companies verifica company_groups; a política de SELECT em company_groups
-- lia companies, reativando RLS em companies.
-- A função abaixo roda como SECURITY DEFINER (sem RLS em companies) e só devolve
-- group_ids aos quais o usuário tem acesso via user_companies.

CREATE OR REPLACE FUNCTION public.user_visible_company_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.group_id
  FROM public.companies c
  INNER JOIN public.user_companies uc ON uc.company_id = c.id
  WHERE uc.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.user_visible_company_group_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_visible_company_group_ids() TO authenticated;

DROP POLICY IF EXISTS "Users can view groups for their companies" ON public.company_groups;

CREATE POLICY "Users can view groups for their companies"
  ON public.company_groups FOR SELECT
  USING (
    owner_user_id = auth.uid()
    OR id IN (SELECT public.user_visible_company_group_ids())
  );

COMMENT ON FUNCTION public.user_visible_company_group_ids() IS
  'Lista group_id dos grupos aos quais o usuário tem acesso via user_companies; usada em RLS de company_groups sem recursão em companies.';

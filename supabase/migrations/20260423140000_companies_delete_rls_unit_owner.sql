-- Permite excluir a unidade quem é dono do grupo OU dono da unidade em user_companies
-- (a política anterior só cobria dono do grupo; alguns vínculos legados falhavam em silêncio no cliente).
DROP POLICY IF EXISTS "Group owners can delete companies in their groups" ON public.companies;

CREATE POLICY "Group owners can delete companies in their groups"
  ON public.companies FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.company_groups g
      WHERE
        g.id = companies.group_id
        AND g.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_companies uc
      WHERE
        uc.company_id = companies.id
        AND uc.user_id = auth.uid()
        AND uc.role = 'owner'
    )
  );

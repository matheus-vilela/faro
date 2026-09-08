-- Vínculo NCM → categoria: mesmo critério das categorias/contas bancárias
-- (membro da unidade ou admin Faro). A UI continua exigindo a permissão Configurações.

DROP POLICY IF EXISTS "Owners can write ncm category rules"
  ON public.company_ncm_category_rules;
DROP POLICY IF EXISTS "Owners can update ncm category rules"
  ON public.company_ncm_category_rules;
DROP POLICY IF EXISTS "Owners can delete ncm category rules"
  ON public.company_ncm_category_rules;
DROP POLICY IF EXISTS "Members can write ncm category rules"
  ON public.company_ncm_category_rules;
DROP POLICY IF EXISTS "Members can update ncm category rules"
  ON public.company_ncm_category_rules;
DROP POLICY IF EXISTS "Members can delete ncm category rules"
  ON public.company_ncm_category_rules;

CREATE POLICY "Members can write ncm category rules"
  ON public.company_ncm_category_rules FOR INSERT
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY "Members can update ncm category rules"
  ON public.company_ncm_category_rules FOR UPDATE
  USING (public.user_has_company_access(company_id))
  WITH CHECK (public.user_has_company_access(company_id));

CREATE POLICY "Members can delete ncm category rules"
  ON public.company_ncm_category_rules FOR DELETE
  USING (public.user_has_company_access(company_id));

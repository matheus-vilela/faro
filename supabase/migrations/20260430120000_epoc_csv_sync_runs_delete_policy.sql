-- Permitir que membros da unidade apaguem linhas do histórico de tentativas EPOC (UI).

GRANT DELETE ON public.epoc_csv_sync_runs TO authenticated;

DROP POLICY IF EXISTS "Users can delete epoc csv sync runs in their company"
  ON public.epoc_csv_sync_runs;
CREATE POLICY "Users can delete epoc csv sync runs in their company"
  ON public.epoc_csv_sync_runs
  FOR DELETE
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

-- Evidências de checklist (foto/assinatura) e anexos de contagem.
-- Path: {company_id}/checklist-runs/{run_id}/... ou {company_id}/inventory-counts/{session_id}/...

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'checklist-evidence',
  'checklist-evidence',
  false,
  15728640,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "checklist_evidence_select_company" ON storage.objects;
CREATE POLICY "checklist_evidence_select_company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'checklist-evidence'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "checklist_evidence_insert_company" ON storage.objects;
CREATE POLICY "checklist_evidence_insert_company"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'checklist-evidence'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "checklist_evidence_update_company" ON storage.objects;
CREATE POLICY "checklist_evidence_update_company"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'checklist-evidence'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "checklist_evidence_delete_company" ON storage.objects;
CREATE POLICY "checklist_evidence_delete_company"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'checklist-evidence'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

-- Upload anônimo via path conhecido só com token da execução (path incluiável).
-- RPCs públicos validam; policy permite insert em paths checklist-runs / inventory-counts.
DROP POLICY IF EXISTS "checklist_evidence_anon_insert_run_path" ON storage.objects;
CREATE POLICY "checklist_evidence_anon_insert_run_path"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'checklist-evidence'
    AND (
      (storage.foldername(name))[2] = 'checklist-runs'
      OR (storage.foldername(name))[2] = 'inventory-counts'
    )
  );

DROP POLICY IF EXISTS "checklist_evidence_anon_select_run_path" ON storage.objects;
CREATE POLICY "checklist_evidence_anon_select_run_path"
  ON storage.objects FOR SELECT TO anon
  USING (
    bucket_id = 'checklist-evidence'
    AND (
      (storage.foldername(name))[2] = 'checklist-runs'
      OR (storage.foldername(name))[2] = 'inventory-counts'
    )
  );

-- Maps de onboarding por unidade (empresa): dados fiscais, endereço, Focus NFe e controle do assistente.
-- Mantém colunas legadas name/document/email/phone espelhadas pelo app a partir do passo 1.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS empresa JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS endereco_principal JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS focusnfe JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS setup JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.companies.empresa IS 'Dados cadastrais da unidade (razão social, CNPJ, regime tributário, etc.).';
COMMENT ON COLUMN public.companies.endereco_principal IS 'Endereço principal (CEP, logradouro, IBGE, etc.).';
COMMENT ON COLUMN public.companies.focusnfe IS 'Parâmetros fiscais / NFC-e / NF-e e certificado (metadados).';
COMMENT ON COLUMN public.companies.setup IS 'Estado do assistente de configuração (status, passo atual, progresso, logs de importação).';

-- Bucket privado: certificados A1, ZIP de XML, planilhas EPOC — path prefixo = company_id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-setup',
  'company-setup',
  false,
  52428800,
  ARRAY[
    'application/x-pkcs12',
    'application/pkcs12',
    'application/octet-stream',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "company_setup_select_company" ON storage.objects;
DROP POLICY IF EXISTS "company_setup_insert_company" ON storage.objects;
DROP POLICY IF EXISTS "company_setup_update_company" ON storage.objects;
DROP POLICY IF EXISTS "company_setup_delete_company" ON storage.objects;

CREATE POLICY "company_setup_select_company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-setup'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "company_setup_insert_company"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-setup'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "company_setup_update_company"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'company-setup'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "company_setup_delete_company"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'company-setup'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

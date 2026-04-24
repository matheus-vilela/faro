-- Remove chaves sensíveis previamente gravadas em companies.focusnfe (política: não persistir certificado/senha).
UPDATE public.companies
SET
  focusnfe = coalesce(focusnfe, '{}'::jsonb)
    - 'arquivo_certificado_base64'
    - 'senha_certificado'
WHERE
  focusnfe IS NOT NULL
  AND (
    focusnfe ? 'arquivo_certificado_base64'
    OR focusnfe ? 'senha_certificado'
  );

-- Competência / data do documento para filtros por mês (NF-e: emissão; sem valor = dia UTC de created_at).
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS reference_date date;

UPDATE public.expenses e
SET reference_date = (e.created_at AT TIME ZONE 'UTC')::date
WHERE e.reference_date IS NULL;

ALTER TABLE public.expenses
  ALTER COLUMN reference_date SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date);

ALTER TABLE public.expenses
  ALTER COLUMN reference_date SET NOT NULL;

COMMENT ON COLUMN public.expenses.reference_date IS
  'Data de competência do lançamento (ex.: emissão da NF-e). Listagens por mês usam este campo em vez de created_at.';

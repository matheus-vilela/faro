-- Execuções de checklist pelo proprietário no WhatsApp (sem company_member_id)

ALTER TABLE public.checklist_runs
  ADD COLUMN IF NOT EXISTS is_owner_run BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.checklist_runs
  ALTER COLUMN company_member_id DROP NOT NULL;

COMMENT ON COLUMN public.checklist_runs.is_owner_run IS
  'TRUE quando a execução foi aberta pelo número do proprietário no WhatsApp (sem vínculo a company_members).';

COMMENT ON COLUMN public.checklist_runs.company_member_id IS
  'Membro operador; NULL se is_owner_run (execução pelo proprietário no WhatsApp).';

ALTER TABLE public.checklist_runs DROP CONSTRAINT IF EXISTS checklist_runs_member_or_owner;

ALTER TABLE public.checklist_runs
  ADD CONSTRAINT checklist_runs_member_or_owner CHECK (
    (company_member_id IS NOT NULL AND NOT is_owner_run)
    OR (company_member_id IS NULL AND is_owner_run)
  );

CREATE INDEX IF NOT EXISTS idx_checklist_runs_owner
  ON public.checklist_runs (checklist_id, is_owner_run)
  WHERE is_owner_run = TRUE;

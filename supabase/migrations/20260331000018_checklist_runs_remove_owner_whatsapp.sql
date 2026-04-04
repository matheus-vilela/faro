-- Reverte execuções de checklist pelo proprietário no WhatsApp (sem company_member_id).

DELETE FROM public.checklist_runs
WHERE is_owner_run = TRUE
   OR company_member_id IS NULL;

DROP INDEX IF EXISTS public.idx_checklist_runs_owner;

ALTER TABLE public.checklist_runs
  DROP CONSTRAINT IF EXISTS checklist_runs_member_or_owner;

ALTER TABLE public.checklist_runs
  DROP COLUMN IF EXISTS is_owner_run;

ALTER TABLE public.checklist_runs
  ALTER COLUMN company_member_id SET NOT NULL;

COMMENT ON COLUMN public.checklist_runs.company_member_id IS
  'Membro operador da execução.';

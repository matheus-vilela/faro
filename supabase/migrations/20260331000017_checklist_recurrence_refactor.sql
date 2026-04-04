-- Recorrência: diária (máscara dom–sáb + execuções por dia) ou mensal (1–3× por mês civil)

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS recurrence_kind TEXT NOT NULL DEFAULT 'daily'
    CHECK (recurrence_kind IN ('daily', 'monthly'));

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS daily_executions_per_day INTEGER;

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS weekday_mask INTEGER NOT NULL DEFAULT 127
    CHECK (weekday_mask >= 1 AND weekday_mask <= 127);

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS monthly_executions INTEGER;

COMMENT ON COLUMN public.checklists.recurrence_kind IS
  'daily: weekday_mask + daily_executions_per_day; monthly: monthly_executions (1–3) por mês civil.';

COMMENT ON COLUMN public.checklists.weekday_mask IS
  'Bits 0–6 = domingo–sábado (como JS getDay). 127 = todos os dias.';

COMMENT ON COLUMN public.checklists.daily_executions_per_day IS
  'Somente daily: execuções esperadas em cada dia da semana selecionado.';

COMMENT ON COLUMN public.checklists.monthly_executions IS
  'Somente monthly: 1 a 3 execuções por mês civil (America/Sao_Paulo).';

-- Migração a partir de times_per_day (todas viram diárias, todos os dias)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'checklists'
      AND column_name = 'times_per_day'
  ) THEN
    UPDATE public.checklists
    SET
      recurrence_kind = 'daily',
      daily_executions_per_day = GREATEST(1, LEAST(24, COALESCE(times_per_day, 1))),
      weekday_mask = 127,
      monthly_executions = NULL;
  END IF;
END $$;

ALTER TABLE public.checklists DROP COLUMN IF EXISTS times_per_day;

ALTER TABLE public.checklists DROP CONSTRAINT IF EXISTS checklists_recurrence_check;

ALTER TABLE public.checklists
  ADD CONSTRAINT checklists_recurrence_check CHECK (
    (
      recurrence_kind = 'daily'
      AND daily_executions_per_day IS NOT NULL
      AND daily_executions_per_day >= 1
      AND daily_executions_per_day <= 24
      AND weekday_mask >= 1
      AND weekday_mask <= 127
      AND monthly_executions IS NULL
    )
    OR (
      recurrence_kind = 'monthly'
      AND monthly_executions >= 1
      AND monthly_executions <= 3
      AND daily_executions_per_day IS NULL
    )
  );

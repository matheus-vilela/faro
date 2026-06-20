-- Série de despesas/contas no próprio registro de expenses (sem tabela de recorrência).
-- Substitui recurring_expense_rules + geração mensal em massa.

ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS recurring_rule_id,
  DROP COLUMN IF EXISTS occurrence_month;

DROP FUNCTION IF EXISTS public.ensure_recurring_expense_occurrences(UUID, DATE);
DROP FUNCTION IF EXISTS public.recurring_expense_due_date(DATE, INT);
DROP TABLE IF EXISTS public.recurring_expense_rules CASCADE;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS series_type TEXT NOT NULL DEFAULT 'single'
    CONSTRAINT expenses_series_type_check
    CHECK (series_type IN ('single', 'recurring', 'installment')),
  ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT
    CONSTRAINT expenses_recurrence_frequency_check
    CHECK (
      recurrence_frequency IS NULL
      OR recurrence_frequency IN (
        'weekly', 'biweekly', 'monthly', 'bimonthly',
        'quarterly', 'semiannual', 'annual'
      )
    ),
  ADD COLUMN IF NOT EXISTS installment_count INT
    CONSTRAINT expenses_installment_count_check
    CHECK (installment_count IS NULL OR installment_count >= 1),
  ADD COLUMN IF NOT EXISTS recurrence_status TEXT
    CONSTRAINT expenses_recurrence_status_check
    CHECK (
      recurrence_status IS NULL
      OR recurrence_status IN ('active', 'inactive')
    ),
  ADD COLUMN IF NOT EXISTS parent_expense_id UUID
    REFERENCES public.expenses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS series_anchor_due_date DATE,
  ADD COLUMN IF NOT EXISTS occurrence_month DATE,
  ADD COLUMN IF NOT EXISTS scheduled_adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suppressed_occurrences JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.expenses.series_type IS
  'single: lançamento único; recurring: série recorrente (mestre); installment: parcelada (mestre).';
COMMENT ON COLUMN public.expenses.recurrence_frequency IS
  'Periodicidade quando series_type = recurring.';
COMMENT ON COLUMN public.expenses.installment_count IS
  'Total de parcelas quando series_type = installment (inclui a primeira).';
COMMENT ON COLUMN public.expenses.recurrence_status IS
  'active/inactive para séries recorrentes; inativa não projeta ocorrências futuras.';
COMMENT ON COLUMN public.expenses.parent_expense_id IS
  'Despesa filha materializada ou exceção de um mês; referencia o mestre da série.';
COMMENT ON COLUMN public.expenses.series_anchor_due_date IS
  'Vencimento base da série (primeira ocorrência) no registro mestre.';
COMMENT ON COLUMN public.expenses.occurrence_month IS
  'YYYY-MM-01 do mês da ocorrência (filhas materializadas).';
COMMENT ON COLUMN public.expenses.scheduled_adjustments IS
  'Ajustes futuros: [{ "effective_from": "YYYY-MM", "amount"?, "due_date"? }] ordenados por vigência.';
COMMENT ON COLUMN public.expenses.suppressed_occurrences IS
  'Meses sem projeção virtual: ["YYYY-MM", ...] quando há filha real ou substituição.';

CREATE INDEX IF NOT EXISTS idx_expenses_series_masters
  ON public.expenses (company_id, series_type)
  WHERE parent_expense_id IS NULL
    AND series_type IN ('recurring', 'installment');

CREATE INDEX IF NOT EXISTS idx_expenses_series_children
  ON public.expenses (parent_expense_id, occurrence_month)
  WHERE parent_expense_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_unique_child_occurrence
  ON public.expenses (parent_expense_id, occurrence_month)
  WHERE parent_expense_id IS NOT NULL AND occurrence_month IS NOT NULL;

-- Mestre de série não pode ser filho.
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_series_master_not_child;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_series_master_not_child
  CHECK (
    parent_expense_id IS NULL
    OR series_type = 'single'
  );

-- Despesas recorrentes (conta de luz, água, aluguel, etc.)
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public.expenses.is_recurring IS 'Se true, despesa fixa/recorrente (ex: conta de luz, aluguel)';
COMMENT ON COLUMN public.expenses.display_name IS 'Nome para exibir na listagem (ex: Conta de água, Aluguel)';

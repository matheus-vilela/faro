-- Data de emissão do lançamento + tipo transferência entre contas bancárias.

-- 1) emission_date
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS emission_date DATE;

UPDATE public.boletos
SET emission_date = due_date
WHERE emission_date IS NULL;

ALTER TABLE public.boletos
  ALTER COLUMN emission_date SET DEFAULT CURRENT_DATE;

ALTER TABLE public.boletos
  ALTER COLUMN emission_date SET NOT NULL;

COMMENT ON COLUMN public.boletos.emission_date IS
  'Data de emissão do documento/lançamento (YYYY-MM-DD).';

-- 2) entry_kind + transfer_group_id
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS entry_kind TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS transfer_group_id UUID;

ALTER TABLE public.boletos
  DROP CONSTRAINT IF EXISTS boletos_entry_kind_check;

ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_entry_kind_check
  CHECK (entry_kind IN ('standard', 'transfer'));

ALTER TABLE public.boletos
  DROP CONSTRAINT IF EXISTS boletos_transfer_fields_check;

ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_transfer_fields_check
  CHECK (
    (
      entry_kind = 'standard'
      AND transfer_group_id IS NULL
    )
    OR (
      entry_kind = 'transfer'
      AND transfer_group_id IS NOT NULL
      AND company_category_id IS NULL
      AND expense_id IS NULL
    )
  );

COMMENT ON COLUMN public.boletos.entry_kind IS
  'standard = conta normal; transfer = transferência entre contas (fora DRE/simulação de caixa).';

COMMENT ON COLUMN public.boletos.transfer_group_id IS
  'UUID compartilhado pelas duas pernas (payable + receivable) de uma transferência.';

CREATE INDEX IF NOT EXISTS idx_boletos_transfer_group_id
  ON public.boletos (company_id, transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_boletos_entry_kind
  ON public.boletos (company_id, entry_kind)
  WHERE entry_kind = 'transfer';

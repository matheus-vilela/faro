ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS paid_at DATE,
  ADD COLUMN IF NOT EXISTS competence_date DATE,
  ADD COLUMN IF NOT EXISTS company_bank_account_id UUID
    REFERENCES public.company_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interest_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12,2);

ALTER TABLE public.boletos
  DROP CONSTRAINT IF EXISTS boletos_interest_amount_nonneg;
ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_interest_amount_nonneg CHECK (interest_amount >= 0);

ALTER TABLE public.boletos
  DROP CONSTRAINT IF EXISTS boletos_discount_amount_nonneg;
ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_discount_amount_nonneg CHECK (discount_amount >= 0);

CREATE INDEX IF NOT EXISTS boletos_paid_at_idx
  ON public.boletos (paid_at)
  WHERE paid_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS boletos_company_bank_account_id_idx
  ON public.boletos (company_bank_account_id)
  WHERE company_bank_account_id IS NOT NULL;

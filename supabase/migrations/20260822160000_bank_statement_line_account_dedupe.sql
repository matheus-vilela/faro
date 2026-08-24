-- Identidade do movimento por conta bancária (FITID/hash), para não relançar o mesmo extrato.

ALTER TABLE public.bank_statement_lines
  ADD COLUMN IF NOT EXISTS company_bank_account_id UUID
    REFERENCES public.company_bank_accounts(id) ON DELETE RESTRICT;

UPDATE public.bank_statement_lines sl
SET company_bank_account_id = i.company_bank_account_id
FROM public.bank_statement_imports i
WHERE sl.import_id = i.id
  AND sl.company_bank_account_id IS NULL;

DELETE FROM public.bank_statement_lines
WHERE company_bank_account_id IS NULL;

ALTER TABLE public.bank_statement_lines
  ALTER COLUMN company_bank_account_id SET NOT NULL;

COMMENT ON COLUMN public.bank_statement_lines.company_bank_account_id IS
  'Conta do extrato; a identidade do movimento (dedupe_key) é única nesta conta.';

-- Uma linha por chave: prefere a que já tem conciliação, senão matched/created, senão a mais antiga.
WITH ranked AS (
  SELECT
    sl.id,
    ROW_NUMBER() OVER (
      PARTITION BY sl.company_bank_account_id, sl.dedupe_key
      ORDER BY
        CASE WHEN r.statement_line_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE sl.status
          WHEN 'matched' THEN 0
          WHEN 'created_payable' THEN 1
          WHEN 'unmatched' THEN 2
          ELSE 3
        END,
        sl.created_at ASC,
        sl.id ASC
    ) AS rn
  FROM public.bank_statement_lines sl
  LEFT JOIN public.bank_reconciliations r
    ON r.statement_line_id = sl.id
)
DELETE FROM public.bank_statement_lines sl
USING ranked
WHERE sl.id = ranked.id
  AND ranked.rn > 1;

ALTER TABLE public.bank_statement_lines
  DROP CONSTRAINT IF EXISTS bank_statement_lines_account_dedupe_unique;

ALTER TABLE public.bank_statement_lines
  ADD CONSTRAINT bank_statement_lines_account_dedupe_unique
  UNIQUE (company_bank_account_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_account_status
  ON public.bank_statement_lines (company_bank_account_id, status);

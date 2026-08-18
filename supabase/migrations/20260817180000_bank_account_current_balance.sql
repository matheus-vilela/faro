-- Saldo atual por conta bancária e saldo de ledger extraído do OFX.

ALTER TABLE public.company_bank_accounts
  ADD COLUMN IF NOT EXISTS current_balance DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS balance_as_of DATE;

COMMENT ON COLUMN public.company_bank_accounts.current_balance IS
  'Saldo informado ou puxado do último extrato OFX da conta.';
COMMENT ON COLUMN public.company_bank_accounts.balance_as_of IS
  'Data de referência do current_balance (DTASOF do OFX ou digitação).';

ALTER TABLE public.bank_statement_imports
  ADD COLUMN IF NOT EXISTS ledger_balance DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS ledger_balance_as_of DATE;

COMMENT ON COLUMN public.bank_statement_imports.ledger_balance IS
  'LEDGERBAL/AVAILBAL do OFX, quando o arquivo trouxer saldo.';
COMMENT ON COLUMN public.bank_statement_imports.ledger_balance_as_of IS
  'DTASOF do saldo de ledger no OFX.';

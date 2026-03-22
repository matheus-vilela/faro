-- Adicionar tipo de pagamento (boleto, pix, ted) e campos respectivos
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'boleto' NOT NULL
  CHECK (payment_type IN ('boleto', 'pix', 'ted'));

-- PIX: tipo da chave e chave
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS pix_key_type TEXT
  CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random'));

ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS pix_key TEXT;

-- TED: dados bancários
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS bank_code TEXT;
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS agency TEXT;
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS account TEXT;
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS account_type TEXT
  CHECK (account_type IN ('conta_corrente', 'poupanca'));

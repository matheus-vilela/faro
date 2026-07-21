-- Conciliação bancária: imports de extrato (CSV/OFX), linhas e vínculos com boletos.

CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_bank_account_id UUID NOT NULL
    REFERENCES public.company_bank_accounts(id) ON DELETE RESTRICT,
  source_format TEXT NOT NULL CHECK (source_format IN ('csv', 'ofx')),
  file_name TEXT,
  storage_path TEXT,
  period_start DATE,
  period_end DATE,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('processing', 'ready', 'failed')),
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_company
  ON public.bank_statement_imports (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_account
  ON public.bank_statement_imports (company_bank_account_id);

COMMENT ON TABLE public.bank_statement_imports IS
  'Arquivos de extrato bancário importados (CSV ou OFX) por empresa/conta.';

DROP TRIGGER IF EXISTS tr_bank_statement_imports_updated_at
  ON public.bank_statement_imports;
CREATE TRIGGER tr_bank_statement_imports_updated_at
  BEFORE UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL
    REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  posted_at DATE NOT NULL,
  amount DECIMAL(14, 2) NOT NULL CHECK (amount >= 0),
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  description TEXT NOT NULL DEFAULT '',
  fitid TEXT,
  dedupe_key TEXT NOT NULL,
  raw_json JSONB,
  status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'matched', 'ignored', 'created_payable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_statement_lines_import_dedupe_unique
    UNIQUE (import_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_import
  ON public.bank_statement_lines (import_id);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_company_posted
  ON public.bank_statement_lines (company_id, posted_at);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_company_status
  ON public.bank_statement_lines (company_id, status)
  WHERE status = 'unmatched';

COMMENT ON TABLE public.bank_statement_lines IS
  'Linhas normalizadas do extrato; débitos alimentam a conciliação de contas a pagar.';

DROP TRIGGER IF EXISTS tr_bank_statement_lines_updated_at
  ON public.bank_statement_lines;
CREATE TRIGGER tr_bank_statement_lines_updated_at
  BEFORE UPDATE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  statement_line_id UUID NOT NULL
    REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  boleto_id UUID NOT NULL REFERENCES public.boletos(id) ON DELETE CASCADE,
  match_kind TEXT NOT NULL CHECK (match_kind IN ('forte', 'probable', 'manual')),
  confidence DECIMAL(5, 2),
  amount_diff DECIMAL(14, 2) NOT NULL DEFAULT 0,
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_reconciliations_line_unique UNIQUE (statement_line_id),
  CONSTRAINT bank_reconciliations_boleto_unique UNIQUE (boleto_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_company
  ON public.bank_reconciliations (company_id);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_boleto
  ON public.bank_reconciliations (boleto_id);

COMMENT ON TABLE public.bank_reconciliations IS
  'Vínculo confirmado entre linha do extrato e boleto (conta a pagar).';

-- RLS
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage bank statement imports"
  ON public.bank_statement_imports;
CREATE POLICY "Users can manage bank statement imports"
  ON public.bank_statement_imports FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage bank statement lines"
  ON public.bank_statement_lines;
CREATE POLICY "Users can manage bank statement lines"
  ON public.bank_statement_lines FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can manage bank reconciliations"
  ON public.bank_reconciliations;
CREATE POLICY "Users can manage bank reconciliations"
  ON public.bank_reconciliations FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.bank_statement_imports TO anon, authenticated;
GRANT ALL ON public.bank_statement_lines TO anon, authenticated;
GRANT ALL ON public.bank_reconciliations TO anon, authenticated;

-- Storage: extratos bancários
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bank-statements',
  'bank-statements',
  false,
  20971520,
  ARRAY[
    'text/csv',
    'text/plain',
    'application/octet-stream',
    'application/x-ofx',
    'application/xml',
    'text/xml'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "bank_statements_select_company" ON storage.objects;
CREATE POLICY "bank_statements_select_company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bank-statements'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "bank_statements_insert_company" ON storage.objects;
CREATE POLICY "bank_statements_insert_company"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bank-statements'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "bank_statements_update_company" ON storage.objects;
CREATE POLICY "bank_statements_update_company"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bank-statements'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "bank_statements_delete_company" ON storage.objects;
CREATE POLICY "bank_statements_delete_company"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bank-statements'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

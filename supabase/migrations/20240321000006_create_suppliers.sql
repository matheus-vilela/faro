-- Fornecedores
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  document TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Dados bancários / PIX do fornecedor
CREATE TABLE IF NOT EXISTS public.supplier_payment_info (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE NOT NULL UNIQUE,
  bank_name TEXT,
  bank_code TEXT,
  agency TEXT,
  account TEXT,
  account_type TEXT CHECK (account_type IN ('conta_corrente', 'poupanca')),
  pix_key TEXT,
  pix_type TEXT CHECK (pix_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Tokens de atualização única (link enviado ao fornecedor)
CREATE TABLE IF NOT EXISTS public.supplier_update_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE NOT NULL,
  token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payment_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_update_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their company suppliers"
  ON public.suppliers FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage supplier payment info"
  ON public.supplier_payment_info FOR ALL
  USING (
    supplier_id IN (
      SELECT id FROM public.suppliers
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    supplier_id IN (
      SELECT id FROM public.suppliers
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage supplier update tokens"
  ON public.supplier_update_tokens FOR ALL
  USING (
    supplier_id IN (
      SELECT id FROM public.suppliers
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    supplier_id IN (
      SELECT id FROM public.suppliers
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

-- RPC para fornecedor acessar formulário via link (anon)
CREATE OR REPLACE FUNCTION public.get_supplier_update_form(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id UUID;
  v_used_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_result JSON;
BEGIN
  SELECT st.supplier_id, st.used_at, st.expires_at
  INTO v_supplier_id, v_used_at, v_expires_at
  FROM supplier_update_tokens st
  WHERE st.token = p_token;

  IF v_supplier_id IS NULL THEN
    RETURN json_build_object('error', 'Token inválido');
  END IF;
  IF v_used_at IS NOT NULL THEN
    RETURN json_build_object('error', 'Link já utilizado');
  END IF;
  IF v_expires_at < NOW() THEN
    RETURN json_build_object('error', 'Link expirado');
  END IF;

  SELECT json_build_object(
    'supplier_name', s.name,
    'bank_name', COALESCE(spi.bank_name, ''),
    'bank_code', COALESCE(spi.bank_code, ''),
    'agency', COALESCE(spi.agency, ''),
    'account', COALESCE(spi.account, ''),
    'account_type', COALESCE(spi.account_type, 'conta_corrente'),
    'pix_key', COALESCE(spi.pix_key, ''),
    'pix_type', COALESCE(spi.pix_type, '')
  )
  INTO v_result
  FROM suppliers s
  LEFT JOIN supplier_payment_info spi ON spi.supplier_id = s.id
  WHERE s.id = v_supplier_id;

  RETURN COALESCE(v_result, json_build_object('error', 'Fornecedor não encontrado'));
END;
$$;

-- RPC para fornecedor salvar dados via link (anon)
CREATE OR REPLACE FUNCTION public.complete_supplier_payment_update(
  p_token UUID,
  p_bank_name TEXT,
  p_bank_code TEXT,
  p_agency TEXT,
  p_account TEXT,
  p_account_type TEXT,
  p_pix_key TEXT,
  p_pix_type TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_id UUID;
  v_used_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT st.supplier_id, st.used_at, st.expires_at
  INTO v_supplier_id, v_used_at, v_expires_at
  FROM supplier_update_tokens st
  WHERE st.token = p_token;

  IF v_supplier_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Token inválido');
  END IF;
  IF v_used_at IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link já utilizado');
  END IF;
  IF v_expires_at < NOW() THEN
    RETURN json_build_object('success', false, 'error', 'Link expirado');
  END IF;

  INSERT INTO supplier_payment_info (supplier_id, bank_name, bank_code, agency, account, account_type, pix_key, pix_type)
  VALUES (
    v_supplier_id,
    NULLIF(TRIM(p_bank_name), ''),
    NULLIF(TRIM(p_bank_code), ''),
    NULLIF(TRIM(p_agency), ''),
    NULLIF(TRIM(p_account), ''),
    COALESCE(NULLIF(TRIM(p_account_type), ''), 'conta_corrente'),
    NULLIF(TRIM(p_pix_key), ''),
    NULLIF(TRIM(p_pix_type), '')
  )
  ON CONFLICT (supplier_id) DO UPDATE SET
    bank_name = EXCLUDED.bank_name,
    bank_code = EXCLUDED.bank_code,
    agency = EXCLUDED.agency,
    account = EXCLUDED.account,
    account_type = EXCLUDED.account_type,
    pix_key = EXCLUDED.pix_key,
    pix_type = EXCLUDED.pix_type,
    updated_at = NOW();

  UPDATE supplier_update_tokens SET used_at = NOW() WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_update_form(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_supplier_payment_update(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

GRANT ALL ON public.suppliers TO anon, authenticated;
GRANT ALL ON public.supplier_payment_info TO anon, authenticated;
GRANT ALL ON public.supplier_update_tokens TO anon, authenticated;

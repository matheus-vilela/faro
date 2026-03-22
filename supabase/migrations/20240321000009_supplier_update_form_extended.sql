-- Estender formulário de atualização do fornecedor para incluir document, email, phone

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
    'document', COALESCE(s.document, ''),
    'email', COALESCE(s.email, ''),
    'phone', COALESCE(s.phone, ''),
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

-- Nova assinatura da função com parâmetros adicionais
DROP FUNCTION IF EXISTS public.complete_supplier_payment_update(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.complete_supplier_payment_update(
  p_token UUID,
  p_document TEXT,
  p_email TEXT,
  p_phone TEXT,
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

  -- Atualiza dados do fornecedor (document, email, phone)
  UPDATE suppliers SET
    document = NULLIF(TRIM(REGEXP_REPLACE(COALESCE(p_document, ''), '\D', '', 'g')), ''),
    email = NULLIF(TRIM(p_email), ''),
    phone = NULLIF(TRIM(REGEXP_REPLACE(COALESCE(p_phone, ''), '\D', '', 'g')), ''),
    updated_at = NOW()
  WHERE id = v_supplier_id;

  -- Insere/atualiza dados de pagamento
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

GRANT EXECUTE ON FUNCTION public.complete_supplier_payment_update(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

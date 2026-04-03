-- Link público para conferir/editar rascunho de despesa (divergência total vs itens)

ALTER TABLE public.whatsapp_expense_drafts
  ADD COLUMN IF NOT EXISTS access_token UUID;

UPDATE public.whatsapp_expense_drafts
SET access_token = gen_random_uuid()
WHERE access_token IS NULL;

ALTER TABLE public.whatsapp_expense_drafts
  ALTER COLUMN access_token SET DEFAULT gen_random_uuid();

ALTER TABLE public.whatsapp_expense_drafts
  ALTER COLUMN access_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_expense_drafts_access_token
  ON public.whatsapp_expense_drafts(access_token);

COMMENT ON COLUMN public.whatsapp_expense_drafts.access_token IS
  'Token opaco para abrir o rascunho no app (rota /w/:token) sem login.';

-- Carrega rascunho por token (anon)
CREATE OR REPLACE FUNCTION public.get_whatsapp_expense_draft_by_token(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', d.id,
    'company_id', d.company_id,
    'extracted_json', d.extracted_json,
    'sum_items', d.sum_items,
    'total_document', d.total_document,
    'expires_at', d.expires_at
  )
  INTO v_result
  FROM public.whatsapp_expense_drafts d
  WHERE d.access_token = p_token
    AND d.expires_at >= NOW();

  IF v_result IS NULL THEN
    RETURN json_build_object('error', 'Link inválido ou expirado');
  END IF;

  RETURN v_result;
END;
$$;

-- Registra despesa a partir do JSON editado e remove o rascunho
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_expense_draft(
  p_token UUID,
  p_extracted_json JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft_id UUID;
  v_company_id UUID;
  v_expires TIMESTAMPTZ;
  v_expense_id UUID;
  v_item JSONB;
  v_type TEXT;
  v_notes TEXT;
  v_total NUMERIC;
  q NUMERIC;
  uv NUMERIC;
BEGIN
  SELECT d.id, d.company_id, d.expires_at
  INTO v_draft_id, v_company_id, v_expires
  FROM public.whatsapp_expense_drafts d
  WHERE d.access_token = p_token;

  IF v_draft_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_expires < NOW() THEN
    RETURN json_build_object('success', false, 'error', 'Este link expirou');
  END IF;

  IF p_extracted_json IS NULL OR jsonb_typeof(p_extracted_json->'items') != 'array' THEN
    RETURN json_build_object('success', false, 'error', 'Dados inválidos');
  END IF;

  IF jsonb_array_length(p_extracted_json->'items') = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Inclua pelo menos um item');
  END IF;

  v_total := COALESCE((p_extracted_json->>'totalAmount')::NUMERIC, 0);
  IF v_total <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Informe o total da nota');
  END IF;

  v_type := CASE COALESCE(p_extracted_json->>'documentKind', '')
    WHEN 'romaneio' THEN 'romaneio'
    WHEN 'recibo' THEN 'recibo'
    ELSE 'nota_fiscal'
  END;

  v_notes := NULLIF(btrim(COALESCE(p_extracted_json->>'notes', '')), '');
  IF v_notes IS NOT NULL THEN
    v_notes := v_notes || ' — Importado via WhatsApp';
  ELSE
    v_notes := 'Importado via WhatsApp';
  END IF;

  INSERT INTO public.expenses (
    company_id,
    created_by,
    type,
    invoice_number,
    supplier_document,
    supplier_name,
    status,
    notes
  ) VALUES (
    v_company_id,
    NULL,
    v_type,
    NULLIF(btrim(COALESCE(p_extracted_json->>'invoiceNumber', '')), ''),
    NULLIF(btrim(COALESCE(p_extracted_json->>'supplierDocument', '')), ''),
    COALESCE(
      NULLIF(btrim(COALESCE(p_extracted_json->>'supplierName', '')), ''),
      'Fornecedor (WhatsApp)'
    ),
    'pending',
    v_notes
  )
  RETURNING id INTO v_expense_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_extracted_json->'items')
  LOOP
    q := GREATEST(0.0001::NUMERIC, COALESCE((v_item->>'quantity')::NUMERIC, 0));
    uv := ROUND(COALESCE((v_item->>'unitValue')::NUMERIC, 0)::NUMERIC, 4);
    INSERT INTO public.expense_items (
      expense_id,
      product_name,
      quantity,
      unit_value
    ) VALUES (
      v_expense_id,
      COALESCE(NULLIF(btrim(COALESCE(v_item->>'productName', '')), ''), 'Item'),
      q,
      ROUND(uv::NUMERIC, 2)
    );
  END LOOP;

  DELETE FROM public.whatsapp_expense_drafts WHERE id = v_draft_id;

  RETURN json_build_object('success', true, 'expense_id', v_expense_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_expense_draft_by_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_expense_draft(UUID, JSONB) TO anon, authenticated;

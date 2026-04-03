-- Série fiscal (NF-e / NFC-e) e deduplicação de webhooks Z-API (evita resposta duplicada)

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS invoice_series TEXT;

COMMENT ON COLUMN public.expenses.invoice_series IS
  'Série do documento fiscal (ex.: NFC-e, NF-e).';

-- Evita processar duas vezes o mesmo messageId do WhatsApp (foto/texto)
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_processed (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_processed_created
  ON public.whatsapp_inbound_processed(created_at DESC);

COMMENT ON TABLE public.whatsapp_inbound_processed IS
  'Webhooks já processados (ex.: mesma foto entregue 2x pelo provedor).';

ALTER TABLE public.whatsapp_inbound_processed ENABLE ROW LEVEL SECURITY;

-- Apenas service role / backend (sem policy = usuários não acessam)
GRANT ALL ON public.whatsapp_inbound_processed TO service_role;

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
  v_supplier_id UUID;
  v_doc_digits TEXT;
  v_doc_raw TEXT;
  v_name TEXT;
  v_invoice_series TEXT;
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

  v_doc_raw := NULLIF(btrim(COALESCE(p_extracted_json->>'supplierDocument', '')), '');
  v_doc_digits := regexp_replace(COALESCE(v_doc_raw, ''), '[^0-9]', '', 'g');

  IF length(v_doc_digits) IN (11, 14) THEN
    SELECT s.id
    INTO v_supplier_id
    FROM public.suppliers s
    WHERE s.company_id = v_company_id
      AND regexp_replace(COALESCE(s.document, ''), '[^0-9]', '', 'g') = v_doc_digits
    LIMIT 1;

    IF v_supplier_id IS NULL THEN
      v_name := COALESCE(
        NULLIF(btrim(COALESCE(p_extracted_json->>'supplierName', '')), ''),
        'Fornecedor (WhatsApp)'
      );
      INSERT INTO public.suppliers (company_id, name, document, notes)
      VALUES (
        v_company_id,
        v_name,
        v_doc_digits,
        'Cadastrado automaticamente — importação WhatsApp'
      )
      RETURNING id INTO v_supplier_id;
    END IF;
  END IF;

  v_invoice_series := NULLIF(btrim(COALESCE(p_extracted_json->>'invoiceSeries', '')), '');

  INSERT INTO public.expenses (
    company_id,
    created_by,
    type,
    invoice_number,
    invoice_series,
    supplier_id,
    supplier_document,
    supplier_name,
    status,
    notes
  ) VALUES (
    v_company_id,
    NULL,
    v_type,
    NULLIF(btrim(COALESCE(p_extracted_json->>'invoiceNumber', '')), ''),
    CASE WHEN v_type = 'nota_fiscal' THEN v_invoice_series ELSE NULL END,
    v_supplier_id,
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

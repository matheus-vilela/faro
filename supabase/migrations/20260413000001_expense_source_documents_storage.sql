-- Comprovantes (foto/PDF/XML) das despesas no Storage privado `expense-documents`.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_document_path TEXT;

COMMENT ON COLUMN public.expenses.source_document_path IS
  'Caminho do objeto no bucket expense-documents (ex.: {company_id}/whatsapp-incoming/....jpg).';

ALTER TABLE public.whatsapp_expense_drafts
  ADD COLUMN IF NOT EXISTS source_document_path TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-documents',
  'expense-documents',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/xml',
    'text/xml'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura: primeiro segmento do path = company_id da empresa do usuário
CREATE POLICY "expense_documents_select_company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "expense_documents_insert_company"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "expense_documents_update_company"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'expense-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "expense_documents_delete_company"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT uc.company_id::text
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

-- finalize_whatsapp_expense_draft: copia comprovante do rascunho para a despesa
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
  v_source_document_path TEXT;
  v_expense_id UUID;
  v_item JSONB;
  v_type TEXT;
  v_notes TEXT;
  v_total NUMERIC;
  q NUMERIC;
  uv NUMERIC;
  v_supplier_id UUID;
  v_doc_digits TEXT;
  v_doc_merged TEXT;
  v_name TEXT;
  v_invoice_series TEXT;
  v_supplier_document_display TEXT;
  v_item_product_id UUID;
  v_new_product_name TEXT;
  v_line_label TEXT;
BEGIN
  SELECT d.id, d.company_id, d.expires_at, d.source_document_path
  INTO v_draft_id, v_company_id, v_expires, v_source_document_path
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

  v_doc_merged := concat_ws(
    ' ',
    COALESCE(p_extracted_json->>'supplierDocument', ''),
    COALESCE(p_extracted_json->>'supplier_document', ''),
    COALESCE(p_extracted_json->>'notes', ''),
    COALESCE(p_extracted_json->>'supplierName', ''),
    COALESCE(p_extracted_json->>'supplier_name', '')
  );
  v_doc_digits := regexp_replace(v_doc_merged, '[^0-9]', '', 'g');

  IF length(v_doc_digits) > 14 THEN
    v_doc_digits := right(v_doc_digits, 14);
  END IF;

  IF length(v_doc_digits) NOT IN (11, 14) THEN
    v_doc_digits := NULL;
  END IF;

  IF v_doc_digits IS NOT NULL THEN
    SELECT s.id
    INTO v_supplier_id
    FROM public.suppliers s
    WHERE s.company_id = v_company_id
      AND regexp_replace(COALESCE(s.document, ''), '[^0-9]', '', 'g') = v_doc_digits
    LIMIT 1;

    IF v_supplier_id IS NULL THEN
      v_name := COALESCE(
        NULLIF(btrim(COALESCE(
          p_extracted_json->>'supplierName',
          p_extracted_json->>'supplier_name',
          ''
        )), ''),
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

  v_invoice_series := NULLIF(btrim(COALESCE(
    p_extracted_json->>'invoiceSeries',
    p_extracted_json->>'invoice_series',
    ''
  )), '');

  v_supplier_document_display := COALESCE(
    v_doc_digits,
    NULLIF(btrim(COALESCE(
      p_extracted_json->>'supplierDocument',
      p_extracted_json->>'supplier_document',
      ''
    )), '')
  );

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
    notes,
    expense_source,
    source_document_path
  ) VALUES (
    v_company_id,
    NULL,
    v_type,
    NULLIF(btrim(COALESCE(
      p_extracted_json->>'invoiceNumber',
      p_extracted_json->>'invoice_number',
      ''
    )), ''),
    CASE WHEN v_type = 'nota_fiscal' THEN v_invoice_series ELSE NULL END,
    v_supplier_id,
    v_supplier_document_display,
    COALESCE(
      NULLIF(btrim(COALESCE(
        p_extracted_json->>'supplierName',
        p_extracted_json->>'supplier_name',
        ''
      )), ''),
      'Fornecedor (WhatsApp)'
    ),
    'pending',
    v_notes,
    'whatsapp',
    v_source_document_path
  )
  RETURNING id INTO v_expense_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_extracted_json->'items')
  LOOP
    q := GREATEST(0.0001::NUMERIC, COALESCE((v_item->>'quantity')::NUMERIC, 0));
    uv := ROUND(COALESCE((v_item->>'unitValue')::NUMERIC, 0)::NUMERIC, 4);
    v_item_product_id := NULL;

    IF COALESCE((v_item->>'createProduct')::boolean, false) THEN
      v_new_product_name := NULLIF(btrim(COALESCE(
        v_item->>'newProductName',
        v_item->>'productName',
        ''
      )), '');
      IF v_new_product_name IS NULL THEN
        v_new_product_name := 'Produto';
      END IF;
      INSERT INTO public.products (company_id, name, unit, min_quantity, current_quantity)
      VALUES (v_company_id, v_new_product_name, 'un', 0, 0)
      RETURNING id INTO v_item_product_id;
    ELSIF NULLIF(btrim(COALESCE(v_item->>'productId', v_item->>'product_id', '')), '') IS NOT NULL THEN
      v_item_product_id := (NULLIF(btrim(COALESCE(v_item->>'productId', v_item->>'product_id', '')), ''))::uuid;
      IF NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = v_item_product_id AND p.company_id = v_company_id
      ) THEN
        RETURN json_build_object('success', false, 'error', 'Produto inválido para esta empresa');
      END IF;
    END IF;

    INSERT INTO public.expense_items (
      expense_id,
      product_name,
      quantity,
      unit_value,
      product_id
    ) VALUES (
      v_expense_id,
      COALESCE(NULLIF(btrim(COALESCE(v_item->>'productName', '')), ''), 'Item'),
      q,
      ROUND(uv::NUMERIC, 2),
      v_item_product_id
    );

    v_line_label := COALESCE(v_item->>'productName', '');
    IF v_item_product_id IS NOT NULL AND public.normalize_invoice_product_label(v_line_label) IS NOT NULL THEN
      INSERT INTO public.product_invoice_line_aliases (
        company_id,
        normalized_label,
        product_id
      ) VALUES (
        v_company_id,
        public.normalize_invoice_product_label(v_line_label),
        v_item_product_id
      )
      ON CONFLICT (company_id, normalized_label)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        updated_at = NOW();
    END IF;
  END LOOP;

  DELETE FROM public.whatsapp_expense_drafts WHERE id = v_draft_id;

  RETURN json_build_object('success', true, 'expense_id', v_expense_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

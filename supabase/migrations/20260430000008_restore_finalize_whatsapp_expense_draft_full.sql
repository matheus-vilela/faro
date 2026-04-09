-- Restaura o corpo completo de finalize_whatsapp_expense_draft.
-- Migrações 20260430000002 e 20260430000007 haviam substituído esta função por versões mínimas,
-- revertendo a lógica de 20260409000002 (itens com resolução, estoque, logs, produto novo com unidade/NCM).

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
  v_sender_phone TEXT;
  v_expense_id UUID;
  v_item JSONB;
  v_type TEXT;
  v_notes TEXT;
  v_total NUMERIC;
  v_divergence_reason TEXT;
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
  v_product_unit TEXT;
  v_invoice_unit TEXT;
  v_ncm TEXT;
  v_ean TEXT;
  v_import_status TEXT;
  v_match_score NUMERIC;
  v_match_reason TEXT;
  v_stock_qty NUMERIC;
  v_conv_factor NUMERIC;
  v_res_src TEXT;
  v_norm_inv TEXT;
  v_canon TEXT;
  v_out_unit TEXT;
  v_ei_id UUID;
BEGIN
  SELECT d.id, d.company_id, d.expires_at, d.source_document_path, d.sender_phone_normalized
  INTO v_draft_id, v_company_id, v_expires, v_source_document_path, v_sender_phone
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

  v_divergence_reason := NULLIF(btrim(COALESCE(
    p_extracted_json->>'divergenceReason',
    p_extracted_json->>'divergence_reason',
    ''
  )), '');

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

  IF v_divergence_reason IS NOT NULL THEN
    v_notes := v_notes || E'\nMotivo indicado na conferência (divergência): ' || v_divergence_reason;
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

  BEGIN
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
      source_document_path,
      whatsapp_sender_phone_normalized,
      document_total,
      divergence_reason
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
      v_source_document_path,
      v_sender_phone,
      v_total,
      v_divergence_reason
    )
    RETURNING id INTO v_expense_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Esta nota já foi lançada no sistema.'
      );
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_extracted_json->'items')
  LOOP
    q := GREATEST(0.0001::NUMERIC, COALESCE((v_item->>'quantity')::NUMERIC, 0));
    uv := ROUND(COALESCE((v_item->>'unitValue')::NUMERIC, 0)::NUMERIC, 4);
    v_item_product_id := NULL;

    v_invoice_unit := NULLIF(btrim(COALESCE(
      v_item->>'invoiceUnit',
      v_item->>'unitCommercial',
      v_item->>'unit_commercial',
      ''
    )), '');

    v_ncm := NULLIF(btrim(COALESCE(v_item->>'ncm', v_item->>'NCM', '')), '');
    v_ean := NULLIF(btrim(COALESCE(v_item->>'ean', v_item->>'EAN', '')), '');

    v_match_score := CASE
      WHEN COALESCE(v_item->>'matchScore', v_item->>'match_score', '') <> ''
      THEN (COALESCE(v_item->>'matchScore', v_item->>'match_score'))::NUMERIC
      ELSE NULL
    END;

    v_match_reason := NULLIF(btrim(COALESCE(
      v_item->>'matchDecisionReason',
      v_item->>'match_decision_reason',
      ''
    )), '');

    v_stock_qty := CASE
      WHEN COALESCE(v_item->>'stockQuantity', v_item->>'stock_quantity', '') <> ''
      THEN (COALESCE(v_item->>'stockQuantity', v_item->>'stock_quantity'))::NUMERIC
      ELSE NULL
    END;

    v_conv_factor := CASE
      WHEN COALESCE(v_item->>'conversionFactorApplied', v_item->>'conversion_factor_applied', '') <> ''
      THEN (COALESCE(v_item->>'conversionFactorApplied', v_item->>'conversion_factor_applied'))::NUMERIC
      ELSE NULL
    END;

    v_res_src := NULLIF(btrim(COALESCE(
      v_item->>'resolutionSource',
      v_item->>'resolution_source',
      ''
    )), '');

    v_norm_inv := NULLIF(btrim(COALESCE(
      v_item->>'normalizedInvoiceUnit',
      v_item->>'normalized_invoice_unit',
      ''
    )), '');

    v_out_unit := NULLIF(btrim(COALESCE(
      v_item->>'catalogUnitNormalized',
      v_item->>'catalog_unit_normalized',
      ''
    )), '');

    v_canon := NULLIF(btrim(COALESCE(
      v_item->>'canonicalName',
      v_item->>'canonical_name',
      ''
    )), '');

    IF COALESCE((v_item->>'createProduct')::boolean, false) THEN
      v_new_product_name := NULLIF(btrim(COALESCE(
        v_item->>'newProductName',
        v_item->>'productName',
        ''
      )), '');
      IF v_new_product_name IS NULL THEN
        v_new_product_name := 'Produto';
      END IF;

      v_product_unit := NULLIF(btrim(COALESCE(
        v_item->>'productUnit',
        v_item->>'invoiceUnit',
        v_item->>'unitCommercial',
        v_item->>'unit_commercial',
        ''
      )), '');

      IF v_product_unit IS NULL OR v_product_unit = '' THEN
        v_product_unit := 'un';
      ELSE
        v_product_unit := lower(v_product_unit);
      END IF;

      INSERT INTO public.products (
        company_id,
        name,
        unit,
        min_quantity,
        current_quantity,
        canonical_name,
        ncm
      )
      VALUES (
        v_company_id,
        v_new_product_name,
        v_product_unit,
        0,
        0,
        NULLIF(btrim(COALESCE(v_item->>'canonicalName', v_item->>'canonical_name', '')), ''),
        v_ncm
      )
      RETURNING id INTO v_item_product_id;

      v_import_status := 'NEW_PRODUCT_CREATED';
    ELSIF NULLIF(btrim(COALESCE(v_item->>'productId', v_item->>'product_id', '')), '') IS NOT NULL THEN
      v_item_product_id := (NULLIF(btrim(COALESCE(v_item->>'productId', v_item->>'product_id', '')), ''))::uuid;
      IF NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = v_item_product_id AND p.company_id = v_company_id
      ) THEN
        RETURN json_build_object('success', false, 'error', 'Produto inválido para esta empresa');
      END IF;

      v_import_status := NULLIF(btrim(COALESCE(
        v_item->>'importResolutionStatus',
        v_item->>'import_resolution_status',
        ''
      )), '');

      IF v_import_status IS NULL THEN
        v_import_status := 'USER_CONFIRMED_MATCH';
      END IF;
    ELSE
      v_import_status := NULL;
    END IF;

    IF v_import_status IS NULL THEN
      v_import_status := COALESCE(
        NULLIF(btrim(COALESCE(
          v_item->>'importResolutionStatus',
          v_item->>'import_resolution_status',
          ''
        )), ''),
        'AUTO_MATCH'
      );
    END IF;

    INSERT INTO public.expense_items (
      expense_id,
      product_name,
      quantity,
      unit_value,
      product_id,
      import_resolution_status,
      invoice_unit,
      ncm,
      ean,
      match_score,
      match_decision_reason,
      stock_quantity,
      conversion_factor_applied,
      resolution_source,
      normalized_invoice_unit
    ) VALUES (
      v_expense_id,
      COALESCE(NULLIF(btrim(COALESCE(v_item->>'productName', '')), ''), 'Item'),
      q,
      ROUND(uv::NUMERIC, 2),
      v_item_product_id,
      v_import_status,
      v_invoice_unit,
      v_ncm,
      v_ean,
      v_match_score,
      v_match_reason,
      v_stock_qty,
      v_conv_factor,
      v_res_src,
      v_norm_inv
    )
    RETURNING id INTO v_ei_id;

    IF v_item_product_id IS NOT NULL AND v_ei_id IS NOT NULL THEN
      INSERT INTO public.expense_resolution_logs (
        company_id,
        expense_id,
        expense_item_id,
        source_item_text,
        canonical_name,
        matched_product_id,
        input_quantity,
        input_unit_raw,
        input_unit_normalized,
        output_quantity,
        output_unit_normalized,
        conversion_factor,
        resolution_type,
        resolution_source,
        confidence_score
      ) VALUES (
        v_company_id,
        v_expense_id,
        v_ei_id,
        COALESCE(v_item->>'productName', ''),
        v_canon,
        v_item_product_id,
        q,
        v_invoice_unit,
        v_norm_inv,
        v_stock_qty,
        v_out_unit,
        v_conv_factor,
        v_import_status,
        v_res_src,
        v_match_score
      );
    END IF;

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

GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_expense_draft(UUID, JSONB) TO anon, authenticated;

-- Nota WhatsApp: estoque e título só depois do OK da gerência/operação.
-- Conferência/boleto recusam despesa whatsapp+pending.
-- Aprovar (dono ou permissão de notas) cria o título e libera o recebimento pendente.

CREATE OR REPLACE FUNCTION public.whatsapp_expense_awaits_approval(p_expense_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expenses e
    WHERE e.id = p_expense_id
      AND e.expense_source = 'whatsapp'
      AND e.status = 'pending'
  );
$$;

COMMENT ON FUNCTION public.whatsapp_expense_awaits_approval(UUID) IS
  'True enquanto a nota importada pelo WhatsApp ainda não teve OK da gerência/operação.';

CREATE OR REPLACE FUNCTION public.trg_block_whatsapp_pending_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.expense_id IS NOT NULL
     AND public.whatsapp_expense_awaits_approval(NEW.expense_id) THEN
    RAISE EXCEPTION 'Nota do WhatsApp ainda aguarda aprovação da gerência/operação';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_recebimentos_whatsapp_approval ON public.recebimentos;
CREATE TRIGGER tr_recebimentos_whatsapp_approval
  BEFORE INSERT OR UPDATE OF expense_id, status
  ON public.recebimentos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_block_whatsapp_pending_recebimento();

CREATE OR REPLACE FUNCTION public.trg_block_whatsapp_pending_boleto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.expense_id IS NOT NULL
     AND public.whatsapp_expense_awaits_approval(NEW.expense_id) THEN
    RAISE EXCEPTION 'Nota do WhatsApp ainda aguarda aprovação da gerência/operação';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_boletos_whatsapp_approval ON public.boletos;
CREATE TRIGGER tr_boletos_whatsapp_approval
  BEFORE INSERT OR UPDATE OF expense_id
  ON public.boletos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_block_whatsapp_pending_boleto();

CREATE OR REPLACE FUNCTION public.confirmar_recebimento(
  p_token UUID,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recebimento_id UUID;
  v_status TEXT;
  v_company_id UUID;
  v_expense_id UUID;
  v_item JSONB;
  v_expense_item_id UUID;
  v_item_status TEXT;
  v_qty_rec NUMERIC;
  v_order_qty NUMERIC;
  v_import_pending_resolution BOOLEAN;
  v_stored_qty NUMERIC;
  v_notes TEXT;
  v_apply JSONB;
BEGIN
  SELECT r.id, r.status, r.company_id, r.expense_id
  INTO v_recebimento_id, v_status, v_company_id, v_expense_id
  FROM public.recebimentos r
  WHERE r.token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF public.whatsapp_expense_awaits_approval(v_expense_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Esta nota do WhatsApp ainda aguarda aprovação da gerência/operação'
    );
  END IF;

  IF v_status = 'received' THEN
    IF auth.uid() IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
    END IF;
    IF NOT (
      public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.user_id = auth.uid() AND uc.company_id = v_company_id
      )
    ) THEN
      RETURN json_build_object('success', false, 'error', 'Sem permissão para revisar a conferência');
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_expense_item_id := (v_item->>'expense_item_id')::UUID;
    v_item_status := COALESCE((v_item->>'status')::TEXT, 'received');
    IF v_item_status NOT IN ('received', 'not_received', 'partial') THEN
      RETURN json_build_object('success', false, 'error', 'Status de item inválido');
    END IF;

    SELECT
      ei.quantity,
      ei.import_pending_resolution
    INTO v_order_qty, v_import_pending_resolution
    FROM public.expense_items ei
    WHERE ei.id = v_expense_item_id
      AND ei.expense_id = (SELECT expense_id FROM public.recebimentos WHERE id = v_recebimento_id);

    IF v_order_qty IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Item não pertence a este recebimento');
    END IF;

    IF COALESCE(v_import_pending_resolution, false) = true THEN
      RETURN json_build_object(
        'success', false,
        'error',
        'Há itens sem vínculo de estoque. Abra o detalhe da nota para vincular o produto e a conversão de unidade, depois confirme o recebimento.'
      );
    END IF;

    v_qty_rec := NULL;
    IF (v_item->>'quantity_received') IS NOT NULL AND length(trim(v_item->>'quantity_received')) > 0 THEN
      v_qty_rec := (v_item->>'quantity_received')::NUMERIC;
    END IF;

    v_notes := NULLIF(btrim(COALESCE(v_item->>'notes', '')), '');
    IF v_item_status = 'received' THEN
      v_notes := NULL;
    END IF;

    IF v_item_status = 'received' THEN
      v_stored_qty := v_order_qty;
    ELSIF v_item_status = 'not_received' THEN
      v_stored_qty := 0;
    ELSE
      IF v_qty_rec IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Informe a quantidade recebida para itens parciais');
      END IF;
      IF v_qty_rec <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Quantidade recebida deve ser maior que zero');
      END IF;
      IF v_qty_rec > v_order_qty THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Quantidade recebida não pode ser maior que a quantidade pedida.'
        );
      END IF;
      IF v_qty_rec >= v_order_qty THEN
        v_item_status := 'received';
        v_stored_qty := v_order_qty;
        v_notes := NULL;
      ELSE
        v_stored_qty := v_qty_rec;
      END IF;
    END IF;

    INSERT INTO public.recebimento_item_status (
      recebimento_id,
      expense_item_id,
      status,
      quantity_received,
      notes
    )
    VALUES (
      v_recebimento_id,
      v_expense_item_id,
      v_item_status,
      v_stored_qty,
      v_notes
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
      status = EXCLUDED.status,
      quantity_received = EXCLUDED.quantity_received,
      notes = EXCLUDED.notes;

    PERFORM public.recebimento_clear_item_stock(v_expense_item_id);
    v_apply := public.recebimento_apply_item_stock(v_expense_item_id, v_stored_qty);
    IF COALESCE((v_apply->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_apply->>'error', 'Falha ao ajustar estoque');
    END IF;
  END LOOP;

  UPDATE public.recebimentos SET
    status = 'received',
    received_at = COALESCE(received_at, NOW())
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_whatsapp_expense_as_owner(p_expense_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_source TEXT;
  v_status TEXT;
  v_item RECORD;
  v_pending JSONB;
  v_new_id UUID;
  v_name TEXT;
  v_unit TEXT;
  v_canon TEXT;
  v_ncm TEXT;
  v_conversions JSONB;
  v_line_label TEXT;
  v_amount NUMERIC;
  v_due DATE;
  v_description TEXT;
  v_category_id UUID;
  v_supplier_id UUID;
  v_reference DATE;
  v_recon JSONB;
  v_invoice TEXT;
  v_supplier_name TEXT;
  v_title TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Não autenticado');
  END IF;

  SELECT
    e.company_id,
    e.expense_source,
    e.status,
    e.document_total,
    e.reference_date,
    e.financial_reconciliation_json,
    e.supplier_name,
    e.invoice_number,
    e.supplier_id
  INTO
    v_company_id,
    v_source,
    v_status,
    v_amount,
    v_reference,
    v_recon,
    v_supplier_name,
    v_invoice,
    v_supplier_id
  FROM public.expenses e
  WHERE e.id = p_expense_id;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Despesa não encontrada');
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.user_company_has_permission(auth.uid(), v_company_id, 'despesas')
    OR public.user_company_has_permission(auth.uid(), v_company_id, 'recebimento')
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Apenas a gerência/operação pode aprovar esta nota'
    );
  END IF;

  IF v_source <> 'whatsapp' OR v_status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Despesa não está aguardando aprovação');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
      AND ei.product_id IS NULL
      AND COALESCE(ei.import_resolution_status, '') IS DISTINCT FROM 'NEW_PRODUCT_STAGED'
      AND NOT (COALESCE(ei.metadata_json, '{}'::jsonb) ? 'pending_new_product')
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Vincule ou crie um produto em todos os itens antes de aprovar'
    );
  END IF;

  FOR v_item IN
    SELECT ei.*
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
      AND ei.product_id IS NULL
      AND (
        ei.import_resolution_status = 'NEW_PRODUCT_STAGED'
        OR (COALESCE(ei.metadata_json, '{}'::jsonb) ? 'pending_new_product')
      )
  LOOP
    v_pending := COALESCE(v_item.metadata_json->'pending_new_product', '{}'::jsonb);
    v_name := NULLIF(btrim(COALESCE(v_pending->>'name', v_item.product_name, '')), '');
    IF v_name IS NULL THEN
      v_name := 'Produto';
    END IF;
    v_unit := lower(btrim(COALESCE(v_pending->>'unit', v_item.invoice_unit, '')));
    IF v_unit IS NULL OR v_unit = '' THEN
      v_unit := 'un';
    END IF;
    v_canon := NULLIF(btrim(COALESCE(v_pending->>'canonical_name', '')), '');
    v_ncm := NULLIF(btrim(COALESCE(v_pending->>'ncm', '')), '');
    v_conversions := v_pending->'conversions';
    IF v_conversions IS NULL OR jsonb_typeof(v_conversions) IS DISTINCT FROM 'array' THEN
      v_conversions := '[]'::jsonb;
    END IF;

    INSERT INTO public.products (
      company_id,
      name,
      unit,
      min_quantity,
      current_quantity,
      canonical_name,
      ncm,
      unit_conversions
    )
    VALUES (
      v_company_id,
      v_name,
      v_unit,
      0,
      0,
      v_canon,
      v_ncm,
      v_conversions
    )
    RETURNING id INTO v_new_id;

    UPDATE public.expense_items
    SET
      product_id = v_new_id,
      import_resolution_status = 'NEW_PRODUCT_CREATED',
      metadata_json = COALESCE(metadata_json, '{}'::jsonb) - 'pending_new_product'
    WHERE id = v_item.id;

    v_line_label := COALESCE(v_item.product_name, '');
    IF public.normalize_invoice_product_label(v_line_label) IS NOT NULL THEN
      INSERT INTO public.product_invoice_line_aliases (
        company_id,
        normalized_label,
        product_id
      ) VALUES (
        v_company_id,
        public.normalize_invoice_product_label(v_line_label),
        v_new_id
      )
      ON CONFLICT (company_id, normalized_label)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        updated_at = NOW();
    END IF;
  END LOOP;

  UPDATE public.expenses
  SET status = 'approved', updated_at = NOW()
  WHERE id = p_expense_id;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    SELECT SUM(ei.quantity * ei.unit_value)
    INTO v_amount
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id;
  END IF;

  v_due := NULL;
  IF v_recon IS NOT NULL THEN
    BEGIN
      v_due := NULLIF(btrim(COALESCE(v_recon->>'due_date', '')), '')::DATE;
    EXCEPTION WHEN OTHERS THEN
      v_due := NULL;
    END;
  END IF;
  IF v_due IS NULL THEN
    v_due := COALESCE(v_reference, CURRENT_DATE) + 10;
  END IF;

  v_title := NULLIF(btrim(COALESCE(v_recon->>'boleto_title', '')), '');
  v_supplier_name := NULLIF(btrim(COALESCE(v_supplier_name, '')), '');
  v_invoice := NULLIF(btrim(COALESCE(v_invoice, '')), '');
  v_description := COALESCE(
    v_title,
    CASE
      WHEN v_supplier_name IS NOT NULL AND v_invoice IS NOT NULL THEN
        v_supplier_name || ' — NF ' || v_invoice
      WHEN v_supplier_name IS NOT NULL THEN v_supplier_name
      WHEN v_invoice IS NOT NULL THEN 'NF ' || v_invoice
      ELSE 'Conta a pagar (WhatsApp)'
    END
  );

  SELECT ei.company_category_id
  INTO v_category_id
  FROM public.expense_items ei
  WHERE ei.expense_id = p_expense_id
    AND ei.company_category_id IS NOT NULL
  LIMIT 1;

  IF v_amount IS NOT NULL AND v_amount > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.boletos b WHERE b.expense_id = p_expense_id
     ) THEN
    INSERT INTO public.boletos (
      company_id,
      expense_id,
      supplier_id,
      description,
      emission_date,
      due_date,
      amount,
      flow_type,
      payment_type,
      status,
      company_category_id
    ) VALUES (
      v_company_id,
      p_expense_id,
      v_supplier_id,
      left(v_description, 2000),
      COALESCE(v_reference, CURRENT_DATE),
      v_due,
      ROUND(v_amount::NUMERIC, 2),
      'payable',
      'boleto',
      'pending',
      v_category_id
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.recebimentos WHERE expense_id = p_expense_id) THEN
    INSERT INTO public.recebimentos (expense_id) VALUES (p_expense_id);
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.approve_whatsapp_expense_as_owner(UUID) IS
  'Aprova nota WhatsApp (gerência/operação): materializa produtos, cria título a pagar e libera recebimento pendente. Não aplica estoque.';

GRANT EXECUTE ON FUNCTION public.approve_whatsapp_expense_as_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_expense_awaits_approval(UUID) TO authenticated, anon, service_role;

-- Recebimento: membro da empresa (company_members) como referência; qualquer pessoa com o link confirma.
-- (Unifica o que seria 19 operador + 20 membro — não depende de coluna assigned_operator_user_id.)

DROP INDEX IF EXISTS public.idx_recebimentos_assigned_operator;

ALTER TABLE public.recebimentos
  DROP COLUMN IF EXISTS assigned_operator_user_id;

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS assigned_company_member_id UUID REFERENCES public.company_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recebimentos_assigned_member
  ON public.recebimentos(assigned_company_member_id)
  WHERE assigned_company_member_id IS NOT NULL;

COMMENT ON COLUMN public.recebimentos.assigned_company_member_id IS
  'Membro cadastrado na empresa associado ao recebimento (referência). Não restringe quem confirma pelo link.';

CREATE OR REPLACE FUNCTION public.get_recebimento_by_token(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'id', r.id,
    'expense_id', r.expense_id,
    'status', r.status,
    'supplier_name', e.supplier_name,
    'invoice_number', e.invoice_number,
    'notes', e.notes,
    'created_at', r.created_at,
    'assigned_company_member_id', r.assigned_company_member_id,
    'assigned_member_name', cm.name,
    'viewer_can_confirm', (r.status <> 'received'),
    'items', COALESCE(
      (SELECT json_agg(json_build_object(
        'id', ei.id,
        'product_name', ei.product_name,
        'quantity', ei.quantity,
        'unit_value', ei.unit_value
      ))
      FROM public.expense_items ei
      WHERE ei.expense_id = e.id),
      '[]'::json
    )
  )
  INTO v_result
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  LEFT JOIN public.company_members cm ON cm.id = r.assigned_company_member_id
  WHERE r.token = p_token;

  RETURN COALESCE(v_result, json_build_object('error', 'Link inválido ou expirado'));
END;
$$;

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
  v_item JSONB;
  v_expense_item_id UUID;
  v_item_status TEXT;
  v_product_id UUID;
  v_quantity DECIMAL;
  v_unit_value DECIMAL;
BEGIN
  SELECT r.id, r.status
  INTO v_recebimento_id, v_status
  FROM public.recebimentos r
  WHERE r.token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_expense_item_id := (v_item->>'expense_item_id')::UUID;
    v_item_status := COALESCE((v_item->>'status')::TEXT, 'received');

    INSERT INTO public.recebimento_item_status (recebimento_id, expense_item_id, status)
    VALUES (v_recebimento_id, v_expense_item_id, v_item_status)
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET status = EXCLUDED.status;

    IF v_item_status = 'received' THEN
      SELECT ei.product_id, ei.quantity, ei.unit_value
      INTO v_product_id, v_quantity, v_unit_value
      FROM public.expense_items ei
      WHERE ei.id = v_expense_item_id
        AND ei.expense_id = (SELECT expense_id FROM public.recebimentos WHERE id = v_recebimento_id)
        AND ei.product_id IS NOT NULL
        AND COALESCE(ei.stock_added, false) = false;

      IF v_product_id IS NOT NULL AND v_quantity IS NOT NULL AND v_quantity > 0 THEN
        PERFORM public.adjust_product_stock(
          v_product_id,
          v_quantity,
          'in',
          'expense_item',
          v_expense_item_id,
          v_unit_value
        );
        UPDATE public.expense_items SET stock_added = true WHERE id = v_expense_item_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.set_recebimento_assigned_operator(UUID, UUID);

CREATE OR REPLACE FUNCTION public.set_recebimento_assigned_member(
  p_recebimento_id UUID,
  p_company_member_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_company_id UUID;
  v_member_company UUID;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Não autenticado');
  END IF;

  SELECT e.company_id INTO v_company_id
  FROM public.recebimentos r
  JOIN public.expenses e ON e.id = r.expense_id
  WHERE r.id = p_recebimento_id;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento não encontrado');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_caller
      AND uc.company_id = v_company_id
      AND uc.role IN ('owner', 'gestor')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sem permissão');
  END IF;

  SELECT cm.company_id INTO v_member_company
  FROM public.company_members cm
  WHERE cm.id = p_company_member_id;

  IF v_member_company IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Membro não encontrado');
  END IF;

  IF v_member_company IS DISTINCT FROM v_company_id THEN
    RETURN json_build_object('success', false, 'error', 'Membro não pertence a esta empresa');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.id = p_company_member_id
      AND cm.company_id = v_company_id
      AND cm.is_active = true
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Membro inativo ou inválido');
  END IF;

  UPDATE public.recebimentos
  SET assigned_company_member_id = p_company_member_id
  WHERE id = p_recebimento_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_recebimento_assigned_member(UUID, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.list_company_operators(UUID);

GRANT EXECUTE ON FUNCTION public.get_recebimento_by_token(UUID) TO anon, authenticated;

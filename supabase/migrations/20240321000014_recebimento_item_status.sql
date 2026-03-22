-- Status de cada item no recebimento (recebido / não recebido)
CREATE TABLE IF NOT EXISTS public.recebimento_item_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recebimento_id UUID REFERENCES public.recebimentos(id) ON DELETE CASCADE NOT NULL,
  expense_item_id UUID REFERENCES public.expense_items(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'not_received')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(recebimento_id, expense_item_id)
);

-- RLS
ALTER TABLE public.recebimento_item_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view recebimento item status"
  ON public.recebimento_item_status FOR SELECT
  USING (
    recebimento_id IN (
      SELECT r.id FROM recebimentos r
      JOIN expenses e ON e.id = r.expense_id
      WHERE e.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Allow insert for valid pending recebimento"
  ON public.recebimento_item_status FOR INSERT
  WITH CHECK (
    recebimento_id IN (SELECT id FROM recebimentos WHERE status = 'pending')
  );

CREATE POLICY "Users can update recebimento item status"
  ON public.recebimento_item_status FOR UPDATE
  USING (
    recebimento_id IN (
      SELECT r.id FROM recebimentos r
      JOIN expenses e ON e.id = r.expense_id
      WHERE e.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

GRANT ALL ON public.recebimento_item_status TO anon, authenticated;

-- Atualizar get_recebimento_by_token para incluir expense_item id
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
    'items', COALESCE(
      (SELECT json_agg(json_build_object(
        'id', ei.id,
        'product_name', ei.product_name,
        'quantity', ei.quantity,
        'unit_value', ei.unit_value
      ))
      FROM expense_items ei
      WHERE ei.expense_id = e.id),
      '[]'::json
    )
  )
  INTO v_result
  FROM recebimentos r
  JOIN expenses e ON e.id = r.expense_id
  WHERE r.token = p_token;

  RETURN COALESCE(v_result, json_build_object('error', 'Link inválido ou expirado'));
END;
$$;

-- Nova assinatura confirmar_recebimento com itens
DROP FUNCTION IF EXISTS public.confirmar_recebimento(UUID);

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
BEGIN
  SELECT id, status INTO v_recebimento_id, v_status
  FROM recebimentos
  WHERE token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
  END IF;

  -- Inserir status de cada item: p_items = [{"expense_item_id": "uuid", "status": "received"|"not_received"}, ...]
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO recebimento_item_status (recebimento_id, expense_item_id, status)
    VALUES (
      v_recebimento_id,
      (v_item->>'expense_item_id')::UUID,
      COALESCE((v_item->>'status')::TEXT, 'received')
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET status = EXCLUDED.status;
  END LOOP;

  UPDATE recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

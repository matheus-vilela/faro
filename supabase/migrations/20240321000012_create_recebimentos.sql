-- Cards de recebimento (gerados automaticamente ao criar despesa)
CREATE TABLE IF NOT EXISTS public.recebimentos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE NOT NULL UNIQUE,
  token UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'received')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  received_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE public.recebimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their company recebimentos"
  ON public.recebimentos FOR ALL
  USING (
    expense_id IN (
      SELECT id FROM public.expenses
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    expense_id IN (
      SELECT id FROM public.expenses
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

-- RPC para operador acessar card via link (anon)
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

-- RPC para operador confirmar recebimento (anon)
CREATE OR REPLACE FUNCTION public.confirmar_recebimento(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_status TEXT;
BEGIN
  SELECT id, status INTO v_id, v_status
  FROM recebimentos
  WHERE token = p_token;

  IF v_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
  END IF;

  UPDATE recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recebimento_by_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID) TO anon, authenticated;
GRANT ALL ON public.recebimentos TO anon, authenticated;

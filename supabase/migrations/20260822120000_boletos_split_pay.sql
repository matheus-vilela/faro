-- Pagamento parcial: saldo vira novo boleto; desfazer pagamento pode reunir o saldo.

ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS split_from_boleto_id UUID
    REFERENCES public.boletos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS boletos_split_from_boleto_id_idx
  ON public.boletos (split_from_boleto_id)
  WHERE split_from_boleto_id IS NOT NULL;

COMMENT ON COLUMN public.boletos.split_from_boleto_id IS
  'Boleto de origem quando este lançamento é o saldo de um pagamento parcial.';

CREATE OR REPLACE FUNCTION public.split_pay_boleto(
  p_boleto_id UUID,
  p_company_id UUID,
  p_pay_amount NUMERIC,
  p_paid_at DATE,
  p_competence_date DATE,
  p_bank_account_id UUID,
  p_interest_amount NUMERIC,
  p_discount_amount NUMERIC,
  p_remainder_due_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src public.boletos%ROWTYPE;
  v_remainder public.boletos%ROWTYPE;
  v_pay NUMERIC;
  v_interest NUMERIC;
  v_discount NUMERIC;
  v_paid_amount NUMERIC;
  v_remainder_amount NUMERIC;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_boleto_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'boleto e empresa são obrigatórios';
  END IF;

  IF NOT public.user_has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_src
  FROM public.boletos
  WHERE id = p_boleto_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.';
  END IF;

  IF COALESCE(v_src.flow_type, 'payable') <> 'payable' THEN
    RAISE EXCEPTION 'Pagamento parcial só é permitido em contas a pagar.';
  END IF;

  IF COALESCE(v_src.entry_kind, 'standard') = 'transfer' THEN
    RAISE EXCEPTION 'Não é possível dividir o pagamento de uma transferência.';
  END IF;

  IF v_src.status <> 'pending' THEN
    RAISE EXCEPTION 'Só é possível pagar parcialmente uma conta em aberto.';
  END IF;

  v_pay := ROUND(COALESCE(p_pay_amount, 0), 2);
  v_interest := ROUND(COALESCE(p_interest_amount, 0), 2);
  v_discount := ROUND(COALESCE(p_discount_amount, 0), 2);
  v_remainder_amount := ROUND(COALESCE(v_src.amount, 0) - v_pay, 2);
  v_paid_amount := ROUND(v_pay + v_interest - v_discount, 2);

  IF v_pay <= 0 OR v_remainder_amount <= 0 THEN
    RAISE EXCEPTION 'Informe um valor parcial maior que zero e menor que o valor da conta.';
  END IF;

  IF v_interest < 0 OR v_discount < 0 THEN
    RAISE EXCEPTION 'Juros e desconto não podem ser negativos.';
  END IF;

  IF v_paid_amount <= 0 THEN
    RAISE EXCEPTION 'O valor final do pagamento deve ser maior que zero.';
  END IF;

  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Informe a data do pagamento.';
  END IF;

  IF p_competence_date IS NULL THEN
    RAISE EXCEPTION 'Informe a competência do pagamento.';
  END IF;

  IF p_remainder_due_date IS NULL THEN
    RAISE EXCEPTION 'Informe o vencimento do saldo restante.';
  END IF;

  IF p_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Informe a conta bancária usada para pagar.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_bank_accounts a
    WHERE a.id = p_bank_account_id
      AND a.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Conta bancária inválida.';
  END IF;

  UPDATE public.boletos
  SET
    amount = v_pay,
    status = 'paid',
    paid_at = p_paid_at,
    competence_date = p_competence_date,
    company_bank_account_id = p_bank_account_id,
    interest_amount = v_interest,
    discount_amount = v_discount,
    paid_amount = v_paid_amount,
    updated_at = v_now
  WHERE id = v_src.id
    AND company_id = p_company_id
  RETURNING * INTO v_src;

  INSERT INTO public.boletos (
    company_id,
    expense_id,
    flow_type,
    entry_kind,
    transfer_group_id,
    description,
    emission_date,
    due_date,
    amount,
    category,
    company_category_id,
    payment_type,
    barcode,
    provider,
    pix_key_type,
    pix_key,
    bank_name,
    bank_code,
    agency,
    account,
    account_type,
    status,
    exclude_from_fluxo,
    revenue_entry_id,
    supplier_id,
    split_from_boleto_id
  ) VALUES (
    v_src.company_id,
    v_src.expense_id,
    COALESCE(v_src.flow_type, 'payable'),
    COALESCE(v_src.entry_kind, 'standard'),
    v_src.transfer_group_id,
    v_src.description,
    v_src.emission_date,
    p_remainder_due_date,
    v_remainder_amount,
    v_src.category,
    v_src.company_category_id,
    v_src.payment_type,
    v_src.barcode,
    v_src.provider,
    v_src.pix_key_type,
    v_src.pix_key,
    v_src.bank_name,
    v_src.bank_code,
    v_src.agency,
    v_src.account,
    v_src.account_type,
    'pending',
    COALESCE(v_src.exclude_from_fluxo, false),
    v_src.revenue_entry_id,
    v_src.supplier_id,
    v_src.id
  )
  RETURNING * INTO v_remainder;

  RETURN jsonb_build_object(
    'paid', to_jsonb(v_src),
    'remainder', to_jsonb(v_remainder)
  );
END;
$$;

COMMENT ON FUNCTION public.split_pay_boleto(
  UUID, UUID, NUMERIC, DATE, DATE, UUID, NUMERIC, NUMERIC, DATE
) IS
  'Quita parte de um boleto a pagar e cria um novo lançamento pendente com o saldo.';

REVOKE ALL ON FUNCTION public.split_pay_boleto(
  UUID, UUID, NUMERIC, DATE, DATE, UUID, NUMERIC, NUMERIC, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_pay_boleto(
  UUID, UUID, NUMERIC, DATE, DATE, UUID, NUMERIC, NUMERIC, DATE
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_pay_boleto(
  UUID, UUID, NUMERIC, DATE, DATE, UUID, NUMERIC, NUMERIC, DATE
) TO service_role;

CREATE OR REPLACE FUNCTION public.undo_pay_boleto(
  p_boleto_id UUID,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src public.boletos%ROWTYPE;
  v_child public.boletos%ROWTYPE;
  v_merge NUMERIC := 0;
  v_now TIMESTAMPTZ := NOW();
  v_keep_bank BOOLEAN;
BEGIN
  IF p_boleto_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'boleto e empresa são obrigatórios';
  END IF;

  IF NOT public.user_has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_src
  FROM public.boletos
  WHERE id = p_boleto_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'Conta não encontrada.';
  END IF;

  IF COALESCE(v_src.flow_type, 'payable') <> 'payable' THEN
    RAISE EXCEPTION 'Desfazer pagamento só é permitido em contas a pagar.';
  END IF;

  IF v_src.status <> 'paid' THEN
    RAISE EXCEPTION 'Esta conta não está paga.';
  END IF;

  FOR v_child IN
    SELECT *
    FROM public.boletos c
    WHERE c.split_from_boleto_id = v_src.id
      AND c.company_id = p_company_id
    FOR UPDATE
  LOOP
    IF v_child.status <> 'pending' THEN
      RAISE EXCEPTION 'Desfaça primeiro o pagamento do saldo restante.';
    END IF;
    v_merge := v_merge + COALESCE(v_child.amount, 0);
    DELETE FROM public.boletos
    WHERE id = v_child.id
      AND company_id = p_company_id;
  END LOOP;

  v_keep_bank := COALESCE(v_src.entry_kind, 'standard') = 'transfer';

  -- Desvincula conciliação desta conta e, se transferência, da contraparte.
  UPDATE public.bank_statement_lines sl
  SET status = 'unmatched'
  WHERE sl.company_id = p_company_id
    AND sl.status IN ('matched', 'created_payable')
    AND sl.id IN (
      SELECT r.statement_line_id
      FROM public.bank_reconciliations r
      WHERE r.company_id = p_company_id
        AND (
          r.boleto_id = v_src.id
          OR (
            COALESCE(v_src.entry_kind, 'standard') = 'transfer'
            AND v_src.transfer_group_id IS NOT NULL
            AND r.boleto_id IN (
              SELECT b.id
              FROM public.boletos b
              WHERE b.company_id = p_company_id
                AND b.transfer_group_id = v_src.transfer_group_id
                AND b.entry_kind = 'transfer'
            )
          )
        )
    );

  DELETE FROM public.bank_reconciliations r
  WHERE r.company_id = p_company_id
    AND (
      r.boleto_id = v_src.id
      OR (
        COALESCE(v_src.entry_kind, 'standard') = 'transfer'
        AND v_src.transfer_group_id IS NOT NULL
        AND r.boleto_id IN (
          SELECT b.id
          FROM public.boletos b
          WHERE b.company_id = p_company_id
            AND b.transfer_group_id = v_src.transfer_group_id
            AND b.entry_kind = 'transfer'
        )
      )
    );

  UPDATE public.boletos
  SET
    amount = ROUND(COALESCE(v_src.amount, 0) + v_merge, 2),
    status = 'pending',
    paid_at = NULL,
    competence_date = NULL,
    interest_amount = 0,
    discount_amount = 0,
    paid_amount = NULL,
    company_bank_account_id = CASE
      WHEN v_keep_bank THEN company_bank_account_id
      ELSE NULL
    END,
    updated_at = v_now
  WHERE id = v_src.id
    AND company_id = p_company_id
  RETURNING * INTO v_src;

  IF COALESCE(v_src.entry_kind, 'standard') = 'transfer'
     AND v_src.transfer_group_id IS NOT NULL THEN
    UPDATE public.boletos
    SET
      amount = v_src.amount,
      status = 'pending',
      paid_at = NULL,
      competence_date = NULL,
      interest_amount = 0,
      discount_amount = 0,
      paid_amount = NULL,
      updated_at = v_now
    WHERE company_id = p_company_id
      AND transfer_group_id = v_src.transfer_group_id
      AND entry_kind = 'transfer'
      AND id <> v_src.id;
  END IF;

  RETURN to_jsonb(v_src);
END;
$$;

COMMENT ON FUNCTION public.undo_pay_boleto(UUID, UUID) IS
  'Reabre um boleto pago; se houver saldo pendente de split, reúne o valor na conta original.';

REVOKE ALL ON FUNCTION public.undo_pay_boleto(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_pay_boleto(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_pay_boleto(UUID, UUID) TO service_role;

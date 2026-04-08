-- Tipos de alerta: vencimento de boleto a pagar em D-3 e D-1 (calendário).
ALTER TABLE public.company_alerts
  DROP CONSTRAINT IF EXISTS company_alerts_kind_check;

ALTER TABLE public.company_alerts
  ADD CONSTRAINT company_alerts_kind_check
  CHECK (
    kind IN (
      'low_stock',
      'expense_no_boleto',
      'recebimento_falta',
      'boleto_vencimento_d3',
      'boleto_vencimento_d1'
    )
  );

-- Taxas/deduções de receita entram no DRE mas não no calendário nem em contas a pagar/receber.

ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS exclude_from_fluxo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.boletos.exclude_from_fluxo IS
  'Quando true, o boleto não aparece no calendário nem nas telas de fluxo (contas a pagar/receber). Usado em lançamentos automáticos de taxas/deduções de receita para o DRE.';

CREATE OR REPLACE FUNCTION public.boleto_should_exclude_from_fluxo(
  p_revenue_entry_id UUID,
  p_description TEXT,
  p_flow_type TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    p_revenue_entry_id IS NOT NULL
    AND (
      (
        p_flow_type = 'payable'
        AND (
          p_description ILIKE 'Taxas/Dedu%'
          OR p_description ILIKE 'Despesa: Taxas/Dedu%'
        )
      )
      OR p_description ~* '\s-\s*Taxas/deducoes\s*$'
    );
$$;

UPDATE public.boletos b
SET exclude_from_fluxo = true
WHERE public.boleto_should_exclude_from_fluxo(
  b.revenue_entry_id,
  b.description,
  b.flow_type
);

CREATE OR REPLACE FUNCTION public.boletos_set_exclude_from_fluxo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.boleto_should_exclude_from_fluxo(
    NEW.revenue_entry_id,
    NEW.description,
    NEW.flow_type
  ) THEN
    NEW.exclude_from_fluxo := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_boletos_set_exclude_from_fluxo ON public.boletos;
CREATE TRIGGER tr_boletos_set_exclude_from_fluxo
  BEFORE INSERT OR UPDATE OF revenue_entry_id, description, flow_type
  ON public.boletos
  FOR EACH ROW
  EXECUTE PROCEDURE public.boletos_set_exclude_from_fluxo();

CREATE INDEX IF NOT EXISTS idx_boletos_fluxo_visible
  ON public.boletos (company_id, flow_type, due_date)
  WHERE exclude_from_fluxo = false;

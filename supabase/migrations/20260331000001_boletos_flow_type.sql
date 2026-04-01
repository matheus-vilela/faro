-- Fluxo de caixa: distingue contas a pagar e a receber na mesma tabela boletos.
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS flow_type TEXT NOT NULL DEFAULT 'payable';

ALTER TABLE public.boletos
  DROP CONSTRAINT IF EXISTS boletos_flow_type_check;

ALTER TABLE public.boletos
  ADD CONSTRAINT boletos_flow_type_check
  CHECK (flow_type IN ('payable', 'receivable'));

COMMENT ON COLUMN public.boletos.flow_type IS
  'payable = conta a pagar (saída); receivable = conta a receber (entrada).';

-- Valida categoria conforme flow_type: DESPESA para pagar, RECEITA para receber.
CREATE OR REPLACE FUNCTION public.boletos_company_category_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_flow TEXT;
  v_natureza TEXT;
BEGIN
  v_flow := COALESCE(NEW.flow_type, 'payable');
  v_natureza := CASE WHEN v_flow = 'receivable' THEN 'RECEITA' ELSE 'DESPESA' END;

  IF NEW.company_category_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_categories cc
    WHERE cc.id = NEW.company_category_id
      AND cc.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'A categoria deve pertencer à mesma empresa do boleto';
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND (
       NEW.company_category_id IS DISTINCT FROM OLD.company_category_id
       OR NEW.flow_type IS DISTINCT FROM OLD.flow_type
     )) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.company_categories cc
      WHERE cc.id = NEW.company_category_id
        AND cc.natureza = v_natureza
        AND COALESCE(cc.ativo, true) = true
        AND NOT EXISTS (
          SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id
        )
    ) THEN
      IF v_flow = 'receivable' THEN
        RAISE EXCEPTION 'Contas a receber exigem categoria de RECEITA ativa e sem filhos';
      ELSE
        RAISE EXCEPTION 'Contas a pagar exigem categoria de DESPESA ativa e sem filhos';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_boletos_company_category_match ON public.boletos;
CREATE TRIGGER tr_boletos_company_category_match
  BEFORE INSERT OR UPDATE OF company_category_id, company_id, flow_type ON public.boletos
  FOR EACH ROW
  EXECUTE PROCEDURE public.boletos_company_category_company_match();

-- Contas a pagar de CMV na venda de produto podem usar subcategoria intermediaria (com filhos).
-- O trigger exigia folha para toda despesa; alinha com produto + RPC que aceitam nos CMV abaixo da raiz.

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
    IF v_flow = 'payable' AND NEW.revenue_entry_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.company_categories cc
        WHERE cc.id = NEW.company_category_id
          AND cc.natureza = 'RECEITA'
          AND cc.papel_receita_dre = 'DEDUCAO'
          AND COALESCE(cc.ativo, true) = true
          AND NOT EXISTS (
            SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = cc.id
          )
      ) THEN
        RETURN NEW;
      END IF;
      -- CMV vinculado à receita (ex.: custo da mercadoria na venda pontual): permite folha ou nó intermediário
      IF EXISTS (
        SELECT 1
        FROM public.company_categories cc
        WHERE cc.id = NEW.company_category_id
          AND cc.natureza = 'DESPESA'
          AND cc.tipo = 'CMV'
          AND COALESCE(cc.ativo, true) = true
      ) THEN
        RETURN NEW;
      END IF;
    END IF;

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

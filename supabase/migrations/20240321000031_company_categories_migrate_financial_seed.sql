-- Plano padrão por empresa, remapeamento de boletos a partir das raízes legadas, limpeza e ativação das validações.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies
  LOOP
    PERFORM public.seed_financial_categories_v2(r.id);
  END LOOP;
END $$;

-- Remapeia contas a pagar das raízes antigas (sem padrao_sistema) para folhas do plano novo
UPDATE public.boletos b
SET company_category_id = m.new_cat
FROM (
  SELECT
    b0.id AS boleto_id,
    CASE lower(btrim(o.name))
      WHEN 'insumos'
        THEN (
          SELECT c.id FROM public.company_categories c
          WHERE c.company_id = b0.company_id AND c.padrao_sistema AND c.is_grouping = false
            AND c.macro_grupo = 'despesa' AND c.name = 'Alimentos' AND c.grupo_principal = 'CMV'
          LIMIT 1
        )
      WHEN 'custo fixo'
        THEN (
          SELECT c.id FROM public.company_categories c
          WHERE c.company_id = b0.company_id AND c.padrao_sistema AND c.is_grouping = false
            AND c.macro_grupo = 'despesa' AND c.name = 'Outras - despesas fixas'
            AND c.subgrupo = 'Despesas administrativas gerais'
          LIMIT 1
        )
      WHEN 'estabelecimento'
        THEN (
          SELECT c.id FROM public.company_categories c
          WHERE c.company_id = b0.company_id AND c.padrao_sistema AND c.is_grouping = false
            AND c.macro_grupo = 'despesa' AND c.name = 'Outras - despesas fixas'
            AND c.subgrupo = 'Despesas administrativas gerais'
          LIMIT 1
        )
      WHEN 'outros'
        THEN (
          SELECT c.id FROM public.company_categories c
          WHERE c.company_id = b0.company_id AND c.padrao_sistema AND c.is_grouping = false
            AND c.macro_grupo = 'despesa' AND c.name = 'Outras - Variáveis'
            AND c.grupo_principal = 'Despesas Variáveis'
          LIMIT 1
        )
      WHEN 'fornecedores'
        THEN (
          SELECT c.id FROM public.company_categories c
          WHERE c.company_id = b0.company_id AND c.padrao_sistema AND c.is_grouping = false
            AND c.macro_grupo = 'despesa' AND c.name = 'Outras - Variáveis'
            AND c.grupo_principal = 'Despesas Variáveis'
          LIMIT 1
        )
      ELSE NULL
    END AS new_cat
  FROM public.boletos b0
  JOIN public.company_categories o ON o.id = b0.company_category_id
  WHERE o.parent_id IS NULL
    AND o.padrao_sistema = false
    AND lower(btrim(o.name)) IN (
      'insumos', 'custo fixo', 'estabelecimento', 'outros', 'fornecedores'
    )
) AS m
WHERE b.id = m.boleto_id AND m.new_cat IS NOT NULL;

-- Remove raízes legadas simples (substituídas pelo plano padrão)
DELETE FROM public.company_categories c
WHERE c.parent_id IS NULL
  AND c.padrao_sistema = false
  AND lower(btrim(c.name)) IN (
    'insumos',
    'custo fixo',
    'estabelecimento',
    'outros',
    'fornecedores'
  );

-- Completa tipos em linhas personalizadas remanescentes (despesa sem tipo)
UPDATE public.company_categories
SET
  tipo_despesa = 'variavel',
  grupo_principal = COALESCE(grupo_principal, name)
WHERE macro_grupo = 'despesa'
  AND tipo_despesa IS NULL;

-- Raízes espúrias ainda marcadas como folha viram pasta (evita violar hierarquia)
UPDATE public.company_categories
SET is_grouping = true
WHERE parent_id IS NULL
  AND is_grouping = false
  AND macro_grupo = 'despesa';

-- Gatilhos de integridade
DROP TRIGGER IF EXISTS tr_company_categories_validate_hierarchy ON public.company_categories;
CREATE TRIGGER tr_company_categories_validate_hierarchy
  BEFORE INSERT OR UPDATE OF parent_id, company_id, macro_grupo, tipo_receita, tipo_despesa, is_grouping
  ON public.company_categories
  FOR EACH ROW
  EXECUTE PROCEDURE public.company_categories_validate_hierarchy();

DROP TRIGGER IF EXISTS tr_company_categories_prevent_delete ON public.company_categories;
CREATE TRIGGER tr_company_categories_prevent_delete
  BEFORE DELETE ON public.company_categories
  FOR EACH ROW
  EXECUTE PROCEDURE public.company_categories_prevent_delete_default();

-- Boletos: somente folha de despesa ativa
CREATE OR REPLACE FUNCTION public.boletos_company_category_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_category_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.company_categories cc
    WHERE cc.id = NEW.company_category_id AND cc.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'A categoria deve pertencer à mesma empresa do boleto';
  END IF;
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND NEW.company_category_id IS DISTINCT FROM OLD.company_category_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_categories cc
      WHERE cc.id = NEW.company_category_id
        AND cc.macro_grupo = 'despesa'
        AND cc.is_grouping = false
        AND cc.ativo = true
    ) THEN
      RAISE EXCEPTION 'Use apenas categorias de despesa ativas (folhas) em contas a pagar';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

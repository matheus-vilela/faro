-- DRE: plano padrão só com contas principais.
-- 1) Filhos padrao_sistema sem uso → DELETE
-- 2) Filhos padrao_sistema em uso → padrao_sistema = false (removíveis na UI)
-- 3) Trigger protege só raízes padrão
-- 4) seed v3 delega a v4 (purga / caminhos legados)
-- Categorias criadas pela unidade (padrao_sistema = false) NÃO são alteradas nem apagadas.

CREATE OR REPLACE FUNCTION public.company_categories_prevent_delete_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.company_delete_cascade', true), '') = 'true' THEN
    RETURN OLD;
  END IF;

  -- Só raízes padrão ficam protegidas; subcategorias podem ser removidas pela unidade.
  IF COALESCE(OLD.padrao_sistema, false) AND OLD.parent_id IS NULL THEN
    RAISE EXCEPTION 'Categoria padrão não pode ser excluída fisicamente. Use ativo = false.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.boletos b WHERE b.company_category_id = OLD.id) THEN
    RAISE EXCEPTION 'Categoria em uso por lançamentos. Arquive (ativo = false).';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_financial_categories_v3(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_financial_categories_v4(p_company_id);
END;
$$;

COMMENT ON FUNCTION public.seed_financial_categories_v3(UUID) IS
  'Delegado a seed_financial_categories_v4 (só contas principais, sem filhos).';

DO $$
DECLARE
  v_deleted int;
  v_round int := 0;
BEGIN
  -- IMPORTANTE: categorias criadas pela unidade nascem com padrao_sistema = false
  -- e NÃO entram neste UPDATE/DELETE. Só filhos do seed (padrao_sistema = true).

  -- Em uso: desmarca padrao_sistema para o financeiro poder remover depois.
  UPDATE public.company_categories c
  SET padrao_sistema = false
  WHERE c.parent_id IS NOT NULL
    AND COALESCE(c.padrao_sistema, false) = true
    AND (
      EXISTS (
        SELECT 1 FROM public.boletos b WHERE b.company_category_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.expense_items ei
        WHERE ei.company_category_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.company_product_categories pc
        WHERE pc.default_dre_category_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.products p
        WHERE p.cmv_category_id = c.id
           OR p.default_expense_category_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.company_category_budgets cb
        WHERE cb.category_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.company_revenue_category_tax_settings t
        WHERE t.category_id = c.id
      )
      OR EXISTS (
        SELECT 1
        FROM public.revenue_entries re
        WHERE re.category_id = c.id
           OR re.subcategory_id = c.id
      )
    );

  -- Apaga só folhas do seed sem uso. Nunca apaga:
  -- - categorias com padrao_sistema = false (criadas pela unidade)
  -- - nós que ainda têm filhos (protege ancestral de categoria do usuário)
  PERFORM set_config('app.company_delete_cascade', 'true', true);

  LOOP
    v_round := v_round + 1;
    IF v_round > 50 THEN
      RAISE EXCEPTION 'Limpeza de subcategorias padrão: muitas rodadas';
    END IF;

    WITH doomed AS (
      SELECT c.id
      FROM public.company_categories c
      WHERE c.parent_id IS NOT NULL
        AND COALESCE(c.padrao_sistema, false) = true
        -- Só folhas: se ainda há filhos (ex.: categoria criada pela unidade), não apaga.
        AND NOT EXISTS (
          SELECT 1 FROM public.company_categories ch WHERE ch.parent_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.boletos b WHERE b.company_category_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.expense_items ei
          WHERE ei.company_category_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.company_product_categories pc
          WHERE pc.default_dre_category_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.products p
          WHERE p.cmv_category_id = c.id
             OR p.default_expense_category_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.company_category_budgets cb
          WHERE cb.category_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.company_revenue_category_tax_settings t
          WHERE t.category_id = c.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.revenue_entries re
          WHERE re.category_id = c.id
             OR re.subcategory_id = c.id
        )
    )
    DELETE FROM public.company_categories c
    USING doomed d
    WHERE c.id = d.id
      AND COALESCE(c.padrao_sistema, false) = true
      AND c.parent_id IS NOT NULL;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    EXIT WHEN v_deleted = 0;
  END LOOP;

  PERFORM set_config('app.company_delete_cascade', '', true);
END;
$$;

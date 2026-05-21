-- =============================================================================
-- Reparo onboarding XML: entrada de stock + alinhamento de recebimentos
-- =============================================================================
-- 1) Desbloqueia `import_pending_resolution` em linhas de despesas Focus interpret
--    (`financial_reconciliation_json.source`) com `product_id`, sem stock ainda e sem
--    `EXPLODE_BY_RECIPE` (mesma ideia do motor quando o catálogo já está ok).
-- 2) Entrada de stock por linha (mesma lógica que a migração
--    `apply_xml_import_direct_stock_for_expense` — inline para ambientes onde
--    essa RPC ainda não foi aplicada).
-- 3) Atualiza `recebimento_item_status` + `recebimentos` com a mesma lógica de
--    `finalize_onboarding_xml_recebimento_for_expense`.
--
-- Não cria produtos nem resolve vínculos: linhas sem `product_id` continuam sem
-- entrada de stock. `EXPLODE_BY_RECIPE` não é forçado aqui.
--
-- Como executar (SQL Editor como postgres / service_role):
--   1. Substitua o UUID em v_company.
--   2. Recomendado: BEGIN … COMMIT; em caso de dúvida use ROLLBACK no fim.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_company uuid := '00000000-0000-0000-0000-000000000000'::uuid; -- <-- ALTERE AQUI
  n_unblock int;
  vexp record;
  v_row record;
  v_apply numeric;
  n_lines int;
  n_rec int;
  v_applied int;
BEGIN
  IF v_company = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Defina v_company com o UUID da unidade (company_id).';
  END IF;

  -- (1) Desbloquear linhas elegíveis para entrada de stock
  WITH targets AS (
    SELECT ei.id
    FROM public.expenses e
    INNER JOIN public.expense_items ei ON ei.expense_id = e.id
    WHERE e.company_id = v_company
      AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging'
      AND ei.product_id IS NOT NULL
      AND COALESCE(ei.stock_added, false) = false
      AND COALESCE(ei.import_pending_resolution, false) = true
      AND (
        ei.import_stock_resolution IS NULL
        OR ei.import_stock_resolution IS DISTINCT FROM 'EXPLODE_BY_RECIPE'
      )
  )
  UPDATE public.expense_items ei
  SET import_pending_resolution = false
  FROM targets t
  WHERE ei.id = t.id;

  GET DIAGNOSTICS n_unblock = ROW_COUNT;
  RAISE NOTICE 'Linhas com import_pending_resolution limpo (para stock): %', n_unblock;

  -- (2) Entrada de stock (idempotente: ignora stock_added)
  FOR vexp IN
    SELECT DISTINCT ei.expense_id
    FROM public.expenses e
    INNER JOIN public.expense_items ei ON ei.expense_id = e.id
    WHERE e.company_id = v_company
      AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging'
  LOOP
    v_applied := 0;
    FOR v_row IN
      SELECT
        ei.id,
        ei.product_id,
        ei.quantity,
        ei.unit_value,
        ei.stock_quantity,
        ei.stock_added,
        ei.import_pending_resolution,
        ei.import_stock_resolution
      FROM public.expense_items ei
      WHERE ei.expense_id = vexp.expense_id
    LOOP
      IF v_row.product_id IS NULL THEN
        CONTINUE;
      END IF;
      IF COALESCE(v_row.stock_added, false) THEN
        CONTINUE;
      END IF;
      IF COALESCE(v_row.import_pending_resolution, false) THEN
        CONTINUE;
      END IF;
      IF v_row.import_stock_resolution = 'EXPLODE_BY_RECIPE' THEN
        CONTINUE;
      END IF;

      v_apply := COALESCE(v_row.stock_quantity, v_row.quantity);
      IF v_apply IS NULL OR v_apply <= 0 THEN
        CONTINUE;
      END IF;

      PERFORM public.adjust_product_stock(
        v_row.product_id,
        v_apply,
        'in',
        'expense_item',
        v_row.id,
        v_row.unit_value
      );

      UPDATE public.expense_items
      SET stock_added = true
      WHERE id = v_row.id;

      v_applied := v_applied + 1;
    END LOOP;

    IF v_applied > 0 THEN
      RAISE NOTICE 'stock expense % → linhas aplicadas %', vexp.expense_id, v_applied;
    END IF;
  END LOOP;

  -- (3) Recebimentos (mesma lógica da finalize)
  WITH onboarding_recs AS (
    SELECT DISTINCT recv.id AS recebimento_id
    FROM public.expenses e
    INNER JOIN public.expense_items ei ON ei.expense_id = e.id
    INNER JOIN public.recebimentos recv ON recv.expense_id = ei.expense_id
    WHERE e.company_id = v_company
      AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging'
  ),
  computed AS (
    SELECT
      orr.recebimento_id,
      ei.id AS expense_item_id,
      CASE
        WHEN ei.product_id IS NULL OR COALESCE(ei.quantity, 0) <= 0 THEN 'not_received'
        WHEN COALESCE(ei.stock_added, false) THEN 'received'
        WHEN NOT COALESCE(ei.import_pending_resolution, false)
          AND (
            ei.import_stock_resolution IS NULL
            OR ei.import_stock_resolution IS DISTINCT FROM 'EXPLODE_BY_RECIPE'
          )
        THEN 'received'
        ELSE 'not_received'
      END AS status,
      CASE
        WHEN ei.product_id IS NULL OR COALESCE(ei.quantity, 0) <= 0 THEN 0::numeric
        WHEN COALESCE(ei.stock_added, false) THEN COALESCE(ei.stock_quantity, ei.quantity)
        WHEN NOT COALESCE(ei.import_pending_resolution, false)
          AND (
            ei.import_stock_resolution IS NULL
            OR ei.import_stock_resolution IS DISTINCT FROM 'EXPLODE_BY_RECIPE'
          )
        THEN COALESCE(ei.stock_quantity, ei.quantity)
        ELSE 0::numeric
      END AS quantity_received
    FROM onboarding_recs orr
    INNER JOIN public.recebimentos recv ON recv.id = orr.recebimento_id
    INNER JOIN public.expense_items ei ON ei.expense_id = recv.expense_id
  )
  INSERT INTO public.recebimento_item_status (
    recebimento_id,
    expense_item_id,
    status,
    quantity_received
  )
  SELECT
    c.recebimento_id,
    c.expense_item_id,
    c.status,
    c.quantity_received
  FROM computed c
  ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
    status = EXCLUDED.status,
    quantity_received = EXCLUDED.quantity_received;

  GET DIAGNOSTICS n_lines = ROW_COUNT;

  WITH onboarding_recs AS (
    SELECT DISTINCT recv.id AS recebimento_id
    FROM public.expenses e
    INNER JOIN public.expense_items ei ON ei.expense_id = e.id
    INNER JOIN public.recebimentos recv ON recv.expense_id = ei.expense_id
    WHERE e.company_id = v_company
      AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging'
  )
  UPDATE public.recebimentos rec
  SET
    status = 'received',
    received_at = now()
  FROM onboarding_recs orr
  WHERE rec.id = orr.recebimento_id;

  GET DIAGNOSTICS n_rec = ROW_COUNT;

  RAISE NOTICE 'recebimento_item_status upserts: %', n_lines;
  RAISE NOTICE 'recebimentos → received: %', n_rec;
END $$;

COMMIT;

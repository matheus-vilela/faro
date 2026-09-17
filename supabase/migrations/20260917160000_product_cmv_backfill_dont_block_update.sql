-- Backfill de CMV no AFTER UPDATE não pode abortar o save do cadastro
-- (timeout em produto usado em muitas vendas/fichas, ex. insumo granel).

CREATE OR REPLACE FUNCTION public.trg_products_refresh_revenue_cmv()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.average_cost IS NOT DISTINCT FROM NEW.average_cost
       AND OLD.last_unit_value IS NOT DISTINCT FROM NEW.last_unit_value
       AND OLD.composes_cmv IS NOT DISTINCT FROM NEW.composes_cmv THEN
      RETURN NEW;
    END IF;
    BEGIN
      PERFORM public.backfill_revenue_entries_cmv_for_product(NEW.company_id, NEW.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'cmv backfill skipped for product %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Preço de venda (EPOC/PDV). Não misturar com last_unit_value (compra/NF).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_sale_unit_value NUMERIC,
  ADD COLUMN IF NOT EXISTS last_sale_unit_value_unit_code TEXT;

COMMENT ON COLUMN public.products.last_sale_unit_value IS
  'Último preço unitário de venda (PDV/EPOC). Distinto do preço de compra.';
COMMENT ON COLUMN public.products.last_sale_unit_value_unit_code IS
  'Unidade do último preço de venda (em geral a unidade da linha do PDV).';

UPDATE public.products p
SET
  last_sale_unit_value = lei.unit_price,
  last_sale_unit_value_unit_code = coalesce(
    nullif(btrim(lei.sale_unit_code), ''),
    nullif(btrim(p.unit), ''),
    'un'
  )
FROM (
  SELECT DISTINCT ON (re.product_id)
    re.product_id,
    CASE
      WHEN re.unit_value IS NOT NULL AND re.unit_value > 0 THEN re.unit_value
      WHEN re.quantity IS NOT NULL AND re.quantity > 0 AND re.gross_amount > 0
        THEN re.gross_amount / re.quantity
      ELSE NULL
    END AS unit_price,
    re.sale_unit_code
  FROM public.revenue_entries re
  WHERE re.product_id IS NOT NULL
    AND re.entry_mode = 'product_sale'
    AND re.revenue_type = 'operational'
  ORDER BY re.product_id, re.entry_date DESC, re.created_at DESC
) lei
WHERE p.id = lei.product_id
  AND lei.unit_price IS NOT NULL
  AND lei.unit_price > 0
  AND coalesce(p.last_sale_unit_value, 0) <= 0;

CREATE OR REPLACE FUNCTION public.touch_product_last_sale_unit_value()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_unit NUMERIC;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.entry_mode IS DISTINCT FROM 'product_sale' THEN
    RETURN NEW;
  END IF;
  IF NEW.revenue_type IS DISTINCT FROM 'operational' THEN
    RETURN NEW;
  END IF;

  v_unit := NEW.unit_value;
  IF v_unit IS NULL OR v_unit <= 0 THEN
    IF NEW.quantity IS NOT NULL AND NEW.quantity > 0 AND NEW.gross_amount > 0 THEN
      v_unit := NEW.gross_amount / NEW.quantity;
    END IF;
  END IF;
  IF v_unit IS NULL OR v_unit <= 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.products
  SET
    last_sale_unit_value = v_unit,
    last_sale_unit_value_unit_code = coalesce(
      nullif(btrim(NEW.sale_unit_code), ''),
      last_sale_unit_value_unit_code,
      nullif(btrim(unit), ''),
      'un'
    ),
    updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_product_last_sale_unit_value
  ON public.revenue_entries;
CREATE TRIGGER trg_touch_product_last_sale_unit_value
  AFTER INSERT ON public.revenue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_product_last_sale_unit_value();

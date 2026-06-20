-- Garante nomes de produto sempre em MAIÚSCULAS (insert/update e backfill).

CREATE OR REPLACE FUNCTION public.products_normalize_name_uppercase()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name IS NOT NULL THEN
    NEW.name := UPPER(TRIM(NEW.name));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_name_uppercase_before_write ON public.products;

CREATE TRIGGER products_name_uppercase_before_write
  BEFORE INSERT OR UPDATE OF name ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_normalize_name_uppercase();

UPDATE public.products
SET name = UPPER(TRIM(name))
WHERE name IS NOT NULL
  AND name <> UPPER(TRIM(name));

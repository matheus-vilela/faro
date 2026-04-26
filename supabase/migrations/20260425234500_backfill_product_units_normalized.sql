-- Backfill de consistência: normaliza unidades históricas para minúsculo e
-- marca revisão apenas quando a unidade não pertence ao catálogo oficial.

UPDATE public.products
SET
  unit = lower(trim(unit)),
  last_unit_value_unit_code = CASE
    WHEN last_unit_value_unit_code IS NULL THEN NULL
    ELSE lower(trim(last_unit_value_unit_code))
  END
WHERE
  unit IS DISTINCT FROM lower(trim(unit))
  OR (
    last_unit_value_unit_code IS NOT NULL
    AND last_unit_value_unit_code IS DISTINCT FROM lower(trim(last_unit_value_unit_code))
  );

-- Recalcula flag de revisão com base no catálogo de unidades do sistema.
UPDATE public.products
SET
  import_unit_needs_review = (
    COALESCE(unit, '') <> ''
    AND lower(trim(unit)) NOT IN (
      'mg',
      'g',
      'kg',
      'ml',
      'l',
      'lata',
      'un',
      'cx',
      'pc',
      'garrafa',
      'frasco',
      'galao',
      'pote',
      'rolo',
      'pct',
      'saco',
      'barrica',
      'tambor',
      'fardo',
      'fd',
      'bisnaga',
      'maco',
      'bandeja'
    )
  ),
  import_unit_raw = CASE
    WHEN lower(trim(unit)) IN (
      'mg',
      'g',
      'kg',
      'ml',
      'l',
      'lata',
      'un',
      'cx',
      'pc',
      'garrafa',
      'frasco',
      'galao',
      'pote',
      'rolo',
      'pct',
      'saco',
      'barrica',
      'tambor',
      'fardo',
      'fd',
      'bisnaga',
      'maco',
      'bandeja'
    ) THEN NULL
    ELSE COALESCE(import_unit_raw, unit)
  END;

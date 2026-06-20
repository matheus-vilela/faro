-- Corrige conversões gravadas com volume/massa total da embalagem em vez de por unidade (un),
-- quando há equivalência N un = 1 cx|pct|fd… (bug corrigido em buildPackUnitConversionsFromLabel).

CREATE OR REPLACE FUNCTION public.fix_unit_conversions_volume_per_inner_unit(
  p_stock_unit TEXT,
  p_conversions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_hub TEXT;
  v_pack_factor NUMERIC;
  v_elem JSONB;
  v_out JSONB := '[]'::jsonb;
  v_pri_unit TEXT;
  v_sec_unit TEXT;
  v_pri_qty NUMERIC;
  v_sec_qty NUMERIC;
  v_new_sec NUMERIC;
  v_liters NUMERIC;
  v_ml NUMERIC;
BEGIN
  IF p_conversions IS NULL OR jsonb_typeof(p_conversions) <> 'array' THEN
    RETURN coalesce(p_conversions, '[]'::jsonb);
  END IF;

  v_hub := lower(trim(coalesce(p_stock_unit, '')));
  IF v_hub = '' THEN
    RETURN p_conversions;
  END IF;

  -- Fator N un = 1 embalagem (ex.: 24 un → 1 cx)
  SELECT max((elem->>'primary_qty')::numeric)
  INTO v_pack_factor
  FROM jsonb_array_elements(p_conversions) elem
  WHERE lower(trim(elem->>'primary_unit_code')) = v_hub
    AND (elem->>'secondary_qty')::numeric = 1
    AND lower(trim(elem->>'secondary_unit_code')) IN (
      'cx', 'pct', 'fd', 'gl', 'sc', 'mco', 'pac', 'fardo', 'caixa'
    )
    AND (elem->>'primary_qty')::numeric >= 2;

  IF v_pack_factor IS NULL OR v_pack_factor < 2 THEN
    RETURN p_conversions;
  END IF;

  -- Litros por un (para validar par l/ml após correção)
  SELECT (elem->>'secondary_qty')::numeric
  INTO v_liters
  FROM jsonb_array_elements(p_conversions) elem
  WHERE lower(trim(elem->>'primary_unit_code')) = v_hub
    AND lower(trim(elem->>'secondary_unit_code')) = 'l'
  LIMIT 1;

  SELECT (elem->>'secondary_qty')::numeric
  INTO v_ml
  FROM jsonb_array_elements(p_conversions) elem
  WHERE lower(trim(elem->>'primary_unit_code')) = v_hub
    AND lower(trim(elem->>'secondary_unit_code')) = 'ml'
  LIMIT 1;

  -- Só corrige se o volume em L parece ser total da caixa (ex.: 7,92 L com 24 un, não 0,33 L)
  IF v_liters IS NULL OR v_liters < v_pack_factor * 0.15 THEN
    RETURN p_conversions;
  END IF;

  -- Confirmação extra: ml/L ≈ 1000 quando ambos existem
  IF v_ml IS NOT NULL AND v_liters > 0 AND abs((v_ml / v_liters) - 1000) > 50 THEN
    RETURN p_conversions;
  END IF;

  FOR v_elem IN SELECT elem FROM jsonb_array_elements(p_conversions) elem
  LOOP
    v_pri_unit := lower(trim(v_elem->>'primary_unit_code'));
    v_sec_unit := lower(trim(v_elem->>'secondary_unit_code'));
    v_pri_qty := (v_elem->>'primary_qty')::numeric;
    v_sec_qty := (v_elem->>'secondary_qty')::numeric;

    IF v_pri_unit = v_hub
       AND v_sec_unit IN ('l', 'ml', 'kg', 'g', 'mg')
       AND v_sec_qty IS NOT NULL
       AND v_sec_qty > 0
    THEN
      v_new_sec := round((v_sec_qty / v_pack_factor)::numeric, 6);
      IF v_new_sec <= 0 THEN
        v_out := v_out || jsonb_build_array(v_elem);
        CONTINUE;
      END IF;
      v_elem := jsonb_build_object(
        'primary_qty', coalesce(nullif(v_pri_qty, 0), 1),
        'primary_unit_code', v_pri_unit,
        'secondary_qty', v_new_sec,
        'secondary_unit_code', v_sec_unit
      );
    END IF;

    v_out := v_out || jsonb_build_array(v_elem);
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.fix_unit_conversions_volume_per_inner_unit(TEXT, JSONB) IS
  'Divide conversões L/ml/kg/g/mg por un quando o valor parece ser volume total da embalagem (N un = 1 cx).';

DO $$
DECLARE
  v_row RECORD;
  v_fixed JSONB;
  v_changed INTEGER := 0;
  v_scanned INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id, lower(trim(unit)) AS hub, unit_conversions
    FROM public.products
    WHERE lower(trim(unit)) = 'un'
      AND jsonb_array_length(coalesce(unit_conversions, '[]'::jsonb)) > 0
  LOOP
    v_scanned := v_scanned + 1;
    v_fixed := public.fix_unit_conversions_volume_per_inner_unit(
      v_row.hub,
      v_row.unit_conversions
    );

    IF v_fixed IS DISTINCT FROM v_row.unit_conversions THEN
      UPDATE public.products
      SET
        unit_conversions = v_fixed,
        updated_at = NOW()
      WHERE id = v_row.id;

      v_changed := v_changed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE
    'backfill unit_conversions volume per un: scanned=%, updated=%',
    v_scanned,
    v_changed;
END;
$$;

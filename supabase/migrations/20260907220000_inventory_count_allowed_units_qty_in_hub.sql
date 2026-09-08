-- Contagem pública: fator numérico por unidade (calculadora de caixas).
-- Não muda o save; só enriquece allowed_units com qty_in_hub.

CREATE OR REPLACE FUNCTION public.inventory_count_public_allowed_units(
  p_hub TEXT,
  p_conversions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_hub TEXT := lower(trim(COALESCE(p_hub, '')));
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_code TEXT;
  v_hint_qty NUMERIC;
  v_out JSONB := '[]'::jsonb;
  v_sys TEXT;
BEGIN
  IF v_hub = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_codes := array_append(v_codes, v_hub);

  FOR v_code IN
    SELECT DISTINCT lower(trim(elem->>'secondary_unit_code'))
    FROM jsonb_array_elements(COALESCE(p_conversions, '[]'::jsonb)) elem
    WHERE lower(trim(COALESCE(elem->>'primary_unit_code', ''))) = v_hub
      AND trim(COALESCE(elem->>'secondary_unit_code', '')) <> ''
  LOOP
    IF NOT v_code = ANY (v_codes) THEN
      v_codes := array_append(v_codes, v_code);
    END IF;
  END LOOP;

  FOREACH v_sys IN ARRAY ARRAY['mg','g','kg','ml','l']
  LOOP
    IF public.inventory_count_system_unit_factor(v_hub, v_sys) IS NOT NULL
       AND NOT v_sys = ANY (v_codes) THEN
      v_codes := array_append(v_codes, v_sys);
    END IF;
  END LOOP;

  FOREACH v_code IN ARRAY v_codes
  LOOP
    IF v_code = v_hub THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', v_code,
        'hint', NULL,
        'qty_in_hub', 1
      ));
    ELSE
      v_hint_qty := public.inventory_count_qty_to_hub(1, v_code, v_hub, p_conversions);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', v_code,
        'hint', CASE
          WHEN v_hint_qty IS NULL THEN NULL
          ELSE '1 ' || v_code || ' = ' || COALESCE(public.inventory_count_format_qty_hint(v_hint_qty), v_hint_qty::text) || ' ' || v_hub
        END,
        'qty_in_hub', v_hint_qty
      ));
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

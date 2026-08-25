-- Totais de entrada/saída para ordenar a correlação pelo que mais gira.

CREATE OR REPLACE FUNCTION public.product_movement_totals(
  p_company_id UUID,
  p_product_ids UUID[]
)
RETURNS TABLE (
  product_id UUID,
  in_qty DOUBLE PRECISION,
  out_qty DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN;
  END IF;
  IF p_product_ids IS NULL OR cardinality(p_product_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    coalesce(sum(sm.quantity) FILTER (
      WHERE sm.type = 'in'
        AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
        AND (sm.metadata_json->>'undone_at') IS NULL
    ), 0)::double precision,
    coalesce(sum(sm.quantity) FILTER (
      WHERE sm.type = 'out'
        AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
        AND (sm.metadata_json->>'undone_at') IS NULL
    ), 0)::double precision
  FROM public.products p
  LEFT JOIN public.stock_movements sm ON sm.product_id = p.id
  WHERE p.company_id = p_company_id
    AND p.id = ANY (p_product_ids)
  GROUP BY p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.product_movement_totals(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_movement_totals(UUID, UUID[]) TO authenticated;

COMMENT ON FUNCTION public.product_movement_totals(UUID, UUID[]) IS
  'Soma entradas e saídas reais (ignora merge) para ordenar correlação pelo giro.';

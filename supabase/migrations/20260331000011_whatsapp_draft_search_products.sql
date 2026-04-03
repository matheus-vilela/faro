-- Busca e paginação de produtos no rascunho WhatsApp (página pública /w/:token)
-- + resolução de rótulos para produtos já vinculados sem nome em cache

CREATE OR REPLACE FUNCTION public.search_products_for_whatsapp_draft(
  p_token UUID,
  p_query TEXT DEFAULT '',
  p_limit INT DEFAULT 40,
  p_offset INT DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_q TEXT;
  v_lim INT;
  v_off INT;
BEGIN
  SELECT d.company_id
  INTO v_company_id
  FROM public.whatsapp_expense_drafts d
  WHERE d.access_token = p_token
    AND d.expires_at >= NOW()
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  v_q := trim(coalesce(p_query, ''));
  v_lim := LEAST(GREATEST(coalesce(p_limit, 40), 1), 100);
  v_off := GREATEST(coalesce(p_offset, 0), 0);

  RETURN COALESCE(
    (
      SELECT json_agg(row_to_json(t) ORDER BY t.name)
      FROM (
        SELECT p.id, p.name
        FROM public.products p
        WHERE p.company_id = v_company_id
          AND (
            v_q = ''
            OR p.name ILIKE '%' || v_q || '%'
          )
        ORDER BY p.name ASC
        LIMIT v_lim
        OFFSET v_off
      ) t
    ),
    '[]'::json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_for_whatsapp_draft(UUID, TEXT, INT, INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_draft_product_labels(
  p_token UUID,
  p_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT d.company_id
  INTO v_company_id
  FROM public.whatsapp_expense_drafts d
  WHERE d.access_token = p_token
    AND d.expires_at >= NOW()
  LIMIT 1;

  IF v_company_id IS NULL OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN '[]'::json;
  END IF;

  RETURN COALESCE(
    (
      SELECT json_agg(row_to_json(t) ORDER BY t.name)
      FROM (
        SELECT p.id, p.name
        FROM public.products p
        WHERE p.company_id = v_company_id
          AND p.id = ANY (p_ids)
      ) t
    ),
    '[]'::json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_whatsapp_draft_product_labels(UUID, UUID[]) TO anon, authenticated;

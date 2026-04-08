-- Grupos de contagem (rótulos por setor/projeto) e operador designado no painel.

CREATE TABLE IF NOT EXISTS public.inventory_count_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_count_groups_name_not_empty CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_groups_company
  ON public.inventory_count_groups(company_id, sort_order, name);

COMMENT ON TABLE public.inventory_count_groups IS
  'Agrupamento opcional de sessões de contagem (ex.: Cozinha, Depósito).';

ALTER TABLE public.inventory_count_sessions
  ADD COLUMN IF NOT EXISTS inventory_count_group_id UUID
    REFERENCES public.inventory_count_groups(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_count_sessions
  ADD COLUMN IF NOT EXISTS assigned_company_member_id UUID
    REFERENCES public.company_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_count_sessions.company_member_id IS
  'Membro que iniciou a sessão pelo WhatsApp (*estoque*).';

COMMENT ON COLUMN public.inventory_count_sessions.assigned_company_member_id IS
  'Operador designado no painel para executar a contagem (opcional).';

COMMENT ON COLUMN public.inventory_count_sessions.inventory_count_group_id IS
  'Grupo de contagem (opcional), cadastrado na aba Contagem.';

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_group
  ON public.inventory_count_sessions(inventory_count_group_id)
  WHERE inventory_count_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_assigned
  ON public.inventory_count_sessions(assigned_company_member_id)
  WHERE assigned_company_member_id IS NOT NULL;

ALTER TABLE public.inventory_count_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users read inventory count groups"
  ON public.inventory_count_groups FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Company users manage inventory count groups"
  ON public.inventory_count_groups FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.inventory_count_groups TO authenticated;
GRANT ALL ON public.inventory_count_groups TO service_role;

-- Dados públicos da contagem: grupo e operador designado (para exibir no link)
CREATE OR REPLACE FUNCTION public.get_inventory_count_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_company_name TEXT;
  v_products JSON;
  v_group_name TEXT;
  v_assigned_name TEXT;
BEGIN
  SELECT s.id, s.company_id, s.status
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'closed');
  END IF;

  SELECT c.name INTO v_company_name
  FROM public.companies c
  WHERE c.id = v_sess.company_id;

  SELECT COALESCE(ig.name, ''), COALESCE(am.name, '')
  INTO v_group_name, v_assigned_name
  FROM public.inventory_count_sessions s
  LEFT JOIN public.inventory_count_groups ig ON ig.id = s.inventory_count_group_id
  LEFT JOIN public.company_members am ON am.id = s.assigned_company_member_id
  WHERE s.id = v_sess.id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', p.id,
      'name', p.name,
      'sku', p.sku,
      'unit', p.unit,
      'current_quantity', p.current_quantity
    ) ORDER BY p.name
  ), '[]'::json)
  INTO v_products
  FROM (
    SELECT p.id, p.name, p.sku, p.unit, p.current_quantity
    FROM public.products p
    WHERE p.company_id = v_sess.company_id
      AND (p.is_active IS NULL OR p.is_active = true)
    ORDER BY p.name
    LIMIT 500
  ) p;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_sess.id,
    'company_name', COALESCE(v_company_name, ''),
    'group_name', COALESCE(v_group_name, ''),
    'assigned_to_name', COALESCE(v_assigned_name, ''),
    'products', v_products
  );
END;
$$;

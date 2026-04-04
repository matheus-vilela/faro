-- Checklists: itens, atribuição a membros, execuções (runs) e RPCs públicas por token

CREATE TABLE IF NOT EXISTS public.checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  /** Quantas execuções completas esperadas por dia (calendário America/Sao_Paulo). */
  times_per_day INTEGER NOT NULL DEFAULT 1 CHECK (times_per_day >= 1 AND times_per_day <= 24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.checklists IS 'Checklists operacionais por empresa; periodicidade via times_per_day.';

CREATE INDEX IF NOT EXISTS idx_checklists_company ON public.checklists(company_id);

DROP TRIGGER IF EXISTS tr_checklists_updated_at ON public.checklists;
CREATE TRIGGER tr_checklists_updated_at
  BEFORE UPDATE ON public.checklists
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON public.checklist_items(checklist_id);

CREATE TABLE IF NOT EXISTS public.checklist_assignments (
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  company_member_id UUID NOT NULL REFERENCES public.company_members(id) ON DELETE CASCADE,
  PRIMARY KEY (checklist_id, company_member_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_assignments_member ON public.checklist_assignments(company_member_id);

CREATE TABLE IF NOT EXISTS public.checklist_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  company_member_id UUID NOT NULL REFERENCES public.company_members(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.checklist_runs IS 'Uma execução do checklist (link público); submissão única após marcar todos os itens.';

CREATE INDEX IF NOT EXISTS idx_checklist_runs_checklist ON public.checklist_runs(checklist_id);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_member ON public.checklist_runs(company_member_id);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_submitted ON public.checklist_runs(submitted_at DESC)
  WHERE status = 'submitted';

DROP TRIGGER IF EXISTS tr_checklist_runs_updated_at ON public.checklist_runs;
CREATE TRIGGER tr_checklist_runs_updated_at
  BEFORE UPDATE ON public.checklist_runs
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.checklist_run_items (
  run_id UUID NOT NULL REFERENCES public.checklist_runs(id) ON DELETE CASCADE,
  checklist_item_id UUID NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, checklist_item_id)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_checklist_menu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sender_phone_normalized TEXT NOT NULL,
  checklist_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_checklist_menu_lookup
  ON public.whatsapp_checklist_menu(sender_phone_normalized, company_id, created_at DESC);

COMMENT ON TABLE public.whatsapp_checklist_menu IS 'Menu numérico Checklist no WhatsApp (ordem = opções).';

-- RLS
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_checklist_menu ENABLE ROW LEVEL SECURITY;

-- Políticas: empresa via user_companies
CREATE POLICY "checklists_select_company"
  ON public.checklists FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "checklists_insert_company"
  ON public.checklists FOR INSERT
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "checklists_update_company"
  ON public.checklists FOR UPDATE
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "checklists_delete_company"
  ON public.checklists FOR DELETE
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "checklist_items_all_via_checklist"
  ON public.checklist_items FOR ALL
  USING (
    checklist_id IN (
      SELECT id FROM public.checklists
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    checklist_id IN (
      SELECT id FROM public.checklists
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "checklist_assignments_all_via_checklist"
  ON public.checklist_assignments FOR ALL
  USING (
    checklist_id IN (
      SELECT id FROM public.checklists
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    checklist_id IN (
      SELECT id FROM public.checklists
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
    AND company_member_id IN (
      SELECT id FROM public.company_members cm
      WHERE cm.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "checklist_runs_select_company"
  ON public.checklist_runs FOR SELECT
  USING (
    checklist_id IN (
      SELECT id FROM public.checklists
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "checklist_run_items_select_company"
  ON public.checklist_run_items FOR SELECT
  USING (
    run_id IN (
      SELECT r.id FROM public.checklist_runs r
      JOIN public.checklists c ON c.id = r.checklist_id
      WHERE c.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

-- Sem políticas para whatsapp_checklist_menu (só service role / edge)

-- RPC: carregar execução pública
CREATE OR REPLACE FUNCTION public.get_checklist_run_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_checklist RECORD;
  v_items JSON;
  v_states JSON;
BEGIN
  SELECT r.id, r.checklist_id, r.status, r.submitted_at
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.token = p_token;

  IF v_run.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT c.id, c.title, c.description, c.active
  INTO v_checklist
  FROM public.checklists c
  WHERE c.id = v_run.checklist_id;

  IF NOT v_checklist.active THEN
    RETURN json_build_object('ok', false, 'error', 'inactive');
  END IF;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', ci.id,
      'title', ci.title,
      'sort_order', ci.sort_order
    ) ORDER BY ci.sort_order, ci.title
  ), '[]'::json)
  INTO v_items
  FROM public.checklist_items ci
  WHERE ci.checklist_id = v_run.checklist_id;

  SELECT COALESCE(json_object_agg(
    cri.checklist_item_id::text,
    to_json(cri.completed_at)
  ), '{}'::json)
  INTO v_states
  FROM public.checklist_run_items cri
  WHERE cri.run_id = v_run.id;

  RETURN json_build_object(
    'ok', true,
    'run', json_build_object(
      'id', v_run.id,
      'status', v_run.status,
      'submitted_at', v_run.submitted_at
    ),
    'checklist', json_build_object(
      'title', v_checklist.title,
      'description', v_checklist.description
    ),
    'items', v_items,
    'item_completed', COALESCE(v_states, '{}'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_checklist_run_public(UUID) TO anon, authenticated;

-- RPC: marcar item (somente run aberto)
CREATE OR REPLACE FUNCTION public.set_checklist_run_item_public(
  p_token UUID,
  p_checklist_item_id UUID,
  p_completed BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_checklist_id UUID;
  v_status TEXT;
BEGIN
  SELECT r.id, r.checklist_id, r.status
  INTO v_run_id, v_checklist_id, v_status
  FROM public.checklist_runs r
  WHERE r.token = p_token;

  IF v_run_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.checklist_items ci
    WHERE ci.id = p_checklist_item_id AND ci.checklist_id = v_checklist_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_item');
  END IF;

  IF p_completed THEN
    INSERT INTO public.checklist_run_items (run_id, checklist_item_id, completed_at)
    VALUES (v_run_id, p_checklist_item_id, NOW())
    ON CONFLICT (run_id, checklist_item_id)
    DO UPDATE SET completed_at = NOW();
  ELSE
    UPDATE public.checklist_run_items
    SET completed_at = NULL
    WHERE run_id = v_run_id AND checklist_item_id = p_checklist_item_id;
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_checklist_run_item_public(UUID, UUID, BOOLEAN) TO anon, authenticated;

-- RPC: submeter (todos os itens obrigatórios marcados)
CREATE OR REPLACE FUNCTION public.submit_checklist_run_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id UUID;
  v_checklist_id UUID;
  v_status TEXT;
  v_total INT;
  v_done INT;
BEGIN
  SELECT r.id, r.checklist_id, r.status
  INTO v_run_id, v_checklist_id, v_status
  FROM public.checklist_runs r
  WHERE r.token = p_token;

  IF v_run_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  SELECT COUNT(*)::int INTO v_total
  FROM public.checklist_items
  WHERE checklist_id = v_checklist_id;

  IF v_total = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_items');
  END IF;

  SELECT COUNT(*)::int INTO v_done
  FROM public.checklist_run_items cri
  JOIN public.checklist_items ci ON ci.id = cri.checklist_item_id AND ci.checklist_id = v_checklist_id
  WHERE cri.run_id = v_run_id AND cri.completed_at IS NOT NULL;

  IF v_done < v_total THEN
    RETURN json_build_object('ok', false, 'error', 'incomplete', 'missing', v_total - v_done);
  END IF;

  UPDATE public.checklist_runs
  SET status = 'submitted', submitted_at = NOW()
  WHERE id = v_run_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_checklist_run_public(UUID) TO anon, authenticated;

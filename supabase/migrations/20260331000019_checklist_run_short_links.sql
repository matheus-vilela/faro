-- Links curtos /k/:slug → execução pública de checklist; invalidados ao submeter (linha em short_links removida).

CREATE TABLE IF NOT EXISTS public.checklist_run_short_links (
  slug TEXT PRIMARY KEY NOT NULL,
  run_id UUID NOT NULL REFERENCES public.checklist_runs(id) ON DELETE CASCADE,
  token UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT checklist_run_short_links_one_per_run UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_run_short_links_run_id
  ON public.checklist_run_short_links(run_id);

COMMENT ON TABLE public.checklist_run_short_links IS
  'Slug curto (ex.: /k/abc12xyz) → token do run; removido ao submeter; leitura só via RPC pública.';

ALTER TABLE public.checklist_run_short_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_checklist_run_token_by_short_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.token
  FROM public.checklist_run_short_links l
  INNER JOIN public.checklist_runs r ON r.id = l.run_id
  WHERE l.slug = lower(trim(p_slug))
    AND r.status = 'open';
$$;

GRANT EXECUTE ON FUNCTION public.get_checklist_run_token_by_short_slug(text) TO anon, authenticated;

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

  IF v_run.status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
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

  DELETE FROM public.checklist_run_short_links WHERE run_id = v_run_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_checklist_run_public(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checklist_run_public(UUID) TO anon, authenticated;

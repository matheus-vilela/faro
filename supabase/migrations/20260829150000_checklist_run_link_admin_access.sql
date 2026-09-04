-- RPCs de checklist criadas depois do patch de platform admin ainda
-- exigiam membership em user_companies. Admin Faro vê a tela (RLS) mas
-- recebia { ok: false, error: "forbidden" } ao gerar o link (HTTP 200).

CREATE OR REPLACE FUNCTION public.create_checklist_run_for_member(
  p_checklist_id UUID,
  p_company_member_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cl RECORD;
  v_run_id UUID;
  v_token UUID;
  v_slug TEXT;
  v_item RECORD;
BEGIN
  SELECT c.id, c.company_id INTO v_cl
  FROM public.checklists c
  WHERE c.id = p_checklist_id;

  IF v_cl.id IS NULL OR NOT public.user_has_company_access(v_cl.company_id) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.id = p_company_member_id AND m.company_id = v_cl.company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_member');
  END IF;

  INSERT INTO public.checklist_runs (
    checklist_id, company_member_id, company_id, status
  ) VALUES (
    p_checklist_id, p_company_member_id, v_cl.company_id, 'open'
  )
  RETURNING id, token INTO v_run_id, v_token;

  FOR v_item IN
    SELECT id FROM public.checklist_items WHERE checklist_id = p_checklist_id
  LOOP
    INSERT INTO public.checklist_run_items (run_id, checklist_item_id, company_id)
    VALUES (v_run_id, v_item.id, v_cl.company_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  v_slug := substr(md5(v_run_id::text || clock_timestamp()::text), 1, 8);
  INSERT INTO public.checklist_run_short_links (slug, run_id, token, company_id)
  VALUES (v_slug, v_run_id, v_token, v_cl.company_id)
  ON CONFLICT DO NOTHING;

  RETURN json_build_object(
    'ok', true,
    'run_id', v_run_id,
    'token', v_token,
    'slug', v_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checklist_run_for_member(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.review_checklist_run(
  p_run_id UUID,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('in_review', 'approved', 'needs_rework') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.checklist_runs r
    WHERE r.id = p_run_id
      AND public.user_has_company_access(r.company_id)
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.checklist_runs
  SET
    status = p_status,
    reviewed_at = NOW(),
    review_notes = p_notes
  WHERE id = p_run_id
    AND status IN ('submitted', 'in_review', 'needs_rework', 'approved');

  RETURN json_build_object('ok', true, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_checklist_run(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_staff_performance_link(p_company_member_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
  v_slug TEXT;
  v_token UUID;
BEGIN
  SELECT m.id, m.company_id INTO v_member
  FROM public.company_members m
  WHERE m.id = p_company_member_id;

  IF v_member.id IS NULL OR NOT public.user_has_company_access(v_member.company_id) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT slug, token INTO v_slug, v_token
  FROM public.staff_performance_links
  WHERE company_member_id = v_member.id;

  IF v_slug IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'slug', v_slug, 'token', v_token);
  END IF;

  v_slug := substr(md5(v_member.id::text || clock_timestamp()::text), 1, 8);
  INSERT INTO public.staff_performance_links (
    slug, company_id, company_member_id
  ) VALUES (
    v_slug, v_member.company_id, v_member.id
  )
  RETURNING token INTO v_token;

  RETURN json_build_object('ok', true, 'slug', v_slug, 'token', v_token);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_staff_performance_link(UUID) TO authenticated;

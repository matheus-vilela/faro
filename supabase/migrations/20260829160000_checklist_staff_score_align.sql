-- Alinha get_staff_performance_public à fórmula do Ranking (Prazo/Completo/Preciso).
-- Prazo: 100 no horário ou sem prazo; 40 se atrasado.
-- Completo: % de itens feitos no envio.
-- Preciso: 100 sem devolução; 45 se needs_rework.
-- Só entram envios submitted/in_review/approved/needs_rework.

CREATE OR REPLACE FUNCTION public.get_staff_performance_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_member_name TEXT;
  v_company_name TEXT;
  v_runs JSON;
  v_prazo NUMERIC;
  v_completo NUMERIC;
  v_preciso NUMERIC;
BEGIN
  SELECT l.company_id, l.company_member_id, l.token, l.slug
  INTO v_link
  FROM public.staff_performance_links l
  WHERE l.token = p_token AND l.expires_at > NOW()
  LIMIT 1;

  IF v_link.company_member_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT m.name, c.name INTO v_member_name, v_company_name
  FROM public.company_members m
  JOIN public.companies c ON c.id = m.company_id
  WHERE m.id = v_link.company_member_id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', r.id,
      'title', cl.title,
      'submitted_at', r.submitted_at,
      'status', r.status,
      'on_time', r.on_time,
      'geofence_ok', r.geofence_ok
    ) ORDER BY r.submitted_at DESC NULLS LAST
  ), '[]'::json)
  INTO v_runs
  FROM public.checklist_runs r
  JOIN public.checklists cl ON cl.id = r.checklist_id
  WHERE r.company_member_id = v_link.company_member_id
    AND r.status IN ('submitted', 'in_review', 'approved', 'needs_rework')
    AND r.submitted_at >= (NOW() - INTERVAL '30 days');

  SELECT
    COALESCE(AVG(CASE WHEN r.on_time IS FALSE THEN 40 ELSE 100 END), 0),
    COALESCE(AVG(
      CASE
        WHEN (
          SELECT COUNT(*) FROM public.checklist_run_items cri
          WHERE cri.run_id = r.id
        ) = 0 THEN 100
        ELSE ROUND((
          (
            SELECT COUNT(*) FROM public.checklist_run_items cri
            WHERE cri.run_id = r.id AND cri.completed_at IS NOT NULL
          )::numeric
          / NULLIF((
            SELECT COUNT(*) FROM public.checklist_run_items cri
            WHERE cri.run_id = r.id
          ), 0)
        ) * 100)
      END
    ), 0),
    COALESCE(AVG(CASE WHEN r.status = 'needs_rework' THEN 45 ELSE 100 END), 0)
  INTO v_prazo, v_completo, v_preciso
  FROM public.checklist_runs r
  WHERE r.company_member_id = v_link.company_member_id
    AND r.status IN ('submitted', 'in_review', 'approved', 'needs_rework')
    AND r.submitted_at >= (NOW() - INTERVAL '30 days');

  RETURN json_build_object(
    'ok', true,
    'member_name', COALESCE(v_member_name, ''),
    'company_name', COALESCE(v_company_name, ''),
    'score', json_build_object(
      'prazo', ROUND(v_prazo)::int,
      'completo', ROUND(v_completo)::int,
      'preciso', ROUND(v_preciso)::int,
      'score', ROUND((v_prazo + v_completo + v_preciso) / 3.0)::int
    ),
    'runs', v_runs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_performance_public(UUID)
  TO anon, authenticated;

-- Checklists operacionais MVP: tipos, evidências, conferência, restrições, ranking helpers,
-- notificações, desempenho staff, templates.

-- ---------------------------------------------------------------------------
-- checklist_items: tipos + config
-- ---------------------------------------------------------------------------
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'check'
    CHECK (item_type IN (
      'check', 'numeric', 'photo', 'note', 'rating', 'signature', 'barcode'
    )),
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_evidence BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_items.item_type IS
  'Tipo do item: check, numeric, photo, note, rating, signature, barcode.';
COMMENT ON COLUMN public.checklist_items.config IS
  'Config tipada (target, hide_target, critical, min, max, unit...).';

-- ---------------------------------------------------------------------------
-- checklists: restrições de execução + deadline
-- ---------------------------------------------------------------------------
ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS enforce_item_order BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS window_start TIME,
  ADD COLUMN IF NOT EXISTS window_end TIME,
  ADD COLUMN IF NOT EXISTS deadline_time TIME,
  ADD COLUMN IF NOT EXISTS require_geofence BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geofence_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 120
    CHECK (geofence_radius_m > 0 AND geofence_radius_m <= 5000);

COMMENT ON COLUMN public.checklists.enforce_item_order IS
  'Se true, itens só podem ser concluídos na ordem sort_order.';
COMMENT ON COLUMN public.checklists.require_geofence IS
  'Bloqueia submit público fora do raio da unidade.';

-- ---------------------------------------------------------------------------
-- checklist_runs: conferência + geo + prazo
-- ---------------------------------------------------------------------------
ALTER TABLE public.checklist_runs
  DROP CONSTRAINT IF EXISTS checklist_runs_status_check;

-- Migrar submitted permanece submitted
ALTER TABLE public.checklist_runs
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS submitted_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS submitted_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS submitted_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geofence_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS on_time BOOLEAN;

ALTER TABLE public.checklist_runs
  ADD CONSTRAINT checklist_runs_status_check
  CHECK (status IN (
    'open', 'submitted', 'in_review', 'approved', 'needs_rework'
  ));

-- ---------------------------------------------------------------------------
-- checklist_run_items: valores + evidências
-- ---------------------------------------------------------------------------
ALTER TABLE public.checklist_run_items
  ADD COLUMN IF NOT EXISTS value JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_paths TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS review_flag TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

-- ---------------------------------------------------------------------------
-- Notificações WhatsApp (config por empresa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_notification_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  remind_before_minutes INTEGER NOT NULL DEFAULT 15,
  notify_on_late BOOLEAN NOT NULL DEFAULT true,
  notify_on_critical BOOLEAN NOT NULL DEFAULT true,
  notify_on_divergence BOOLEAN NOT NULL DEFAULT true,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.checklist_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users manage checklist notification settings"
  ON public.checklist_notification_settings;
CREATE POLICY "Company users manage checklist notification settings"
  ON public.checklist_notification_settings FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Tokens PWA Meu desempenho
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_performance_links (
  slug TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_member_id UUID NOT NULL REFERENCES public.company_members(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_performance_links_member_unique UNIQUE (company_member_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_performance_links_token
  ON public.staff_performance_links(token);

ALTER TABLE public.staff_performance_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company users read staff performance links"
  ON public.staff_performance_links;
CREATE POLICY "Company users read staff performance links"
  ON public.staff_performance_links FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company users manage staff performance links"
  ON public.staff_performance_links;
CREATE POLICY "Company users manage staff performance links"
  ON public.staff_performance_links FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Templates BR
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.checklist_templates IS
  'Templates globais de checklist (abertura/fechamento bar/cozinha).';

INSERT INTO public.checklist_templates (slug, title, description, sort_order, items)
VALUES
(
  'abertura-bar',
  'Abertura do bar',
  'Rotina de abertura para bar/restaurante.',
  1,
  '[
    {"title":"Conferir limpeza do balcão","item_type":"check","requires_evidence":false},
    {"title":"Temperatura da chopeira (°C)","item_type":"numeric","config":{"unit":"°C","critical":true},"requires_evidence":false},
    {"title":"Foto da frente da loja","item_type":"photo","requires_evidence":true},
    {"title":"Caixa inicial conferido","item_type":"check","requires_evidence":false},
    {"title":"Assinatura do responsável","item_type":"signature","requires_evidence":true}
  ]'::jsonb
),
(
  'fechamento-bar',
  'Fechamento do bar',
  'Rotina de fechamento operacional.',
  2,
  '[
    {"title":"Desligar equipamentos","item_type":"check"},
    {"title":"Lixo retirado","item_type":"photo","requires_evidence":true},
    {"title":"Temperatura da câmara","item_type":"numeric","config":{"unit":"°C","critical":true}},
    {"title":"Portas trancadas","item_type":"check"},
    {"title":"Observações do turno","item_type":"note"}
  ]'::jsonb
),
(
  'fechamento-cozinha',
  'Fechamento da cozinha',
  'Checklist de segurança alimentar ao fechar.',
  3,
  '[
    {"title":"Fogões e fritadeiras desligados","item_type":"check"},
    {"title":"Foto da área limpa","item_type":"photo","requires_evidence":true},
    {"title":"Temperaturas dos refrigeradores","item_type":"numeric","config":{"unit":"°C","critical":true}},
    {"title":"Itens críticos ok","item_type":"rating"}
  ]'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  items = EXCLUDED.items,
  sort_order = EXCLUDED.sort_order;

GRANT SELECT ON public.checklist_templates TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- Helper geofence (Haversine metros)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.geo_distance_meters(
  p_lat1 DOUBLE PRECISION,
  p_lng1 DOUBLE PRECISION,
  p_lat2 DOUBLE PRECISION,
  p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE (
      6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- get_checklist_run_public: incluiir tipos/config
-- ---------------------------------------------------------------------------
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
  v_completed JSON;
BEGIN
  SELECT r.id, r.checklist_id, r.status, r.submitted_at, r.company_id
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.token = p_token;

  IF v_run.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_run.status NOT IN ('open', 'needs_rework') THEN
    RETURN json_build_object(
      'ok', true,
      'run', json_build_object(
        'status', v_run.status,
        'submitted_at', v_run.submitted_at
      ),
      'error', 'already_submitted'
    );
  END IF;

  SELECT c.id, c.title, c.description, c.enforce_item_order,
         c.window_start, c.window_end, c.deadline_time,
         c.require_geofence, c.geofence_radius_m
  INTO v_checklist
  FROM public.checklists c
  WHERE c.id = v_run.checklist_id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', ci.id,
      'title', ci.title,
      'sort_order', ci.sort_order,
      'item_type', ci.item_type,
      'config', ci.config,
      'requires_evidence', ci.requires_evidence
    ) ORDER BY ci.sort_order
  ), '[]'::json)
  INTO v_items
  FROM public.checklist_items ci
  WHERE ci.checklist_id = v_run.checklist_id;

  SELECT COALESCE(json_object_agg(
    cri.checklist_item_id::text,
    json_build_object(
      'completed_at', cri.completed_at,
      'value', cri.value,
      'evidence_paths', cri.evidence_paths,
      'is_ok', cri.is_ok,
      'review_flag', cri.review_flag
    )
  ), '{}'::json)
  INTO v_completed
  FROM public.checklist_run_items cri
  WHERE cri.run_id = v_run.id;

  RETURN json_build_object(
    'ok', true,
    'run', json_build_object(
      'status', v_run.status,
      'submitted_at', v_run.submitted_at
    ),
    'checklist', json_build_object(
      'id', v_checklist.id,
      'title', v_checklist.title,
      'description', v_checklist.description,
      'enforce_item_order', v_checklist.enforce_item_order,
      'window_start', v_checklist.window_start,
      'window_end', v_checklist.window_end,
      'deadline_time', v_checklist.deadline_time,
      'require_geofence', v_checklist.require_geofence,
      'geofence_radius_m', v_checklist.geofence_radius_m
    ),
    'items', v_items,
    'item_state', v_completed,
    'item_completed', (
      SELECT COALESCE(json_object_agg(
        cri.checklist_item_id::text,
        cri.completed_at
      ), '{}'::json)
      FROM public.checklist_run_items cri
      WHERE cri.run_id = v_run.id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_checklist_run_public(UUID) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- set item com valor + ordem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_checklist_run_item_public(
  p_token UUID,
  p_checklist_item_id UUID,
  p_completed BOOLEAN,
  p_value JSONB,
  p_evidence_paths TEXT[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_item RECORD;
  v_checklist RECORD;
  v_prev_incomplete INT;
BEGIN
  SELECT r.id, r.checklist_id, r.status, r.company_id
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.token = p_token
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_run.status NOT IN ('open', 'needs_rework') THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  SELECT ci.* INTO v_item
  FROM public.checklist_items ci
  WHERE ci.id = p_checklist_item_id AND ci.checklist_id = v_run.checklist_id;

  IF v_item.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'item_not_found');
  END IF;

  SELECT c.enforce_item_order INTO v_checklist
  FROM public.checklists c WHERE c.id = v_run.checklist_id;

  IF p_completed AND COALESCE(v_checklist.enforce_item_order, false) THEN
    SELECT COUNT(*)::INT INTO v_prev_incomplete
    FROM public.checklist_items ci
    LEFT JOIN public.checklist_run_items cri
      ON cri.run_id = v_run.id AND cri.checklist_item_id = ci.id
    WHERE ci.checklist_id = v_run.checklist_id
      AND ci.sort_order < v_item.sort_order
      AND cri.completed_at IS NULL;
    IF v_prev_incomplete > 0 THEN
      RETURN json_build_object('ok', false, 'error', 'order_violation');
    END IF;
  END IF;

  IF p_completed AND v_item.requires_evidence
     AND (p_evidence_paths IS NULL OR cardinality(p_evidence_paths) = 0)
     AND v_item.item_type IN ('photo', 'signature') THEN
    RETURN json_build_object('ok', false, 'error', 'evidence_required');
  END IF;

  INSERT INTO public.checklist_run_items (
    run_id, checklist_item_id, company_id, completed_at, value, evidence_paths, is_ok
  ) VALUES (
    v_run.id,
    p_checklist_item_id,
    v_run.company_id,
    CASE WHEN p_completed THEN NOW() ELSE NULL END,
    COALESCE(p_value, '{}'::jsonb),
    COALESCE(p_evidence_paths, '{}'),
    CASE WHEN p_completed THEN true ELSE NULL END
  )
  ON CONFLICT (run_id, checklist_item_id) DO UPDATE SET
    completed_at = CASE WHEN p_completed THEN NOW() ELSE NULL END,
    value = COALESCE(p_value, public.checklist_run_items.value),
    evidence_paths = CASE
      WHEN p_evidence_paths IS NOT NULL AND cardinality(p_evidence_paths) > 0
        THEN p_evidence_paths
      ELSE public.checklist_run_items.evidence_paths
    END,
    is_ok = CASE WHEN p_completed THEN true ELSE NULL END;

  RETURN json_build_object('ok', true);
END;
$$;

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
BEGIN
  RETURN public.set_checklist_run_item_public(
    p_token, p_checklist_item_id, p_completed, '{}'::jsonb, '{}'::text[]
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_checklist_run_item_public(UUID, UUID, BOOLEAN)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_checklist_run_item_public(UUID, UUID, BOOLEAN, JSONB, TEXT[])
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit com horário + geofence (bloqueio duro)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_checklist_run_public(
  p_token UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_checklist RECORD;
  v_total INT;
  v_done INT;
  v_now_time TIME;
  v_dist DOUBLE PRECISION;
  v_on_time BOOLEAN := true;
  v_geo_ok BOOLEAN := true;
BEGIN
  SELECT r.id, r.checklist_id, r.status, r.company_id
  INTO v_run
  FROM public.checklist_runs r
  WHERE r.token = p_token
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_run.status NOT IN ('open', 'needs_rework') THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  SELECT * INTO v_checklist
  FROM public.checklists c
  WHERE c.id = v_run.checklist_id;

  v_now_time := (NOW() AT TIME ZONE 'America/Sao_Paulo')::time;

  IF v_checklist.window_start IS NOT NULL AND v_checklist.window_end IS NOT NULL THEN
    IF v_now_time < v_checklist.window_start OR v_now_time > v_checklist.window_end THEN
      RETURN json_build_object('ok', false, 'error', 'outside_window');
    END IF;
  END IF;

  IF v_checklist.deadline_time IS NOT NULL AND v_now_time > v_checklist.deadline_time THEN
    v_on_time := false;
    RETURN json_build_object('ok', false, 'error', 'outside_window');
  END IF;

  IF COALESCE(v_checklist.require_geofence, false) THEN
    IF p_lat IS NULL OR p_lng IS NULL
       OR v_checklist.geofence_lat IS NULL OR v_checklist.geofence_lng IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'geolocation_required');
    END IF;
    IF p_accuracy_m IS NOT NULL AND p_accuracy_m > 100 THEN
      RETURN json_build_object('ok', false, 'error', 'geolocation_inaccurate');
    END IF;
    v_dist := public.geo_distance_meters(
      p_lat, p_lng, v_checklist.geofence_lat, v_checklist.geofence_lng
    );
    IF v_dist IS NULL OR v_dist > COALESCE(v_checklist.geofence_radius_m, 120) THEN
      RETURN json_build_object('ok', false, 'error', 'outside_geofence');
    END IF;
    v_geo_ok := true;
  END IF;

  SELECT COUNT(*)::int INTO v_total
  FROM public.checklist_items
  WHERE checklist_id = v_run.checklist_id;

  IF v_total = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_items');
  END IF;

  SELECT COUNT(*)::int INTO v_done
  FROM public.checklist_run_items cri
  JOIN public.checklist_items ci ON ci.id = cri.checklist_item_id
  WHERE cri.run_id = v_run.id AND cri.completed_at IS NOT NULL;

  IF v_done < v_total THEN
    RETURN json_build_object('ok', false, 'error', 'incomplete', 'missing', v_total - v_done);
  END IF;

  UPDATE public.checklist_runs
  SET
    status = 'submitted',
    submitted_at = NOW(),
    submitted_lat = p_lat,
    submitted_lng = p_lng,
    submitted_accuracy_m = p_accuracy_m,
    geofence_ok = CASE WHEN COALESCE(v_checklist.require_geofence, false) THEN v_geo_ok ELSE NULL END,
    on_time = v_on_time
  WHERE id = v_run.id;

  DELETE FROM public.checklist_run_short_links WHERE run_id = v_run.id;

  RETURN json_build_object('ok', true);
END;
$$;

DROP FUNCTION IF EXISTS public.submit_checklist_run_public(UUID);

CREATE OR REPLACE FUNCTION public.submit_checklist_run_public(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.submit_checklist_run_public(p_token, NULL::double precision, NULL::double precision, NULL::double precision);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_checklist_run_public(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checklist_run_public(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência gestor
-- ---------------------------------------------------------------------------
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
    JOIN public.user_companies uc ON uc.company_id = r.company_id
    WHERE r.id = p_run_id AND uc.user_id = auth.uid()
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

-- Disparo admin: cria run + short link
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
  JOIN public.user_companies uc ON uc.company_id = c.company_id
  WHERE c.id = p_checklist_id AND uc.user_id = auth.uid();

  IF v_cl.id IS NULL THEN
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

-- ---------------------------------------------------------------------------
-- Staff performance public
-- ---------------------------------------------------------------------------
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
    COALESCE(AVG(CASE WHEN r.on_time IS TRUE THEN 100 WHEN r.on_time IS FALSE THEN 40 ELSE 70 END), 70),
    COALESCE(AVG(
      CASE WHEN (
        SELECT COUNT(*) FROM public.checklist_run_items cri
        WHERE cri.run_id = r.id AND cri.completed_at IS NOT NULL
      ) = (
        SELECT COUNT(*) FROM public.checklist_items ci WHERE ci.checklist_id = r.checklist_id
      ) THEN 100 ELSE 50 END
    ), 70),
    COALESCE(AVG(CASE WHEN r.geofence_ok IS FALSE THEN 50 WHEN r.status = 'needs_rework' THEN 45 ELSE 85 END), 80)
  INTO v_prazo, v_completo, v_preciso
  FROM public.checklist_runs r
  WHERE r.company_member_id = v_link.company_member_id
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

GRANT EXECUTE ON FUNCTION public.get_staff_performance_public(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_staff_performance_token_by_slug(p_slug TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT token FROM public.staff_performance_links
  WHERE slug = p_slug AND expires_at > NOW()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_performance_token_by_slug(TEXT)
  TO anon, authenticated;

-- Ensure staff link for member (authenticated)
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
  JOIN public.user_companies uc ON uc.company_id = m.company_id
  WHERE m.id = p_company_member_id AND uc.user_id = auth.uid();

  IF v_member.id IS NULL THEN
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

-- Limpeza runs/sessões abertos há > 14 dias
CREATE OR REPLACE FUNCTION public.cleanup_stale_operational_links()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runs INT;
  v_sess INT;
BEGIN
  DELETE FROM public.checklist_run_short_links l
  USING public.checklist_runs r
  WHERE l.run_id = r.id
    AND r.status = 'open'
    AND r.created_at < NOW() - INTERVAL '14 days';
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  DELETE FROM public.inventory_count_short_links l
  USING public.inventory_count_sessions s
  WHERE l.session_id = s.id
    AND s.status IN ('open', 'returned')
    AND s.created_at < NOW() - INTERVAL '14 days';
  GET DIAGNOSTICS v_sess = ROW_COUNT;

  RETURN json_build_object('ok', true, 'checklist_links', v_runs, 'inventory_links', v_sess);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_stale_operational_links() TO authenticated;

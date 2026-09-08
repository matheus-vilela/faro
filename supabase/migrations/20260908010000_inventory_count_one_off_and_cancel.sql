-- Lista única: listing sem grupo. Cancelar sessão no Histórico.

ALTER TABLE public.inventory_count_listings
  ALTER COLUMN inventory_count_group_id DROP NOT NULL;

COMMENT ON COLUMN public.inventory_count_listings.inventory_count_group_id IS
  'Setor da listagem. NULL = lista única (avulsa), fora dos cards de grupo.';

ALTER TABLE public.inventory_count_sessions
  DROP CONSTRAINT IF EXISTS inventory_count_sessions_status_check;

ALTER TABLE public.inventory_count_sessions
  ADD CONSTRAINT inventory_count_sessions_status_check
  CHECK (status IN (
    'open',
    'pending_approval',
    'returned',
    'approved',
    'committed',
    'cancelled'
  ));

-- Submit: não exigir grupo quando a sessão já tem listagem (lista única).
CREATE OR REPLACE FUNCTION public.submit_inventory_count_for_approval(
  p_token UUID,
  p_inventory_count_group_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_group_catalog_count INT;
  v_pending INT;
BEGIN
  SELECT s.id, s.company_id, s.status, s.inventory_count_group_id,
         s.inventory_count_listing_id, s.validate_live,
         COALESCE(s.kind, 'regular') AS kind
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.token = p_token
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned') THEN
    RETURN json_build_object('ok', false, 'error', 'already_submitted');
  END IF;

  IF v_sess.kind <> 'onboarding'
     AND v_sess.inventory_count_group_id IS NULL
     AND v_sess.inventory_count_listing_id IS NULL THEN
    SELECT COUNT(*)::INT INTO v_group_catalog_count
    FROM public.inventory_count_groups g
    WHERE g.company_id = v_sess.company_id;

    IF v_group_catalog_count > 0 THEN
      IF p_inventory_count_group_id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'group_required');
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.inventory_count_groups g
        WHERE g.id = p_inventory_count_group_id AND g.company_id = v_sess.company_id
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_group');
      END IF;
      UPDATE public.inventory_count_sessions
      SET inventory_count_group_id = p_inventory_count_group_id
      WHERE id = v_sess.id;
    END IF;
  END IF;

  SELECT COUNT(*)::INT INTO v_pending
  FROM public.inventory_count_lines l
  WHERE l.session_id = v_sess.id
    AND l.counted_qty IS NULL;

  IF v_sess.status = 'returned' THEN
    SELECT COUNT(*)::INT INTO v_pending
    FROM public.inventory_count_lines l
    WHERE l.session_id = v_sess.id
      AND l.recount_required
      AND l.counted_qty IS NULL;
  END IF;

  IF v_pending > 0 THEN
    RETURN json_build_object('ok', false, 'error', 'incomplete', 'missing', v_pending);
  END IF;

  UPDATE public.inventory_count_lines
  SET recount_required = false, returned_at = NULL, updated_at = NOW()
  WHERE session_id = v_sess.id AND recount_required;

  UPDATE public.inventory_count_sessions
  SET
    status = 'pending_approval',
    submitted_at = NOW(),
    returned_at = NULL
  WHERE id = v_sess.id;

  DELETE FROM public.inventory_count_short_links WHERE session_id = v_sess.id;

  RETURN json_build_object('ok', true, 'status', 'pending_approval');
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_inventory_count_for_approval(UUID, UUID)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_inventory_count_session(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
BEGIN
  SELECT s.id, s.company_id, s.status
  INTO v_sess
  FROM public.inventory_count_sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_sess.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.company_id = v_sess.company_id AND uc.user_id = auth.uid()
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_sess.status NOT IN ('open', 'returned', 'pending_approval') THEN
    RETURN json_build_object('ok', false, 'error', 'not_cancellable');
  END IF;

  UPDATE public.inventory_count_sessions
  SET status = 'cancelled'
  WHERE id = v_sess.id;

  DELETE FROM public.inventory_count_short_links WHERE session_id = v_sess.id;

  RETURN json_build_object('ok', true, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_inventory_count_session(UUID)
  TO authenticated;

COMMENT ON FUNCTION public.cancel_inventory_count_session(UUID) IS
  'Cancela sessão open/returned/pending_approval. Não toca committed/approved.';

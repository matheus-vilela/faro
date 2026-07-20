-- Links one-time para envio de certificado A1 por terceiros no onboarding fiscal.

CREATE TABLE IF NOT EXISTS public.setup_certificate_delegation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_setup_cert_delegation_company
  ON public.setup_certificate_delegation_links(company_id, status, created_at DESC);

COMMENT ON TABLE public.setup_certificate_delegation_links IS
  'Link one-time para terceiro enviar certificado A1 no onboarding fiscal.';

ALTER TABLE public.setup_certificate_delegation_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members read delegation links"
  ON public.setup_certificate_delegation_links FOR SELECT
  USING (
    company_id IN (
      SELECT uc.company_id FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Criar link (autenticado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_setup_certificate_delegation_link(
  p_company_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_link_id UUID;
  v_token UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid
      AND uc.company_id = p_company_id
      AND uc.role IN ('owner', 'gestor')
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.setup_certificate_delegation_links
  SET status = 'revoked'
  WHERE company_id = p_company_id
    AND status = 'active';

  INSERT INTO public.setup_certificate_delegation_links (
    company_id,
    created_by
  )
  VALUES (p_company_id, v_uid)
  RETURNING id, token INTO v_link_id, v_token;

  RETURN json_build_object(
    'ok', true,
    'link_id', v_link_id,
    'token', v_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_setup_certificate_delegation_link(UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Link ativo da empresa (autenticado, retomar wizard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_setup_certificate_delegation_link(
  p_company_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid
      AND uc.company_id = p_company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT l.id, l.token, l.status, l.expires_at
  INTO v_row
  FROM public.setup_certificate_delegation_links l
  WHERE l.company_id = p_company_id
    AND l.status = 'active'
    AND l.expires_at > NOW()
  ORDER BY l.created_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'link_id', v_row.id,
    'token', v_row.token,
    'status', v_row.status,
    'expires_at', v_row.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_setup_certificate_delegation_link(UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Carregar link público (anon)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_setup_certificate_delegation_public(
  p_token UUID
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_company_name TEXT;
BEGIN
  SELECT l.id, l.company_id, l.status, l.expires_at
  INTO v_row
  FROM public.setup_certificate_delegation_links l
  WHERE l.token = p_token;

  IF v_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status = 'used' THEN
    RETURN json_build_object('ok', false, 'error', 'used');
  END IF;

  IF v_row.status <> 'active' THEN
    RETURN json_build_object('ok', false, 'error', 'inactive');
  END IF;

  IF v_row.expires_at <= NOW() THEN
    UPDATE public.setup_certificate_delegation_links
    SET status = 'expired'
    WHERE id = v_row.id AND status = 'active';
    RETURN json_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT c.name INTO v_company_name
  FROM public.companies c
  WHERE c.id = v_row.company_id;

  RETURN json_build_object(
    'ok', true,
    'company_name', COALESCE(v_company_name, 'Unidade'),
    'company_id', v_row.company_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_setup_certificate_delegation_public(UUID)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Marcar link como usado (chamado pela edge function com service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_setup_certificate_delegation_used(
  p_token UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT l.id, l.status, l.expires_at
  INTO v_row
  FROM public.setup_certificate_delegation_links l
  WHERE l.token = p_token
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.status = 'used' THEN
    RETURN json_build_object('ok', false, 'error', 'used');
  END IF;

  IF v_row.status <> 'active' OR v_row.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'inactive');
  END IF;

  UPDATE public.setup_certificate_delegation_links
  SET status = 'used', used_at = NOW()
  WHERE id = v_row.id;

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_setup_certificate_delegation_used(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_setup_certificate_delegation_used(UUID)
  TO service_role;

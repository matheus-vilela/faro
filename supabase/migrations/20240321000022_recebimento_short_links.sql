-- Links curtos com slug (redirect para confirmação de recebimento)

CREATE TABLE IF NOT EXISTS public.recebimento_short_links (
  slug TEXT PRIMARY KEY NOT NULL,
  recebimento_id UUID NOT NULL REFERENCES public.recebimentos(id) ON DELETE CASCADE,
  token UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT recebimento_short_links_one_per_recebimento UNIQUE (recebimento_id)
);

CREATE INDEX IF NOT EXISTS idx_recebimento_short_links_recebimento_id
  ON public.recebimento_short_links(recebimento_id);

COMMENT ON TABLE public.recebimento_short_links IS
  'Slug curto (ex.: /s/abc12xyz) → token do recebimento; leitura só via RPC pública.';

ALTER TABLE public.recebimento_short_links ENABLE ROW LEVEL SECURITY;

-- Sem políticas: anon/authenticated não leem a tabela diretamente (apenas RPC SECURITY DEFINER).

-- Resolve slug → token (página pública de redirect)
CREATE OR REPLACE FUNCTION public.get_recebimento_token_by_short_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT token
  FROM public.recebimento_short_links
  WHERE slug = lower(trim(p_slug));
$$;

GRANT EXECUTE ON FUNCTION public.get_recebimento_token_by_short_slug(text) TO anon, authenticated;

-- Cria ou reutiliza slug para um recebimento (usuário logado com acesso à empresa)
CREATE OR REPLACE FUNCTION public.ensure_recebimento_short_slug(p_recebimento_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  r_token uuid;
  v_attempt int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.recebimentos r
    JOIN public.expenses e ON e.id = r.expense_id
    WHERE r.id = p_recebimento_id
      AND e.company_id IN (
        SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
      )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT l.slug INTO v_slug
  FROM public.recebimento_short_links l
  WHERE l.recebimento_id = p_recebimento_id;

  IF v_slug IS NOT NULL THEN
    RETURN v_slug;
  END IF;

  SELECT r.token INTO r_token FROM public.recebimentos r WHERE r.id = p_recebimento_id;
  IF r_token IS NULL THEN
    RAISE EXCEPTION 'recebimento not found';
  END IF;

  WHILE v_attempt < 25 LOOP
    v_attempt := v_attempt + 1;
    v_slug := lower(substring(
      md5(random()::text || clock_timestamp()::text || random()::text || v_attempt::text)
      FROM 1 FOR 8
    ));
    BEGIN
      INSERT INTO public.recebimento_short_links (slug, recebimento_id, token)
      VALUES (v_slug, p_recebimento_id, r_token);
      RETURN v_slug;
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RAISE EXCEPTION 'could not allocate slug';
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_recebimento_short_slug(uuid) TO authenticated;

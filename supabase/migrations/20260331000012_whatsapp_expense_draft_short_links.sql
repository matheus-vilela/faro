-- Links curtos com slug para rascunho de despesa WhatsApp (ex.: /e/abc12xyz → /w/:token)

CREATE TABLE IF NOT EXISTS public.whatsapp_expense_draft_short_links (
  slug TEXT PRIMARY KEY NOT NULL,
  draft_id UUID NOT NULL REFERENCES public.whatsapp_expense_drafts(id) ON DELETE CASCADE,
  access_token UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT whatsapp_expense_draft_short_links_one_per_draft UNIQUE (draft_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_expense_draft_short_links_draft_id
  ON public.whatsapp_expense_draft_short_links(draft_id);

COMMENT ON TABLE public.whatsapp_expense_draft_short_links IS
  'Slug curto (ex.: /e/abc12xyz) → access_token do rascunho; leitura só via RPC pública.';

ALTER TABLE public.whatsapp_expense_draft_short_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_whatsapp_expense_draft_token_by_short_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT access_token
  FROM public.whatsapp_expense_draft_short_links
  WHERE slug = lower(trim(p_slug));
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_expense_draft_token_by_short_slug(text) TO anon, authenticated;

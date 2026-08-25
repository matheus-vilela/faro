-- Snapshot de correlação PDV (vendido) × nota (comprado) para revisão com IA.
-- Prompt usa ids curtos (s1, p1); UUIDs ficam nas nodes. Nada se aplica sem o usuário confirmar.

CREATE TABLE IF NOT EXISTS public.product_match_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  model TEXT,
  error TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS product_match_runs_company_created_idx
  ON public.product_match_runs (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_match_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.product_match_runs (id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('sold', 'purchased')),
  prompt_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'un',
  quantity NUMERIC NOT NULL DEFAULT 0,
  recipe_id UUID,
  UNIQUE (run_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS product_match_nodes_run_side_idx
  ON public.product_match_nodes (run_id, side);

CREATE TABLE IF NOT EXISTS public.product_match_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.product_match_runs (id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  sold_node_id UUID NOT NULL REFERENCES public.product_match_nodes (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('same_item', 'recipe', 'unmatched')),
  confidence NUMERIC NOT NULL,
  reason_pt TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  UNIQUE (run_id, sold_node_id)
);

CREATE INDEX IF NOT EXISTS product_match_proposals_run_kind_idx
  ON public.product_match_proposals (run_id, kind);

CREATE TABLE IF NOT EXISTS public.product_match_proposal_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.product_match_proposals (id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  purchased_node_id UUID NOT NULL REFERENCES public.product_match_nodes (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('same_item', 'ingredient')),
  rank INT NOT NULL DEFAULT 1,
  confidence NUMERIC,
  hint_label TEXT
);

CREATE INDEX IF NOT EXISTS product_match_proposal_links_proposal_idx
  ON public.product_match_proposal_links (proposal_id, rank);

COMMENT ON TABLE public.product_match_runs IS
  'Execução de correlação IA: universo vendido (PDV) × comprado (NF-e) congelado para o usuário confirmar.';
COMMENT ON TABLE public.product_match_nodes IS
  'Itens do snapshot com prompt_id curto para o modelo não inventar UUID.';
COMMENT ON TABLE public.product_match_proposals IS
  'Uma proposta por item vendido (mesmo item, ficha ou sem par). Confirmação é sempre humana.';

ALTER TABLE public.product_match_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_match_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_match_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_match_proposal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_match_runs_company ON public.product_match_runs FOR ALL
  USING (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()));

CREATE POLICY product_match_nodes_company ON public.product_match_nodes FOR ALL
  USING (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()));

CREATE POLICY product_match_proposals_company ON public.product_match_proposals FOR ALL
  USING (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()));

CREATE POLICY product_match_proposal_links_company ON public.product_match_proposal_links FOR ALL
  USING (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT uc.company_id FROM public.user_companies uc WHERE uc.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_match_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_match_nodes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_match_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_match_proposal_links TO authenticated;
GRANT ALL ON public.product_match_runs TO service_role;
GRANT ALL ON public.product_match_nodes TO service_role;
GRANT ALL ON public.product_match_proposals TO service_role;
GRANT ALL ON public.product_match_proposal_links TO service_role;

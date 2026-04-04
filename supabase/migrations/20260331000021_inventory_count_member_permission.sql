-- Permissão por membro para solicitar contagem de inventário pelo WhatsApp.
-- Rastreio de quem gerou sessão pelo painel (perfil logado).

ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS can_inventory_count BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_members.can_inventory_count IS
  'Se true, o membro pode usar *estoque* / *inventario* no WhatsApp para gerar link de contagem.';

ALTER TABLE public.inventory_count_sessions
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_count_sessions.created_by_user_id IS
  'Usuário do app (perfil) que gerou o link na área logada; WhatsApp usa company_member_id ou null (proprietário).';

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_company_submitted
  ON public.inventory_count_sessions(company_id, submitted_at DESC NULLS LAST)
  WHERE status = 'submitted';

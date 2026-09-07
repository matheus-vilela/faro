-- Sessão WhatsApp: qual unidade o remetente escolheu quando o número
-- está em mais de uma empresa. Chave = telefone (não company_id), senão
-- não dá para perguntar a loja.

CREATE TABLE IF NOT EXISTS public.whatsapp_company_context (
  sender_phone_normalized TEXT PRIMARY KEY,
  selected_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  selected_at TIMESTAMPTZ,
  pending_company_ids UUID[] NOT NULL DEFAULT '{}',
  pending_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.whatsapp_company_context IS
  'Unidade escolhida no WhatsApp quando o remetente pertence a mais de uma empresa. TTL da sessão no webhook.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_company_context_selected
  ON public.whatsapp_company_context (selected_company_id)
  WHERE selected_company_id IS NOT NULL;

ALTER TABLE public.whatsapp_company_context ENABLE ROW LEVEL SECURITY;

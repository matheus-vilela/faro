-- Rascunhos de despesa via WhatsApp (divergência total vs soma dos itens — aguardando confirmação)

CREATE TABLE IF NOT EXISTS public.whatsapp_expense_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sender_phone_normalized TEXT NOT NULL,
  extracted_json JSONB NOT NULL,
  sum_items NUMERIC NOT NULL,
  total_document NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours')
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_expense_drafts_sender_company
  ON public.whatsapp_expense_drafts(company_id, sender_phone_normalized, created_at DESC);

COMMENT ON TABLE public.whatsapp_expense_drafts IS
  'Último rascunho pendente: total da nota vs soma dos itens divergentes; usuário confirma estratégia ou cancela.';

ALTER TABLE public.whatsapp_expense_drafts ENABLE ROW LEVEL SECURITY;

-- Estado do menu de recebimentos enviado por WhatsApp (opção numérica → link)

CREATE TABLE IF NOT EXISTS public.whatsapp_recebimento_menu (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sender_phone_normalized TEXT NOT NULL,
  recebimento_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_recebimento_menu_sender_company
  ON public.whatsapp_recebimento_menu(sender_phone_normalized, company_id, created_at DESC);

COMMENT ON TABLE public.whatsapp_recebimento_menu IS
  'Último menu de recebimentos (ordem das opções) para responder com número e obter o link.';

ALTER TABLE public.whatsapp_recebimento_menu ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS notification JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.companies.notification IS
  'Preferências de notificação WhatsApp: [{ "number": "5511...", "rules": ["bill_due_alerts", "weekly_summary"] }].';

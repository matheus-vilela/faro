-- Garante que anon continua podendo chamar as RPCs após CREATE OR REPLACE nas migrações anteriores.

GRANT EXECUTE ON FUNCTION public.get_whatsapp_expense_draft_by_token(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_expense_draft(UUID, JSONB) TO anon, authenticated;

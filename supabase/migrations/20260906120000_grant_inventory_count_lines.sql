-- A aba Aprovar lê inventory_count_lines direto no client; faltava GRANT
-- (grupos/listagens já tinham). Sem isso o Conferir falha em silêncio.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_lines TO authenticated;
GRANT ALL ON public.inventory_count_lines TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_sessions TO authenticated;
GRANT ALL ON public.inventory_count_sessions TO service_role;

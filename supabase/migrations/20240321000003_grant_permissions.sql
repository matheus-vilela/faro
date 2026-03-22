-- Permissões para as roles anon e authenticated acessarem as tabelas
-- Necessário para que o PostgREST aceite as requisições antes de avaliar RLS

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT ALL ON public.profiles TO anon, authenticated;
GRANT ALL ON public.companies TO anon, authenticated;
GRANT ALL ON public.user_companies TO anon, authenticated;

-- Permitir que authenticated use a sequência de IDs (se houver)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

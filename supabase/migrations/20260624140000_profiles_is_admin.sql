-- Flag global de administrador da plataforma (Faro).
-- Só pode ser alterada manualmente no SQL Editor do Supabase (role postgres).
-- Clientes (authenticated / service_role via API) não conseguem ler nem gravar esta coluna.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_admin IS
  'Administrador global Faro. Default false. Alterar apenas via SQL Editor (postgres); bloqueado para API.';

UPDATE public.profiles
SET is_admin = false
WHERE is_admin IS DISTINCT FROM false;

CREATE OR REPLACE FUNCTION public.profiles_guard_is_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Chamadas via PostgREST / Supabase client incluem claim role no JWT.
  IF current_setting('request.jwt.claim.role', true) IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_admin := false;
    ELSIF TG_OP = 'UPDATE' AND NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      NEW.is_admin := OLD.is_admin;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_is_admin ON public.profiles;
CREATE TRIGGER profiles_guard_is_admin
  BEFORE INSERT OR UPDATE OF is_admin ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.profiles_guard_is_admin();

REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated, anon, service_role;
REVOKE INSERT (is_admin) ON public.profiles FROM authenticated, anon, service_role;

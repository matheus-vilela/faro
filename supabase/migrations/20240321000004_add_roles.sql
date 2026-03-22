-- Roles: operador, gestor, owner
-- operador: captura NFs, registra despesas, confirma recebimento
-- gestor: aprova despesas, alertas, DRE/relatórios
-- owner: proprietário da empresa (como gestor + admin)

-- Atualizar roles existentes: 'member' -> 'gestor', manter 'owner'
UPDATE public.user_companies SET role = 'gestor' WHERE role = 'member';
UPDATE public.user_companies SET role = 'gestor' WHERE role IS NULL;

-- Constraint para roles válidos
ALTER TABLE public.user_companies
  DROP CONSTRAINT IF EXISTS user_companies_role_check;
ALTER TABLE public.user_companies
  ADD CONSTRAINT user_companies_role_check
  CHECK (role IN ('operador', 'gestor', 'owner'));

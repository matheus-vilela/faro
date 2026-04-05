-- Grupos de empresas (unidades). Cada empresa pertence a um grupo; o dono do grupo
-- é o mesmo usuário que era dono da empresa (user_companies.role = owner).

CREATE TABLE IF NOT EXISTS public.company_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.company_groups IS
  'Agrupa empresas/unidades; apenas owner_user_id pode renomear o grupo e gerenciar unidades.';

CREATE INDEX IF NOT EXISTS idx_company_groups_owner
  ON public.company_groups(owner_user_id);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.company_groups(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_companies_group_id ON public.companies(group_id);

-- Empresas sem user_companies impedem backfill
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.companies c
  WHERE NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.company_id = c.id);
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'company_groups migration: existem % empresas sem nenhum vínculo em user_companies.', orphan_count;
  END IF;
END $$;

-- Backfill: um grupo "Default" por empresa existente, dono = primeiro owner (ou primeiro vínculo)
CREATE TEMP TABLE _company_group_backfill AS
SELECT
  c.id AS company_id,
  gen_random_uuid() AS new_group_id,
  sub.user_id AS owner_user_id
FROM public.companies c
INNER JOIN LATERAL (
  SELECT uc.user_id
  FROM public.user_companies uc
  WHERE uc.company_id = c.id
  ORDER BY CASE WHEN uc.role = 'owner' THEN 0 ELSE 1 END, uc.created_at
  LIMIT 1
) sub ON TRUE;

INSERT INTO public.company_groups (id, name, owner_user_id)
SELECT new_group_id, 'Default', owner_user_id
FROM _company_group_backfill;

UPDATE public.companies c
SET group_id = b.new_group_id
FROM _company_group_backfill b
WHERE c.id = b.company_id;

ALTER TABLE public.companies
  ALTER COLUMN group_id SET NOT NULL;

DROP TRIGGER IF EXISTS tr_company_groups_updated_at ON public.company_groups;
CREATE TRIGGER tr_company_groups_updated_at
  BEFORE UPDATE ON public.company_groups
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- Apenas o dono do grupo pode alterar group_id da empresa (mover unidade entre grupos)
CREATE OR REPLACE FUNCTION public.companies_guard_group_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.group_id IS DISTINCT FROM NEW.group_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_groups g
      WHERE g.id = OLD.group_id AND g.owner_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Apenas o dono do grupo pode alterar a unidade de grupo.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.company_groups g
      WHERE g.id = NEW.group_id AND g.owner_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Apenas o dono do grupo pode vincular a unidade a este grupo.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_guard_group_change ON public.companies;
CREATE TRIGGER tr_companies_guard_group_change
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.companies_guard_group_change();

ALTER TABLE public.company_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view groups for their companies"
  ON public.company_groups FOR SELECT
  USING (
    id IN (
      SELECT c.group_id
      FROM public.companies c
      INNER JOIN public.user_companies uc ON uc.company_id = c.id
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create groups as themselves as owner"
  ON public.company_groups FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Group owners can update their groups"
  ON public.company_groups FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Group owners can delete empty groups"
  ON public.company_groups FOR DELETE
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can create companies" ON public.companies;

CREATE POLICY "Group owners can insert companies"
  ON public.companies FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT id FROM public.company_groups WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Group owners can delete companies in their groups"
  ON public.companies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_groups g
      WHERE g.id = companies.group_id AND g.owner_user_id = auth.uid()
    )
  );

GRANT ALL ON public.company_groups TO anon, authenticated;

-- Telefones WhatsApp por empresa: proprietário + até 3 membros ativos.
-- A linha Z-API (connectedPhone) é a mesma para toda a plataforma; a empresa é
-- resolvida no webhook apenas pelo telefone do remetente (owner ou membro ativo).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS owner_whatsapp_normalized TEXT,
  ADD COLUMN IF NOT EXISTS owner_whatsapp_display TEXT;

COMMENT ON COLUMN public.companies.owner_whatsapp_normalized IS 'E.164 digits-only (ex: 5511999998888).';
COMMENT ON COLUMN public.companies.owner_whatsapp_display IS 'Formato exibido na UI; opcional.';

CREATE INDEX IF NOT EXISTS idx_companies_owner_whatsapp
  ON public.companies (owner_whatsapp_normalized)
  WHERE owner_whatsapp_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  phone_display TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_members_name_not_empty CHECK (btrim(name) <> ''),
  CONSTRAINT company_members_phone_len CHECK (
    char_length(phone_normalized) >= 10 AND char_length(phone_normalized) <= 15
  )
);

COMMENT ON TABLE public.company_members IS 'Membros adicionais com telefone autorizado (máx. 3 ativos por empresa).';

CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members (company_id);
CREATE INDEX IF NOT EXISTS idx_company_members_phone_lookup
  ON public.company_members (company_id, phone_normalized)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members_active_phone
  ON public.company_members (company_id, phone_normalized)
  WHERE is_active = true;

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_company_members_updated_at ON public.company_members;
CREATE TRIGGER tr_company_members_updated_at
  BEFORE UPDATE ON public.company_members
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_max_three_active_company_members()
RETURNS TRIGGER AS $$
DECLARE
  active_count int;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO active_count
  FROM public.company_members
  WHERE company_id = NEW.company_id
    AND is_active = true
    AND id IS DISTINCT FROM NEW.id;

  IF active_count >= 3 THEN
    RAISE EXCEPTION 'Limite de 3 membros ativos por empresa atingido.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_company_members_max_three ON public.company_members;
CREATE TRIGGER tr_company_members_max_three
  BEFORE INSERT OR UPDATE ON public.company_members
  FOR EACH ROW EXECUTE PROCEDURE public.enforce_max_three_active_company_members();

CREATE OR REPLACE FUNCTION public.enforce_member_phone_not_owner_phone()
RETURNS TRIGGER AS $$
DECLARE
  owner_phone text;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT c.owner_whatsapp_normalized INTO owner_phone
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF owner_phone IS NOT NULL AND NEW.phone_normalized = owner_phone THEN
    RAISE EXCEPTION 'Telefone já pertence ao proprietário da empresa.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_company_members_not_owner_phone ON public.company_members;
CREATE TRIGGER tr_company_members_not_owner_phone
  BEFORE INSERT OR UPDATE ON public.company_members
  FOR EACH ROW EXECUTE PROCEDURE public.enforce_member_phone_not_owner_phone();

CREATE OR REPLACE FUNCTION public.enforce_owner_phone_not_member_phone()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_whatsapp_normalized IS NOT DISTINCT FROM OLD.owner_whatsapp_normalized THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_whatsapp_normalized IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = NEW.id
      AND cm.is_active
      AND cm.phone_normalized = NEW.owner_whatsapp_normalized
  ) THEN
    RAISE EXCEPTION 'Telefone já pertence a um membro ativo.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_companies_owner_phone_unique ON public.companies;
CREATE TRIGGER tr_companies_owner_phone_unique
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE PROCEDURE public.enforce_owner_phone_not_member_phone();

CREATE OR REPLACE FUNCTION public.enforce_owner_only_company_whatsapp_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.owner_whatsapp_normalized IS DISTINCT FROM OLD.owner_whatsapp_normalized
    OR NEW.owner_whatsapp_display IS DISTINCT FROM OLD.owner_whatsapp_display
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = NEW.id
        AND uc.user_id = auth.uid()
        AND uc.role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Apenas o proprietário pode alterar os telefones WhatsApp da empresa.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_companies_owner_only_whatsapp ON public.companies;
CREATE TRIGGER tr_companies_owner_only_whatsapp
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE PROCEDURE public.enforce_owner_only_company_whatsapp_columns();

CREATE POLICY "company_members_select_participants"
  ON public.company_members FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "company_members_insert_owner"
  ON public.company_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_members.company_id
        AND uc.user_id = auth.uid()
        AND uc.role = 'owner'
    )
  );

CREATE POLICY "company_members_update_owner"
  ON public.company_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_members.company_id
        AND uc.user_id = auth.uid()
        AND uc.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_members.company_id
        AND uc.user_id = auth.uid()
        AND uc.role = 'owner'
    )
  );

CREATE POLICY "company_members_delete_owner"
  ON public.company_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.company_id = company_members.company_id
        AND uc.user_id = auth.uid()
        AND uc.role = 'owner'
    )
  );

GRANT ALL ON public.company_members TO anon, authenticated;

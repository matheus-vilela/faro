-- Contas a pagar passam a referenciar categorias personalizadas da empresa.
ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS company_category_id UUID REFERENCES public.company_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_boletos_company_category_id
  ON public.boletos (company_id, company_category_id)
  WHERE company_category_id IS NOT NULL;

COMMENT ON COLUMN public.boletos.company_category_id IS
  'Categoria ou subcategoria (company_categories) definida pelo cliente.';

-- Remove o CHECK fixo de category; valor legado permanece opcional para linhas antigas.
ALTER TABLE public.boletos DROP CONSTRAINT IF EXISTS boletos_category_check;

ALTER TABLE public.boletos ALTER COLUMN category DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.boletos_company_category_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_categories cc
      WHERE cc.id = NEW.company_category_id AND cc.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'A categoria deve pertencer à mesma empresa do boleto';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_boletos_company_category_match ON public.boletos;
CREATE TRIGGER tr_boletos_company_category_match
  BEFORE INSERT OR UPDATE OF company_category_id, company_id ON public.boletos
  FOR EACH ROW
  EXECUTE PROCEDURE public.boletos_company_category_company_match();

-- Encaixa boletos existentes nas categorias raiz pelo nome (mesmo padrão do backfill).
UPDATE public.boletos b
SET company_category_id = cc.id
FROM public.company_categories cc
WHERE cc.company_id = b.company_id
  AND cc.parent_id IS NULL
  AND b.company_category_id IS NULL
  AND lower(btrim(cc.name)) = CASE b.category
    WHEN 'insumos' THEN 'insumos'
    WHEN 'custo_fixo' THEN 'custo fixo'
    WHEN 'estabelecimento' THEN 'estabelecimento'
    WHEN 'outros' THEN 'outros'
    WHEN 'fornecedores' THEN 'fornecedores'
    ELSE ''
  END;

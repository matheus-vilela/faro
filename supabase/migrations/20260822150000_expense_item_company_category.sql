-- Categoria financeira por item da nota + memória no cadastro do produto.
-- O DRE/orçamento rateiam o valor do boleto pelos pesos das linhas (cálculo na leitura).

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS company_category_id UUID
    REFERENCES public.company_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_items_company_category_id
  ON public.expense_items (company_id, company_category_id)
  WHERE company_category_id IS NOT NULL;

COMMENT ON COLUMN public.expense_items.company_category_id IS
  'Categoria financeira (company_categories) desta linha da nota; independente da categoria da conta.';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_expense_category_id UUID
    REFERENCES public.company_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_default_expense_category_id
  ON public.products (company_id, default_expense_category_id)
  WHERE default_expense_category_id IS NOT NULL;

COMMENT ON COLUMN public.products.default_expense_category_id IS
  'Última categoria financeira de compra confirmada neste produto; pré-preenche novas linhas de NF.';

CREATE OR REPLACE FUNCTION public.expense_items_company_category_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_categories cc
      WHERE cc.id = NEW.company_category_id AND cc.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'A categoria do item deve pertencer à mesma empresa';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_expense_items_company_category_match ON public.expense_items;
CREATE TRIGGER tr_expense_items_company_category_match
  BEFORE INSERT OR UPDATE OF company_category_id, company_id ON public.expense_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.expense_items_company_category_company_match();

CREATE OR REPLACE FUNCTION public.products_default_expense_category_company_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.default_expense_category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_categories cc
      WHERE cc.id = NEW.default_expense_category_id AND cc.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'A categoria padrão do produto deve pertencer à mesma empresa';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_products_default_expense_category_match ON public.products;
CREATE TRIGGER tr_products_default_expense_category_match
  BEFORE INSERT OR UPDATE OF default_expense_category_id, company_id ON public.products
  FOR EACH ROW
  EXECUTE PROCEDURE public.products_default_expense_category_company_match();

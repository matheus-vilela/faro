-- Ao excluir uma empresa, o CASCADE apaga company_categories; o trigger
-- company_categories_prevent_delete_default bloqueava categorias padrao_sistema.
-- Sinal em sessão (transação-local) definida no BEFORE DELETE de companies.

CREATE OR REPLACE FUNCTION public.companies_before_delete_set_category_cascade()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.company_delete_cascade', 'true', true);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_before_delete_category_cascade ON public.companies;
CREATE TRIGGER tr_companies_before_delete_category_cascade
  BEFORE DELETE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.companies_before_delete_set_category_cascade();

CREATE OR REPLACE FUNCTION public.company_categories_prevent_delete_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.company_delete_cascade', true), '') = 'true' THEN
    RETURN OLD;
  END IF;

  IF COALESCE(OLD.padrao_sistema, false) THEN
    RAISE EXCEPTION 'Categoria padrão não pode ser excluída fisicamente. Use ativo = false.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.boletos b WHERE b.company_category_id = OLD.id) THEN
    RAISE EXCEPTION 'Categoria em uso por lançamentos. Arquive (ativo = false).';
  END IF;

  RETURN OLD;
END;
$$;

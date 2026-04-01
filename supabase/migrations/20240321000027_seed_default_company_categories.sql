-- Ao criar uma empresa, cria categorias padrão (idênticas às classificações já usadas em boletos).
CREATE OR REPLACE FUNCTION public.seed_default_company_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_categories (company_id, parent_id, name, sort_order)
  VALUES
    (NEW.id, NULL, 'Insumos', 0),
    (NEW.id, NULL, 'Custo Fixo', 1),
    (NEW.id, NULL, 'Estabelecimento', 2),
    (NEW.id, NULL, 'Outros', 3);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_default_company_categories() IS
  'Insere as quatro categorias iniciais por empresa. SECURITY DEFINER: roda logo após INSERT em companies, antes do vínculo em user_companies.';

DROP TRIGGER IF EXISTS tr_companies_seed_default_categories ON public.companies;
CREATE TRIGGER tr_companies_seed_default_categories
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.seed_default_company_categories();

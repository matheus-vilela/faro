-- Empresas criadas antes do trigger de categorias padrão: insere só o que ainda não existe.
-- Idempotente: pode rodar mais de uma vez sem duplicar (mesmo nome na raiz, ignorando maiúsculas/minúsculas).
--
-- APÓS 20240321000032: colunas `natureza`/`tipo` são obrigatórias; o plano padrão vem de
-- `seed_financial_categories_v3`. Este INSERT legado não deve rodar nesse schema (evita 23502).
-- Em bancos que só têm o schema antigo (antes da 32), o backfill continua válido.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_categories'
      AND column_name = 'natureza'
  ) THEN
    INSERT INTO public.company_categories (company_id, parent_id, name, sort_order)
    SELECT c.id, NULL, v.name, v.sort_order
    FROM public.companies c
    CROSS JOIN (
      VALUES
        ('Insumos', 0),
        ('Custo Fixo', 1),
        ('Estabelecimento', 2),
        ('Outros', 3)
    ) AS v(name, sort_order)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.company_categories cc
      WHERE cc.company_id = c.id
        AND cc.parent_id IS NULL
        AND lower(btrim(cc.name)) = lower(btrim(v.name))
    );
  END IF;
END $$;

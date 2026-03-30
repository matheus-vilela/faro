-- Categoria da conta a pagar (insumos/fornecedores vs custo fixo/estabelecimento)
ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'outros'
CHECK (
  category IN (
    'insumos',
    'fornecedores',
    'custo_fixo',
    'estabelecimento',
    'outros'
  )
);

COMMENT ON COLUMN public.boletos.category IS
  'insumos: matéria-prima; fornecedores: compras NF; custo_fixo: energia, água, aluguel; estabelecimento: despesas da operação; outros.';

-- Produtos e controle de estoque
CREATE TABLE IF NOT EXISTS public.products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT DEFAULT 'un' NOT NULL,
  min_quantity DECIMAL(12, 4) DEFAULT 0 NOT NULL,
  current_quantity DECIMAL(12, 4) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Movimentações de estoque (histórico)
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  quantity DECIMAL(12, 4) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjustment')),
  reference_type TEXT,
  reference_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Adicionar product_id e stock_added em expense_items
ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_added BOOLEAN DEFAULT FALSE NOT NULL;

-- RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their company products"
  ON public.products FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage stock movements"
  ON public.stock_movements FOR ALL
  USING (
    product_id IN (
      SELECT id FROM public.products
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    product_id IN (
      SELECT id FROM public.products
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_products_company ON public.products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(company_id, name);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id);

-- Função para ajustar estoque (usada ao vincular/desvincular itens)
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id UUID,
  p_delta DECIMAL,
  p_type TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products SET
    current_quantity = GREATEST(0, current_quantity + p_delta),
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (product_id, quantity, type, reference_type, reference_id)
  VALUES (p_product_id, ABS(p_delta), CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END, p_reference_type, p_reference_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID) TO anon, authenticated;

GRANT ALL ON public.products TO anon, authenticated;
GRANT ALL ON public.stock_movements TO anon, authenticated;

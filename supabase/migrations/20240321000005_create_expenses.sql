-- Despesas (compras, notas fiscais, romaneios, recibos)
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('nota_fiscal', 'romaneio', 'recibo')),
  -- Campos específicos para nota fiscal
  invoice_number TEXT,
  supplier_document TEXT,
  supplier_name TEXT,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Itens da despesa (produto, quantidade, valor unitário)
CREATE TABLE IF NOT EXISTS public.expense_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE NOT NULL,
  product_name TEXT NOT NULL,
  quantity DECIMAL(12, 4) NOT NULL,
  unit_value DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Boletos (faturas a pagar) - expense_id vincula à despesa
CREATE TABLE IF NOT EXISTS public.boletos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  barcode TEXT,
  provider TEXT,
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boletos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their company expenses"
  ON public.expenses FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can manage expense items"
  ON public.expense_items FOR ALL
  USING (
    expense_id IN (
      SELECT id FROM public.expenses
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    expense_id IN (
      SELECT id FROM public.expenses
      WHERE company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can manage their company boletos"
  ON public.boletos FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.expenses TO anon, authenticated;
GRANT ALL ON public.expense_items TO anon, authenticated;
GRANT ALL ON public.boletos TO anon, authenticated;

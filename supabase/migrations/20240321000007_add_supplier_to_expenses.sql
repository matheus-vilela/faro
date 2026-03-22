-- Adicionar supplier_id em expenses
ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

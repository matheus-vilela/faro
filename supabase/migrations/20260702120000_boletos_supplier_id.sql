ALTER TABLE public.boletos
  ADD COLUMN IF NOT EXISTS supplier_id UUID
  REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS boletos_supplier_id_idx
  ON public.boletos (supplier_id)
  WHERE supplier_id IS NOT NULL;

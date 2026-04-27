-- Contato comercial: vendedor, WhatsApp e gerente (dados do fornecedor).

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS sales_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS sales_whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS commercial_manager TEXT;

COMMENT ON COLUMN public.suppliers.sales_contact_name IS 'Nome do vendedor ou contato comercial.';
COMMENT ON COLUMN public.suppliers.sales_whatsapp IS 'WhatsApp do contato comercial (apenas dígitos ou texto livre na UI).';
COMMENT ON COLUMN public.suppliers.commercial_manager IS 'Gerente comercial.';

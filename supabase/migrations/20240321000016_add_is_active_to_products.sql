-- Ativar/desativar produtos (itens inativos não aparecem em selects de vínculo)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

COMMENT ON COLUMN public.products.is_active IS 'Se false, produto desativado e oculto em selects de vínculo';

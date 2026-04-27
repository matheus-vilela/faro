-- Ajusta limiar padrão e registros existentes para auto vínculo em score >= 80.
ALTER TABLE public.company_product_import_settings
  ALTER COLUMN auto_match_min_score SET DEFAULT 80;

UPDATE public.company_product_import_settings
SET auto_match_min_score = 80,
    confirm_min_score = LEAST(confirm_min_score, 80),
    updated_at = NOW();

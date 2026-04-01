-- Papel da receita operacional na DRE: vendas brutas vs. deduções da receita (contra-receita).
-- NULL ou 'BRUTA' = linha de vendas brutas; 'DEDUCAO' = deduções da receita (valores exibidos como redução).

ALTER TABLE public.company_categories
  ADD COLUMN IF NOT EXISTS papel_receita_dre TEXT
    CHECK (papel_receita_dre IS NULL OR papel_receita_dre IN ('BRUTA', 'DEDUCAO'));

COMMENT ON COLUMN public.company_categories.papel_receita_dre IS
  'Somente para natureza RECEITA e tipo OPERACIONAL. NULL/BRUTA: vendas brutas; DEDUCAO: deduções da receita.';

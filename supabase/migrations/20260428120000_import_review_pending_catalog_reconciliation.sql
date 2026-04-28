-- Permite pendências agregadas de reconciliação de catálogo pós-import.

ALTER TABLE public.import_review_pending
  DROP CONSTRAINT IF EXISTS import_review_pending_kind_check;

ALTER TABLE public.import_review_pending
  ADD CONSTRAINT import_review_pending_kind_check
  CHECK (kind IN (
    'missing_conversion',
    'missing_category',
    'unit_conflict',
    'possible_duplicate',
    'missing_product_match',
    'catalog_reconciliation'
  ));

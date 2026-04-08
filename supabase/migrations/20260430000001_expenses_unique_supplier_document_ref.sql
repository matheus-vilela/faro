-- Chave de fornecedor para deduplicação: cadastro (supplier_id) ou CNPJ/CPF com 11+ dígitos.
CREATE OR REPLACE FUNCTION public.expense_supplier_dedup_key(
  p_supplier_id uuid,
  p_supplier_document text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_supplier_id IS NOT NULL THEN 's:' || p_supplier_id::text
    WHEN length(regexp_replace(COALESCE(p_supplier_document, ''), '\D', '', 'g')) >= 11 THEN
      'd:' || regexp_replace(COALESCE(p_supplier_document, ''), '\D', '', 'g')
    ELSE NULL
  END;
$$;

-- Número da NF + série (ou só referência em romaneio/recibo — série vazia).
CREATE OR REPLACE FUNCTION public.expense_document_dedup_key(
  p_invoice_number text,
  p_invoice_series text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(btrim(COALESCE(p_invoice_number, ''))) || '|' || lower(btrim(COALESCE(p_invoice_series, '')));
$$;

COMMENT ON FUNCTION public.expense_supplier_dedup_key IS
  'Identifica fornecedor para evitar NF/documento duplicado (supplier_id ou CNPJ/CPF).';

COMMENT ON FUNCTION public.expense_document_dedup_key IS
  'Identifica o documento fiscal ou referência para deduplicação.';

-- Lançamentos duplicados (mesma empresa, fornecedor e NF/referência) impedem o índice único.
-- Mantém o registro mais recente (`created_at`, depois `id`); remove os demais (itens e recebimento em cascata).
WITH ranked AS (
  SELECT
    e.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        e.company_id,
        public.expense_supplier_dedup_key(e.supplier_id, e.supplier_document),
        public.expense_document_dedup_key(e.invoice_number, e.invoice_series)
      ORDER BY e.created_at DESC NULLS LAST, e.id DESC
    ) AS rn
  FROM public.expenses e
  WHERE e.invoice_number IS NOT NULL
    AND btrim(e.invoice_number) <> ''
    AND public.expense_supplier_dedup_key(e.supplier_id, e.supplier_document) IS NOT NULL
)
DELETE FROM public.expenses e
USING ranked r
WHERE e.id = r.id AND r.rn > 1;

-- Uma despesa por empresa + fornecedor identificável + mesmo número/série de documento.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_unique_supplier_document_ref
ON public.expenses (
  company_id,
  public.expense_supplier_dedup_key(supplier_id, supplier_document),
  public.expense_document_dedup_key(invoice_number, invoice_series)
)
WHERE invoice_number IS NOT NULL
  AND btrim(invoice_number) <> ''
  AND public.expense_supplier_dedup_key(supplier_id, supplier_document) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.expense_find_duplicate_by_supplier_document(
  p_company_id uuid,
  p_supplier_id uuid,
  p_supplier_document text,
  p_invoice_number text,
  p_invoice_series text,
  p_exclude_expense_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT e.id
  FROM public.expenses e
  WHERE e.company_id = p_company_id
    AND btrim(COALESCE(e.invoice_number, '')) <> ''
    AND public.expense_supplier_dedup_key(e.supplier_id, e.supplier_document)
      = public.expense_supplier_dedup_key(p_supplier_id, p_supplier_document)
    AND public.expense_document_dedup_key(e.invoice_number, e.invoice_series)
      = public.expense_document_dedup_key(p_invoice_number, p_invoice_series)
    AND public.expense_supplier_dedup_key(p_supplier_id, p_supplier_document) IS NOT NULL
    AND (p_exclude_expense_id IS NULL OR e.id <> p_exclude_expense_id)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.expense_find_duplicate_by_supplier_document IS
  'Retorna o id de uma despesa duplicada (mesmo fornecedor + mesmo nº/série), ou NULL.';

GRANT EXECUTE ON FUNCTION public.expense_find_duplicate_by_supplier_document(
  uuid, uuid, text, text, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.expense_find_duplicate_by_supplier_document(
  uuid, uuid, text, text, text, uuid
) TO service_role;

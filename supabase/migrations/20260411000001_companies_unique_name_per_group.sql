-- Nome de unidade único por grupo (comparação sem diferenciar maiúsculas e ignorando espaços nas pontas).

-- Dados legados: mesmo grupo + mesmo nome normalizado → mantém a mais antiga e renomeia as outras.
UPDATE public.companies AS c
SET name = trim(c.name) || ' (' || dup.n::text || ')'
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY group_id, lower(trim(name))
      ORDER BY created_at ASC, id ASC
    ) AS n
  FROM public.companies
) AS dup
WHERE c.id = dup.id
  AND dup.n > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_group_id_name_normalized
  ON public.companies (group_id, lower(trim(name)));

COMMENT ON INDEX public.idx_companies_group_id_name_normalized IS
  'Impede duas unidades com o mesmo nome no mesmo grupo (nome normalizado: trim + lower).';

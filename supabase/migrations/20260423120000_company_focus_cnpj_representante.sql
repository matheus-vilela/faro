-- Snapshot da consulta CNPJ (Focus) e representante legal da unidade.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS focus_cnpj_consulta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS representante_legal jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.companies.focus_cnpj_consulta IS
  'Último payload retornado pela consulta CNPJ (edge focus-consulta-cnpj), incluindo campos não exibidos no front.';

COMMENT ON COLUMN public.companies.representante_legal IS
  'Representante legal: nome_responsavel, cpf_responsavel (só dígitos), data_nascimento (YYYY-MM-DD).';

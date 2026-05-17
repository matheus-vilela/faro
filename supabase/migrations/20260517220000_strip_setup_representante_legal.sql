-- Remove chave legada `representante_legal` de companies.setup (não usada no produto).
UPDATE public.companies c
SET setup = c.setup - 'representante_legal'
WHERE c.setup ? 'representante_legal';

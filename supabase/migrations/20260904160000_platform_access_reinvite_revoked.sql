-- Remover o acesso só marca status=revoked; o unique (empresa, e-mail)
-- impedia convidar de novo o mesmo e-mail. Único só vale para acessos vivos.

alter table public.company_platform_access
  drop constraint if exists company_platform_access_company_id_email_normalized_key;

create unique index if not exists company_platform_access_company_email_live_uidx
  on public.company_platform_access (company_id, email_normalized)
  where status is distinct from 'revoked';

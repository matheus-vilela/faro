-- XML completo da NF-e (GET Focus por chave), preenchido por `focus-get-sync-nfe`.

alter table public.focus_get_sync_nfe_staging
  add column if not exists xml_content text;

comment on column public.focus_get_sync_nfe_staging.xml_content is
  'Corpo XML UTF-8 devolvido por GET /v2/nfes_recebidas/{chave}.xml na Focus; null se o download falhar.';

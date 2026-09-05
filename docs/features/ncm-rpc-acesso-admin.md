# Feature: Aba NCM sem acesso negado

- **Slug:** `ncm-rpc-acesso-admin`
- **Status:** feita
- **Área:** `/app/configuracoes/categorias` (aba NCMs)

## Problema

Ao abrir a aba NCMs, o toast mostra «Acesso negado». As RPCs `list_company_ncms` e `list_company_ncm_products` só aceitam quem está em `user_companies`, e recusam admin Faro.

## Objetivo

Quem pode ver a unidade (membro ou admin Faro) consegue listar os NCMs.

## Fora de escopo

- Mudar o layout ou as regras de vínculo NCM → categoria.
- Alterar quem pode gravar regras (continua owner).

## Contexto no código

- `web/src/pages/ConfiguracoesCategoriasNcmsPanel.tsx`
- `web/src/lib/ncm/ncmCategoryRulesApi.ts`
- `supabase/migrations/20260905163000_ncm_product_category_dre_v4.sql`
- Helper: `public.user_has_company_access`

## Comportamento esperado

- Abrir a aba NCMs carrega a lista sem toast de acesso negado.
- Admin Faro e membro da unidade veem os mesmos NCMs da empresa.

## Critérios de aceite

- [x] Clique na aba NCMs não mostra «Acesso negado».
- [x] RPCs usam `user_has_company_access`, não só `user_companies`.

## Notas para a IA

Mesmo padrão de `20260905140000_intermediate_rpc_company_access.sql`. Manter o `RAISE EXCEPTION 'Acesso negado'` só quando o helper for falso.

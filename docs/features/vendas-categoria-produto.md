# Feature: Categoria da venda (mix, não pagamento)

- **Slug:** `vendas-categoria-produto`
- **Status:** feita
- **Área:** `/app/vendas-realizadas` (import EPOC)

## Problema

Na Eulália, HEINEKEN 600 cai na folha DRE **Dinheiro** (~R$ 144 mil). O Grupo do PDV já é CERVEJAS/CHOPP.; a coluna Categoria lê `revenue_entries.subcategory_id`. O DRE operacional foi cadastrado como forma de pagamento (Dinheiro, Pix…) sem “Vendas de bebidas”. Marcas sem a palavra “cerveja” não casam a heurística e vão para o default (primeira folha).

## Objetivo

A categoria da venda é o que foi vendido (bebida vs produto). Heineken e semelhantes vão para Vendas de bebidas, nunca para Dinheiro/Pix/Adiantamento. O sync seguinte não regrava o erro.

## Fora de escopo

- Re-seedar a árvore DRE v3.
- Mudar KPI de ticket médio ou margem globais.
- Agrupar CMV por categoria.
- Usar `default_dre_category_id` de despesa (INSS) como conta de venda.
- Trocar a coluna Categoria da UI para o catálogo fino (Cervejas vs Soft).

## Contexto no código

- Libs: `supabase/functions/_shared/epocCsvRevenueClassification.ts`, `epocCsvProductBySku.ts`
- Backend: `process-integration-csv-revenue-job`, `company_categories`, `revenue_entries`
- UI (só consome): `web/src/lib/vendasRealizadasResumo.ts`

## Comportamento esperado

- Import garante folhas **Vendas de bebidas** e **Vendas de produtos** se faltarem.
- Grupo EPOC mapeia para seed (CERVEJAS/CHOPP → Cervejas); nomes de pagamento não viram catálogo.
- Classificação: catálogo + nome (marcas) → bebidas/produtos; ignora folhas de pagamento e dump.
- Backfill de `product_sale` e `recipe_sale` nessas folhas dump; cache `epoc_revenue_category_by_product` invalidado.

## Critérios de aceite

- [x] HEINEKEN 600 e HEINEKEN LATA → Vendas de bebidas, nunca Dinheiro/Adiantamento.
- [x] AMSTEL 600 / Grupo CERVEJAS/CHOPP → bebidas; BOLINHOS/PRATOS → produtos.
- [x] `default_dre_category_id` INSS e CMV - Bebidas ignorados na venda.
- [x] Cache antigo apontando para Dinheiro não é reutilizado.
- [x] Testes unitários do caso Eulália (heurística + Grupo).
- [x] Verificar no browser depois do deploy da migration (dados de produção). Conferido em prod (Eulália): HEINEKEN 600/LATA/ZERO/SEM GLUTEN → Vendas de bebidas; 0 vendas em Dinheiro/Pix/Adiantamento/Reservas.

## Notas para a IA

Não apagar a conta Dinheiro (lançamento manual). `default_dre_category_id` do catálogo é conta de **compra** (despesa), não de receita.

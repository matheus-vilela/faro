# Feature: Mix fino do catálogo nas vendas

- **Slug:** `vendas-mix-catalogo`
- **Status:** feita
- **Área:** `/app/vendas-realizadas` (resumo, listagem, margens) + detalhe da venda

## Problema

A coluna Categoria das vendas mostra a folha DRE (Vendas de bebidas / produtos). Heineken e Coca caem no mesmo balde. O catálogo já tem Cervejas, Soft Drink, prato — mas vendas e margens não leem `product_category_assignments`. SKUs sem tag viram “Sem grupo”. O editor da venda ainda oferece Dinheiro/Pix como conta de receita.

## Objetivo

O usuário vê Cervejas vs Soft vs prato na receita e na margem; não classifica venda como pagamento; SKUs vendidos sem tag recebem grupo.

## Fora de escopo

- Re-seed da árvore DRE; apagar a conta Dinheiro (lançamento manual).
- Usar `default_dre_category_id` do catálogo como conta de venda (é compra/despesa).
- Mudar ticket médio ou margem globais.
- BCG por grupo (matriz continua por SKU).
- Dashboard home (já é por produto).

## Contexto no código

- Páginas / rotas: `/app/vendas-realizadas`, `/app/vendas-realizadas/calendario/listagem`, `/app/vendas-realizadas/margens`, `/app/vendas`, `/app/receitas`
- Componentes: `VendasRealizadasResumo`, `VendasRealizadasListTable`, `CmvMargens`, `RevenueSalesList`, `RevenueDetailSheet`, `ConfiguracoesCategoriasProdutosPanel`
- Hooks / libs: `vendasRealizadasResumo.ts`, `cmvMargensResumo.ts`, `suggestProductCatalogCategory.ts`, `reports/builders/cmv.ts`
- Backend: `product_category_assignments`, `company_product_categories`, `recipes.output_product_id`; RPC de backfill de tags
- Relacionada: `docs/features/vendas-categoria-produto.md` (DRE bebidas/produtos, já feita)

## Comportamento esperado

- Mix operacional = **Grupo** (catálogo). Folha DRE só no relatório DRE e no editor da venda.
- `product_sale` → assignment do produto; `recipe_sale` → assignment do produto de saída da ficha.
- N:N: uma tag (menor `sort_order`, depois nome); ignora `exclude_from_sales`. Sem tag residual: **Sem grupo**.
- Backfill pontual: Grupo EPOC + heurística de nome; nomes de pagamento não viram tag.
- Picker de receita da venda omite folhas com nome de pagamento.
- Conta DRE no cadastro de categorias de produto é rotulada como compra/despesa.
- Margens: Por produto | Por grupo; KPIs do topo iguais.

## Critérios de aceite

- [x] HEINEKEN → Grupo Cervejas (não Dinheiro, não só “Vendas de bebidas”).
- [x] Coca/refrigerante → Soft Drink; prato/salgado no grupo de comida; ficha via `output_product_id`.
- [x] Produtos vendidos sem tag recebem grupo no backfill; residual Sem grupo.
- [x] Campeões e listagem mostram Grupo, não a coluna Categoria DRE.
- [x] Receita por grupo no resumo; filtro Grupo na listagem (`SearchSelect` sm).
- [x] Detalhe da venda não lista Dinheiro/Pix/Adiantamento/Reservas.
- [x] Placeholder do DRE no catálogo deixa claro que é conta de compra.
- [x] CMV por grupo não altera ticket/margem globais nem BCG.
- [x] Verificar no browser Resumo, Listagem, Margens e detalhe da venda. Dev: Margens tem Por grupo; listagem tem filtro Grupo; catálogo diz conta de compra. Heineken em Cervejas conferido por teste (unidade Dev sem vendas no período).

## Notas para a IA

Não apagar Dinheiro. Não usar `default_dre_category_id` na venda. Reusar o filtro de folha de pagamento em `epocCsvRevenueClassification.ts`. Tabelas: `SortableTableHead`. Filtro: barra compacta + `SearchSelect` size sm.

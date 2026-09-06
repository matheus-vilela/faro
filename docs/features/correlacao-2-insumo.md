# Feature: Correlação 2 — é um insumo

- **Slug:** `correlacao-2-insumo`
- **Status:** em-andamento
- **Área:** `/app/produtos/correlacao-2`

## Problema

Na Correlação 2 o seletor do item tem unificar, ficha técnica, ficha de produção, agrupamento, variante e produto interno. Falta **é um insumo**: o cadastro da fila (nota ou produto) entra numa ficha, sem virar o prato. Só compra já tinha «Insumo de uma ficha», e não dava para cadastrar a ficha ali.

## Objetivo

O inspector oferece **É um insumo**. O item liga-se a uma ficha técnica ou de produção existente, ou a uma ficha nova criada no próprio seletor.

## Fora de escopo

- Transformar o item da fila em ficha (`RECIPE_CONTROLLED` / `INTERMEDIATE`) — isso continua em Ficha técnica / Ficha de produção.
- Unificar o insumo com o prato.
- Extrair o editor de ficha do `EstoqueReceitasPanel`.
- Fila «vendas da ficha» (`recipe_sales_unlinked`) e ficha incompleta (`recipe_without_ingredients`).

## Contexto no código

- `web/src/lib/productSetupQueue.ts` — `setupChoicesForItem`, rótulos
- `web/src/components/products/ProductSetupActionPanel.tsx` — workspace `ingredient`
- `web/src/lib/onboardingProductRecipeMatch.ts` — `addPurchaseAsRecipeIngredient`, `fetchCompanyRecipesForPick`
- `web/src/lib/createCatalogProduct.ts` + `saveProductTechnicalSheet` — criar ficha
- `docs/dominio/produtos.md`

## Comportamento esperado

- Vendido sem vínculo e compra sem uso incluem **É um insumo** no seletor.
- O seletor de ficha tem abas **Ficha técnica** e **Ficha de produção**. A aba define o tipo.
- Na lista: primeiro **fichas já cadastradas** da aba; depois **produtos** (`DIRECT`) para converter naquele tipo.
- Quantidade e unidade do insumo como hoje.
- Digitar um nome que não existe na aba: **Cadastrar «nome»**. Sem formulário extra de tipo.
- O item da fila permanece produto (`DIRECT`); some da lista depois de vincular.

## Critérios de aceite

- [x] Seletor da Correlação 2 (venda e compra) tem «É um insumo».
- [x] Vincular a ficha técnica ou de produção existente grava o insumo e tira o item da fila.
- [x] Cadastrar ficha nova (técnica ou produção) pelo seletor cria a ficha e já coloca o item como insumo.
- [x] Lista: fichas cadastradas primeiro; produtos em seguida para converter.
- [x] Ficha incompleta / vendas da ficha não ganham esta opção.
- [ ] Verificar no browser: compra → ficha existente; compra → criar ficha; venda → é um insumo.

## Notas para a IA

Insumo não é `stock_control_type`. Não unificar dose/prato com a garrafa. Reutilizar `SearchSelect` (`onCreate` + `footer`). Não inventar outro picker.

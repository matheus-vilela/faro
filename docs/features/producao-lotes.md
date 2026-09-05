# Feature: Produção por quantidade de receitas

- **Slug:** `producao-lotes`
- **Status:** em-andamento
- **Área:** `/app/produtos/fichas` · `/app/produtos` detalhe · aba Produção

## Problema

O campo de produzir é tratado como unidades do produto. Quem produz pensa em **quantas receitas** vai fazer. Sem resumo, não dá para ver quanto entra no estoque e quanto sai de cada insumo antes de confirmar.

## Objetivo

O número informado é a quantidade de receitas. A entrada é esse número × rendimento. A saída de cada insumo é a quantidade da ficha × o número informado. Antes de produzir, um resumo visual e uma confirmação com o total que entra.

## Fora de escopo

- Mudar a RPC `produce_intermediate_product` para outro parâmetro (continua recebendo a quantidade de saída).
- Recalcular produções já lançadas.
- Estorno de produção.

## Contexto no código

- `web/src/components/estoque/EstoqueReceitasPanel.tsx` — aba Produzir
- `web/src/components/estoque/RecipeProducePanel.tsx`
- `web/src/components/products/ProductProduceCard.tsx`
- `web/src/pages/Produtos.tsx` — aba Produção no detalhe
- `web/src/lib/recipeProductionPreview.ts`
- `web/src/lib/productIntermediate.ts` — `produceIntermediateProduct`
- `consume_recipe_stock` — escala = porções / rendimento; porções = receitas × rendimento

## Comportamento esperado

- Campo: quantidade de receitas (lotes).
- Entrada no produto = receitas × `batch_yield`.
- Saída de cada insumo = quantidade cadastrada na ficha × receitas.
- Resumo acima do botão: total que entra e lista do que sai.
- Ao clicar em Produzir: diálogo com o total do item que entra; só então executa.
- No detalhe do catálogo, intermediário tem aba **Produção** com o mesmo fluxo. Some o card de produzir do Resumo.

## Critérios de aceite

- [x] 2 receitas com rendimento 10 entram 20 no produto.
- [x] Os insumos saem em 2 × a quantidade da ficha (não 2 unidades avulsas).
- [x] Resumo mostra entrada e saídas antes do botão.
- [x] Segundo clique de confirmação informa o total que entra.
- [x] Detalhe do intermediário no catálogo tem aba Produção com o mesmo fluxo; ficha normal não mostra a aba.
- [ ] Verificar no browser o fluxo Produzir com resumo e confirmação.

## Notas para a IA

- Insumos gravados na ficha são o consumo de **1 receita** (1 lote).
- Chamar a RPC de produção com `receitas * rendimento` para a escala de `consume_recipe_stock` ficar igual a `receitas`.

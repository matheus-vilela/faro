# Feature: Ficha normal não se produz nem se prepara

- **Slug:** `ficha-normal-sem-preparo`
- **Status:** pronto
- **Área:** `/app/produtos/fichas` · detalhe da ficha

## Problema

A ficha técnica comum (venda) tem botão e aba **Preparar**, que baixa insumos como se fosse produção. Essa ficha só existe para, na venda, identificar os insumos e dar baixa proporcional à receita. Quem produz e estoca é a **ficha de produção** (intermediário).

## Objetivo

Só a ficha de produção pode ser produzida. A ficha normal não tem Preparar/Produzir.

## Fora de escopo

- Apagar a RPC `consume_recipe_stock` (continua para outros fluxos, se houver).
- Mudar a explosão de insumos na venda.
- Converter fichas antigas em lote.

## Contexto no código

- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `web/src/components/estoque/RecipeProducePanel.tsx`
- `web/src/lib/recipeListFilter.ts`
- `docs/features/produto-intermediario.md`

## Comportamento esperado

- Lista: botão **Produzir** só em ficha de produção. Ficha normal não tem Preparar.
- Detalhe da ficha normal: abas Ficha e Histórico. Sem aba Produzir/Preparar.
- Detalhe da ficha de produção: aba **Produzir** continua.

## Critérios de aceite

- [x] Ficha normal na lista não mostra Preparar.
- [x] Abrir ficha normal não mostra aba de produção/preparo.
- [x] Ficha de produção continua com Produzir.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

`recipe_type === PRODUCTION` / `sheetKind === "intermediate"`. Não misturar com ficha SALE/PREP.

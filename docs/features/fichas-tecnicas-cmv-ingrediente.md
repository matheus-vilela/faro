# Feature: CMV por insumo da ficha técnica

- **Slug:** `fichas-tecnicas-cmv-ingrediente`
- **Status:** feita
- **Área:** `/app/produtos/fichas` · detalhe da ficha técnica

## Problema

O detalhe lista ingredientes por porção sem custo. Uma ficha pode usar outra ficha como insumo; o CMV desse item não está no produto de saída, e sim na receita aninhada.

## Objetivo

Cada insumo da ficha técnica mostra o CMV da quantidade usada. Se o insumo for outra ficha, o custo vem da receita dela.

## Fora de escopo

- Explodir ficha de produção (intermediário usa o custo de estoque).
- Gravar CMV no banco ou mudar o DRE.

## Contexto no código

- `web/src/lib/recipeSaleCmv.ts`
- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Em Ingredientes por porção, cada linha mostra o CMV da qtde.
- Insumo `DIRECT` / intermediário: qtde de estoque × custo unitário.
- Insumo ficha técnica: qtde × CMV de 1 venda da ficha filha (recursivo).
- Ciclo ou custo faltando: "—".
- A coluna CMV da lista usa a mesma regra.

## Critérios de aceite

- [x] Detalhe da ficha técnica mostra CMV em cada insumo.
- [x] Insumo que é outra ficha usa o CMV calculado dessa ficha.
- [x] Lista de fichas técnicas soma com a mesma explosão.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

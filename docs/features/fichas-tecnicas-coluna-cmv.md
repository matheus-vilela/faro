# Feature: Coluna CMV na lista de fichas técnicas

- **Slug:** `fichas-tecnicas-coluna-cmv`
- **Status:** feita
- **Área:** `/app/produtos/fichas`

## Problema

A lista de ficha normal mostra produto de saída e rendimento. Na ficha técnica isso pouco ajuda: o que importa na venda é o CMV da porção.

## Objetivo

Na aba Fichas técnicas, a tabela mostra CMV no lugar de Produto e Rendimento.

## Fora de escopo

- Mudar a lista de fichas de produção.
- Gravar CMV no banco ou alterar o DRE.
- Recalcular CMV histórico de vendas.

## Contexto no código

- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `web/src/lib/productCatalogValue.ts` — `productUnitCost`
- `web/src/lib/productTechnicalSheetProportions.ts`

## Comportamento esperado

- Colunas da ficha técnica: Ficha, CMV, Insumos.
- CMV = soma (qtde de estoque do insumo × custo unitário) / rendimento — custo de 1 venda.
- Sem custo em algum insumo com quantidade: mostra "—".
- Ficha de produção continua com Produto e Rendimento.

## Critérios de aceite

- [x] Aba Fichas técnicas não tem colunas Produto nem Rendimento.
- [x] Aba Fichas técnicas tem coluna CMV ordenável.
- [x] Aba Produção não muda essas colunas.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

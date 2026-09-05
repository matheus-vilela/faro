# Feature: Layout da aba Fichas técnicas

- **Slug:** `fichas-tecnicas-layout`
- **Status:** em-andamento
- **Área:** `/app/produtos/fichas`

## Problema

A lista empilha cards com a receita inteira e um bloco de produção embaixo. Filtro só por nome da ficha. Não há histórico de movimentações no detalhe. A aba Vincular compras compete com o fluxo e não entra neste recorte.

## Objetivo

Lista no padrão das telas financeiras: busca, cards/tabela enxutos, detalhe com ficha, histórico e produção. Vincular compras some do menu.

## Fora de escopo

- Apagar `EstoqueVincularComprasPanel` (só desliga a rota/aba).
- Recriar o editor de insumos.
- Estorno especial de produção.

## Contexto no código

- `web/src/pages/FichasTecnicas.tsx`
- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/components/products/ProductStockMovementHistorySection.tsx`
- `web/src/lib/productStockPaths.ts`
- Regra: `.cursor/rules/tabelas-e-sheets.mdc`

## Comportamento esperado

- Busca por nome da ficha **ou** nome de insumo (e produto de saída).
- Card/linha sem lista de ingredientes; só nome, tipo, saída, rendimento e qtde de insumos.
- Com texto de busca que casa um insumo: abaixo do nome da ficha, só o(s) insumo(s) pesquisado(s) — não a receita inteira.
- Tabela no desktop, cards no celular.
- Sheet: abas Ficha, Histórico, Produzir. Produção também no detalhe (some o card solto da lista).
- Aba Vincular compras removida; `/fichas/vinculos` redireciona para `/fichas`.

## Critérios de aceite

- [x] Busca encontra ficha pelo nome e pelo insumo.
- [x] Lista não mostra a receita completa no card.
- [x] Com busca que casa insumo, o nome desse produto aparece abaixo do nome da ficha (só o pesquisado).
- [x] Detalhe tem Histórico (movimentações da ficha/produto) e Produzir.
- [x] Vincular compras não aparece no menu.
- [ ] Verificar no browser o fluxo principal.

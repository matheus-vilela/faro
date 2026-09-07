# Feature: Separar fichas técnicas e de produção

- **Slug:** `fichas-tecnicas-e-producao`
- **Status:** feita
- **Área:** `/app/produtos/fichas`

## Problema

Ficha normal e ficha de produção aparecem na mesma lista, com chips Todas / Ficha / Produção. São mecanismos diferentes: a normal só baixa insumos na venda; a de produção estoca o intermediário.

## Objetivo

Duas listas: fichas técnicas e fichas de produção.

## Fora de escopo

- Mudar o editor de insumos ou a explosão na venda.
- Alterar o diálogo de ficha na correlação / catálogo.
- Converter fichas antigas.

## Contexto no código

- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/pages/FichasTecnicas.tsx`
- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `web/src/lib/recipeListFilter.ts`
- `web/src/lib/productStockPaths.ts`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Abas **Fichas técnicas** (`/fichas`) e **Fichas de produção** (`/fichas/producao`).
- Cada lista só mostra o tipo da aba. Sem chips Todas / Ficha / Produção.
- Nova ficha na aba de produção já nasce como intermediário; na outra, como ficha normal.

## Critérios de aceite

- [x] Aba de fichas técnicas não lista receita `PRODUCTION`.
- [x] Aba de produção não lista ficha normal (`PREP` / `SALE`).
- [x] Nova ficha em cada aba usa o tipo certo.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

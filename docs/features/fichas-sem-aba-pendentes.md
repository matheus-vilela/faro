# Feature: Sem aba Pendentes nas fichas técnicas

- **Slug:** `fichas-sem-aba-pendentes`
- **Status:** feita
- **Área:** `/app/produtos/fichas`

## Problema

O grupo Fichas técnicas tem duas abas (Fichas e Pendentes). A revisão de candidatos a ficha já acontece em Classificar; a aba extra só exige um segundo nível de navegação.

## Objetivo

`/app/produtos/fichas` mostra só a lista de fichas, sem abas.

## Fora de escopo

- Remover o alerta de fichas pendentes no dashboard (continua apontando para Classificar).
- Alterar o editor de fichas ou a correlação.

## Contexto no código

- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/pages/FichasTecnicas.tsx`
- `web/src/App.tsx`
- `web/src/lib/productStockPaths.ts`
- `web/src/pages/ProdutosLegacyRedirect.tsx`
- Painel antigo `EstoqueFichasPendentesPanel` (removido)

## Comportamento esperado

- Menu lateral de Fichas técnicas abre a lista, sem barra de abas.
- `/app/produtos/fichas/pendentes` e `?inbox=pendentes` redirecionam para `/app/produtos/fichas`.

## Critérios de aceite

- [x] Em Fichas técnicas não há abas Fichas / Pendentes.
- [x] A lista de fichas continua acessível em `/app/produtos/fichas`.
- [x] URL antiga `/fichas/pendentes` cai na lista.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

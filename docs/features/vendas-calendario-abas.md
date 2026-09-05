# Feature: Calendário de vendas — abas internas

- **Slug:** `vendas-calendario-abas`
- **Status:** pronto
- **Área:** `/app/vendas-realizadas/calendario`

## Problema

A área Calendário de Vendas realizadas mostra calendário e listagem na mesma tela. Quem quer só a lista (ou só o mês) precisa rolar.

## Objetivo

Dentro de Calendário, duas abas internas: **Calendário** e **Listagem**.

## Fora de escopo

- Tirar Calendário da sidebar de Vendas realizadas.
- Mudar filtros, totais ou o fluxo de recebimento.
- Alterar Contas a pagar.

## Contexto no código

- `web/src/pages/VendasRealizadasFluxo.tsx`
- `web/src/components/fluxo/FluxoBoletosPage.tsx` — `section`
- `web/src/App.tsx`
- Abas: `ProdutosEstoqueLayout` (`StockTabLink`)

## Comportamento esperado

- Abas **Calendário** e **Listagem** no conteúdo, não na sidebar.
- Rotas: `/app/vendas-realizadas/calendario` e `/app/vendas-realizadas/calendario/listagem`.
- Trocar de aba não perde o mês.
- Calendário não mostra a lista; listagem não mostra o calendário.

## Critérios de aceite

- [x] Existem as duas abas internas.
- [x] URL própria para cada aba; refresh mantém a aba.
- [x] A sidebar continua com um item Calendário.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

`FluxoBoletosPage` já aceita `section="calendar" | "list"`. Manter o componente montado ao trocar a aba (`calendario/*`).

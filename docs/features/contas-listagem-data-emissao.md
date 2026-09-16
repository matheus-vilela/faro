# Feature: Data de emissão na listagem de contas a pagar

- **Slug:** `contas-listagem-data-emissao`
- **Status:** pronta
- **Área:** `/app/contas-a-pagar/listagem`

## Problema

A listagem mostra só o vencimento. Sem a data de emissão, fica difícil cruzar boleto, NF e prazo.

## Objetivo

Cada conta na listagem mostra emissão e vencimento.

## Fora de escopo

- Filtrar ou ordenar a consulta pelo mês de emissão (o período continua pelo vencimento).
- Alterar calendário, totais ou o formulário de cadastro.
- Contas a receber / vendas realizadas.

## Contexto no código

- `web/src/components/fluxo/PayableByDueDateView.tsx`
- `web/src/components/fluxo/PayableByCategoryView.tsx`
- `web/src/components/fluxo/FluxoBoletosPage.tsx` — cards da visão por situação
- `web/src/lib/payableListViews.ts`
- `web/src/components/fluxo/BoletoResumoSheet.tsx`
- Campo: `boletos.emission_date`

## Comportamento esperado

- Visão por vencimento: coluna **Emissão** ao lado de **Vencimento**, ordenável.
- Visão por categoria: emissão e vencimento na linha.
- Visão por situação: emissão e vencimento no card.
- Sem emissão: mostrar "—".
- Abrir o resumo da conta também mostra a emissão.

## Critérios de aceite

- [x] As três visões da listagem exibem emissão além do vencimento.
- [x] Cabeçalho da coluna Emissão ordena a tabela.
- [x] Conta sem `emission_date` mostra "—", não o vencimento no lugar.
- [ ] Verificar no browser o fluxo principal (não só screenshot). Login bloqueou a conferência automática.

## Notas para a IA

Reutilizar `formatDueDateShort` / `SortableTableHead`. Não copiar o tom de atraso da célula de vencimento para a emissão.

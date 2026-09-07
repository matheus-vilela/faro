# Feature: Data da venda na movimentação de estoque

- **Slug:** `movimentacao-data-venda`
- **Status:** feita
- **Área:** `/app/produtos` · aba Histórico · `/app/estoque` · Movimentações

## Problema

A coluna Data das movimentações usa só `created_at`. No onboarding PDV isso é o dia em que o import rodou, não o dia da venda. Algumas baixas EPOC já gravam `metadata_json.sale_date`.

## Objetivo

Se a movimentação tiver `sale_date`, a UI mostra e ordena por essa data no lugar de `created_at`.

## Fora de escopo

- Backfill em massa de `created_at`.
- Filtro de período da lista geral (ainda usa `created_at`).
- Alterar saldo ou CMV.

## Contexto no código

- `web/src/components/products/ProductStockMovementHistorySection.tsx`
- `web/src/components/estoque/EstoqueMovimentacoesPanel.tsx`
- `web/src/lib/stockMovementSaleDate.ts`

## Comportamento esperado

- `metadata_json.sale_date` (yyyy-MM-dd) tem prioridade sobre `created_at` na exibição e na ordem (mais recente primeiro).
- Sem `sale_date` numa venda (`revenue_entry`), usa `revenue_entries.entry_date`.
- Sem os dois, mantém `created_at` (com hora).
- Paginação da aba do produto ordena o conjunto inteiro, não só a página.

## Critérios de aceite

- [x] Aba Histórico do produto mostra `sale_date` / data da venda quando existir.
- [x] Lista geral de movimentações usa a mesma regra na coluna Data.
- [x] Sem `sale_date` nem `entry_date`, continua `created_at`.
- [x] Listagem ordena pela data efetiva (sale_date / venda / created_at).
- [ ] Verificar no browser o fluxo principal (não só screenshot).

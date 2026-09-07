# Feature: Data da venda ou da compra na movimentação

- **Slug:** `movimentacao-data-venda`
- **Status:** feito
- **Área:** `/app/produtos` · aba Histórico · `/app/estoque` · Movimentações

## Problema

A coluna Data usava `created_at` (dia do import) ou só a data da venda. Entrada de nota fiscal também precisa da data da compra, não do momento em que o estoque foi lançado.

## Objetivo

A coluna Data mostra a data da venda (PDV), senão a da compra (nota), senão `created_at`.

## Fora de escopo

- Backfill em massa de `created_at`.
- Filtro de período da lista geral (ainda usa `created_at`).
- Alterar saldo ou CMV.

## Contexto no código

- `web/src/lib/stockMovementSaleDate.ts`
- `web/src/components/estoque/EstoqueMovimentacoesPanel.tsx`
- `web/src/components/products/ProductStockMovementHistorySection.tsx`
- `web/src/lib/stockMovementExpenseLink.ts`

## Comportamento esperado

- PDV: `metadata_json.sale_date`, senão `revenue_entries.entry_date`.
- Nota: `expenses.reference_date` (emissão / competência da NF), via `expense` / `expense_item` / `import_breakdown`.
- Sem os dois: `created_at` (com hora).
- Ordem da lista pela data efetiva.

## Critérios de aceite

- [x] Venda PDV mostra a data da venda.
- [x] Entrada de nota mostra a data da compra (`reference_date`).
- [x] Sem venda nem compra, mostra `created_at`.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

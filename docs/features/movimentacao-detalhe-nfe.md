# Feature: Detalhe da movimentação — nota, fornecedor e item

- **Slug:** `movimentacao-detalhe-nfe`
- **Status:** feita
- **Área:** Histórico do produto / sheet da movimentação

## Problema

A movimentação criada a partir da NF-e (`nfe_staging_create`, `expense_item`) não mostra qual nota, qual fornecedor, a quantidade da linha nem o nome original do item no XML.

## Objetivo

No detalhe da movimentação, quando houver lastro de nota, aparecem nota fiscal, fornecedor, quantidade da nota e o item original.

## Fora de escopo

- Editar a nota a partir da movimentação.
- Reprocessar XMLs antigos.

## Contexto no código

- `web/src/components/estoque/StockMovementEditSheet.tsx`
- `web/src/lib/stockMovementInvoiceContext.ts`
- `web/src/lib/stockMovementExpenseLink.ts`

## Comportamento esperado

- Origem em despesa (`expense_item` / `import_breakdown` / `expense`): lê a linha e a despesa.
- Origem `nfe_staging_create` (e similares): tenta a linha de despesa do mesmo produto; se não houver, fornecedor do `reference_id` ou de `product_supplier_codes`.
- Card com: nota (número/série), fornecedor, quantidade na nota + unidade, item original (`product_name` da linha). Quantidade de estoque continua no bloco da movimentação.
- Se achar a despesa, o botão de abrir a nota continua disponível.

## Critérios de aceite

- [x] Detalhe de `expense_item` mostra nota, fornecedor, qtd e item original.
- [x] Detalhe de `nfe_staging_create` mostra o lastro quando existir despesa ou fornecedor.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não assumir que `reference_id` de `nfe_staging_create` é despesa — pode ser o fornecedor.

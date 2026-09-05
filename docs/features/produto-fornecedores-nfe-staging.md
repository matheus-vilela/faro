# Feature: Fornecedor da NF-e na aba Fornecedores

- **Slug:** `produto-fornecedores-nfe-staging`
- **Status:** feita
- **Área:** `/app/produtos` · aba Fornecedores + interpretação staging

## Problema

`nfe_staging_create` cria produto e entrada a partir da nota, mas a aba Fornecedores só lê `expense_items`. Se a despesa não ligou o item (duplicata, item sem produto), a listagem fica vazia — some o lastro do emitente.

## Objetivo

Toda criação `nfe_staging_create` grava o fornecedor da nota. Esse fornecedor aparece na aba, mesmo sem linha de despesa.

## Fora de escopo

- Reprocessar notas antigas em lote.
- Mudar o motor `nfe_motor_create`.

## Contexto no código

- `web/src/components/products/ProductSuppliersSection.tsx`
- `web/src/lib/productSuppliers.ts`
- `supabase/functions/_shared/stagingNfeInterpretPostProcess.ts`
- `public.product_supplier_codes`

## Comportamento esperado

- Na criação com estoque (`nfe_staging_create`): `reference_id` = fornecedor da nota; `product_supplier_codes` sempre gravado (cProd ou `nfe:{productId}`).
- Aba Fornecedores: despesas **e** vínculos NF-e (`product_supplier_codes` + movimentações com origem de cadastro NF-e).
- Sem despesa: o emitente ainda aparece, como vínculo da NF-e.

## Critérios de aceite

- [x] `nfe_staging_create` passa `reference_id` do fornecedor.
- [x] Sem cProd ainda grava lastro em `product_supplier_codes`.
- [x] Aba lista fornecedor da NF-e sem `expense_items`.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não usar `last_unit_value_stock` como lastro. Fornecedor = `suppliers` da empresa + `product_supplier_codes` / `stock_movements.reference_id`.

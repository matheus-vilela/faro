# Feature: Preço de venda no cadastro (EPOC)

- **Slug:** `produto-preco-venda-epoc`
- **Status:** em-andamento
- **Área:** produtos · import EPOC · correlação

## Problema

O EPOC tem total vendido e quantidade, mas o cadastro só guarda preço de compra (`last_unit_value`). Sem um campo de venda, a fila da correlação não ranqueia bem o vendido e misturar no campo da nota corromperia CMV.

## Objetivo

Gravar o último preço de venda em campo próprio. A nota continua no preço de compra.

## Fora de escopo

- Mostrar o preço de venda no card de estoque/CMV.
- Alterar `last_unit_value` / `average_cost`.
- Recalcular CMV.

## Contexto no código

- `supabase/functions/process-integration-csv-revenue-job/index.ts`
- `web/src/types/product.ts`
- `web/src/lib/productSetupQueue.ts`
- `web/src/lib/productCatalogValue.ts`

## Comportamento esperado

- Coluna `last_sale_unit_value` (+ unidade). Não é o preço da NF.
- Import EPOC: `Total Bruto(R$) ÷ Quant.` atualiza o campo a cada venda.
- Venda de produto em geral (mesmo trigger) também atualiza.
- Correlação: vendido usa esse preço (ou total das receitas); compra usa o da nota.

## Critérios de aceite

- [x] Produto criado/atualizado pelo EPOC recebe preço de venda, não de compra.
- [x] NF não escreve em `last_sale_unit_value`.
- [x] Fila da correlação usa o preço de venda no giro dos vendidos.

## Notas para a IA

`unit_value` da receita pode receber o unitário; o lastro do cadastro é `last_sale_unit_value`.

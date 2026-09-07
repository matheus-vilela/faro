# Feature: Detalhe rico da movimentação de estoque

- **Slug:** `movimentacao-detalhe-contexto`
- **Status:** feito
- **Área:** `/app/produtos/estoque` · histórico do produto · sheet da movimentação

## Problema

O sheet da movimentação mostra tipo e um resumo curto. Falta deixar claro se o produto é ficha técnica, ficha de produção ou intermediário; o que originou a linha; e, na venda ou na compra, o contexto (dia, faturamento, nota).

## Objetivo

Ao abrir a movimentação, o usuário vê tipo, custos, papel do produto e a origem específica (venda, nota, ficha ou produção), com atalho para a nota ou a venda.

## Fora de escopo

- Editar venda ou nota a partir deste sheet.
- Mudar saldo, CMV ou regras de baixa.
- Filtro de período da lista.

## Contexto no código

- `web/src/components/estoque/StockMovementEditSheet.tsx`
- `web/src/lib/stockMovementInvoiceContext.ts`
- `web/src/lib/stockMovementEdit.ts`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Cabeçalho com tipo da movimentação (entrada/saída/perda/unificação) e data efetiva.
- Chips do produto: ficha técnica, ficha de produção, intermediário, agrupamento — sem misturar papéis.
- Bloco de quantidade, custo unitário e custo total da linha.
- Origem venda: dia, título, faturamento bruto/líquido, CMV quando houver, atalho para a venda.
- Origem compra: nota, fornecedor, item original, atalho para a nota.
- Origem ficha/produção: nome da ficha, se a linha é baixa de insumo ou entrada produzida, atalho para a ficha.
- Formulário de edição continua abaixo, só quando a origem permitir.

## Critérios de aceite

- [x] Tipo da movimentação aparece no topo, sem depender de abrir outro painel.
- [x] Ficha técnica, ficha de produção e intermediário ficam destacados quando for o caso.
- [x] Venda mostra dia e valores; compra abre a nota respectiva.
- [x] Custos da linha (unitário e total) aparecem no detalhe.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não unificar ficha com produto da nota. Insumo `DIRECT` baixado por ficha continua produto; o destaque da ficha é a origem da linha. Sheet sem `sm:max-w-*`.

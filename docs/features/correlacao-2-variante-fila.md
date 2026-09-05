# Feature: Variante some da Correlação 2

- **Slug:** `correlacao-2-variante-fila`
- **Status:** feita
- **Área:** `/app/produtos/correlacao-2`

## Problema

Depois de correlacionar um item como variante de agrupamento, ele some na hora. Ao reabrir a aba, volta para a fila. A exclusão era só local (`hiddenProductIds`); a fila não olha o vínculo em `product_sale_family_members`.

## Objetivo

Item já ligado a um agrupamento (variante ou o próprio agrupamento) não reaparece na Correlação 2 nem na Correlação original.

## Fora de escopo

- Desfazer vínculo de variante.
- Mudar o inspector ou os intents.

## Contexto no código

- `web/src/lib/productSetupQueue.ts`
- `web/src/lib/productSaleFamily.ts`
- `web/src/components/products/correlacao2/CorrelationV2Flow.tsx`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Produto em `product_sale_family_members` (variante ou família) não entra na fila.
- Produto `SALE_FAMILY` também não entra.
- Recarregar a aba não traz de volta quem já foi vinculado.

## Critérios de aceite

- [x] Variante já ligada some da listagem após F5 / troca de aba.
- [x] Agrupamento (`SALE_FAMILY`) não volta como caso pendente.

## Notas para a IA

Não depender só de `DISMISSED` em `product_import_dashboard_review`. O vínculo do agrupamento é a fonte da verdade.

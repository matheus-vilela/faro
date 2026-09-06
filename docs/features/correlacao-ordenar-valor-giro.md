# Feature: Correlação ordena por giro em valor

- **Slug:** `correlacao-ordenar-valor-giro`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Para corrigir · Correlação 2 · matches iniciais)

## Problema

A fila ordena só pelo volume (unidades compradas ou vendidas). Item barato com muito giro sobe; item de baixo volume e alto valor fica no fim.

## Objetivo

Ordenar pelo giro em valor: compra = valor de compra × volume; venda = valor vendido × volume. Sem preço, o volume continua como desempate.

## Fora de escopo

- Mudar o texto da coluna Volume.
- Recalcular CMV ou preço de catálogo.
- Alterar o contrato da IA.

## Contexto no código

- `web/src/lib/productSetupQueue.ts`
- `web/src/components/products/ProductSetupInbox.tsx`
- `web/src/lib/productValidation/correlationCase.ts`
- `supabase/migrations/20260825150000_product_movement_totals.sql`

## Comportamento esperado

- Compra: soma das entradas valoradas (`quantity × unit_cost`); se faltar, volume × último preço / CMV do cadastro.
- Venda e ficha: soma do `net_amount` das receitas; se faltar, volume × `last_sale_unit_value`.
- Ordenação: vendas (PDV/ficha) primeiro, depois compras da nota. Em cada grupo: valor desc, depois volume, depois nome.

## Critérios de aceite

- [x] Item de baixo volume e alto valor sobe na fila frente a alto volume sem valor agregado.
- [x] Sem preço, a ordem relativa por volume se mantém.
- [x] Matches iniciais e Correlação 2 usam o mesmo critério.
- [x] A lista mostra vendas primeiro e, em seguida, produtos da nota.

## Notas para a IA

Reutilizar `product_movement_totals`. Não usar CMV como preço de venda.

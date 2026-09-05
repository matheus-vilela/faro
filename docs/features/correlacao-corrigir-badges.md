# Feature: Badges de «Para corrigir»

- **Slug:** `correlacao-corrigir-badges`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

Embaixo do nome há badge de unidades vendidas (já existe a coluna Volume) e duas origens que parecem tipos diferentes: «Venda» e «PDV (EPOC) / venda». São o mesmo PDV, com rótulo de filas distintas.

## Objetivo

Só uma badge de origem, alinhada ao filtro (PDV, Nota fiscal, Ficha). Volume fica na coluna.

## Fora de escopo

- Mudar quem entra na fila.
- Mudar o filtro de origem.

## Contexto no código

- `web/src/components/products/ProductSetupInbox.tsx`
- `web/src/lib/productSetupQueue.ts`
- `web/src/lib/productSetupListFilter.ts`

## Comportamento esperado

- Badge do item: origem única (PDV, Nota fiscal ou Ficha).
- Sem badge de «N un vendidas» na tabela (a coluna Volume já mostra).
- No celular, volume aparece como texto, não como segunda origem.

## Critérios de aceite

- [x] Tabela sem badge de volume embaixo do nome.
- [x] Não existem mais os textos «Venda» e «PDV (EPOC) / venda».
- [x] Origem do item coincide com o filtro (PDV / Nota fiscal / Ficha).
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

`recipe_without_ingredients` é origem Ficha no filtro; o badge deve ser Ficha, não Venda.

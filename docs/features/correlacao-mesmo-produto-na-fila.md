# Feature: Mesmo produto também na fila Para corrigir

- **Slug:** `correlacao-mesmo-produto-na-fila`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação)

## Problema

Os matches de «Mesmo produto» somem da listagem «Para corrigir». Quem prefere corrigir pela fila (unificar, ficha, pular) não vê esses itens.

## Objetivo

Itens do bloco «Mesmo produto» aparecem também em «Para corrigir», misturados com os demais, na mesma ordem.

## Fora de escopo

- Tirar o bloco «Mesmo produto».
- Mudar o critério do match inicial (`same_item` ≥ 90% sem ficha).
- Alterar Correlação 2.

## Contexto no código

- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/components/products/ProductSetupInbox.tsx`
- `docs/features/correlacao-match-so-unificar.md`

## Comportamento esperado

- «Para corrigir» lista a fila inteira (PDV e nota), inclusive quem já está em «Mesmo produto».
- Unificar no bloco ou na fila some o item dos dois lugares.
- Ordenação da fila não muda (vendas, depois compras; giro).

## Critérios de aceite

- [x] Item em «Mesmo produto» também aparece em «Para corrigir».
- [x] Os outros pendentes continuam na mesma lista.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Hoje `residualKeys` exclui vendido e compras do bloco. Não filtrar esses IDs. Não passar `onlyKeys` residual.

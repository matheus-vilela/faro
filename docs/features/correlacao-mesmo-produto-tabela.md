# Feature: Mesmo produto em tabela e recusar unificação

- **Slug:** `correlacao-mesmo-produto-tabela`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação · Mesmo produto)

## Problema

O bloco é uma lista de cards. Não parece tabela. Não dá para recusar o par: se o vendido for ficha, o match some só se unificar — e unificar estaria errado.

## Objetivo

O bloco parece tabela, com a mesma ordem (PDV | = | nota). Dá para recusar a unificação; o item não some da fila «Para corrigir».

## Fora de escopo

- Inferir ficha neste bloco.
- Unificar ficha ou agrupamento com a nota.
- Alterar Correlação 2.
- Mudar o diálogo de unificar.

## Contexto no código

- `web/src/components/products/CorrelationSameProductSection.tsx`
- `web/src/components/products/ProductValidationCards.tsx`
- `web/src/lib/productValidation/session.ts`
- `docs/features/correlacao-match-so-unificar.md`

## Comportamento esperado

- Tabela: vendido à esquerda, `=` no meio, cadastros da nota à direita (incluir / tirar item).
- Cards só no celular; tabela a partir de `md`.
- **Unificar** grava como hoje.
- **Não unificar** tira o par só deste bloco. Não resolve o cadastro. Continua em Para corrigir (ficha, agrupamento, etc.).

## Critérios de aceite

- [x] Layout em tabela no desktop, mesma disposição PDV / = / nota.
- [x] Remover um cadastro da nota não some o vendido da fila.
- [x] Não unificar some o card daqui e o item segue em Para corrigir.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não chamar apply/merge ao recusar. Só filtrar `result.sameItem` na sessão. `SortableTableHead` + `useClientTableSort` na tabela.

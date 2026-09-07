# Feature: Skeleton ao abrir Classificar

- **Slug:** `classificar-skeleton-loader`
- **Status:** feita
- **Área:** `/app/produtos`

## Problema

Ao abrir Classificar, a tela mostra o card **Cadastro alinhado** como se não houvesse itens. A busca da fila ainda está em andamento; depois a listagem aparece. O usuário interpreta que não há nada para classificar.

## Objetivo

Enquanto a fila carrega, mostrar um skeleton da listagem — não o empty state.

## Fora de escopo

- Alterar a busca da fila ou a verificação com a IA.
- Skeleton no overlay «Verificando com a IA».
- Mudar o card de cadastro alinhado depois que a fila já respondeu vazia.

## Contexto no código

- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/components/products/correlacao2/CorrelationCaseWorkbench.tsx`
- `web/src/components/ui/skeleton.tsx`

## Comportamento esperado

- Com a fila ainda carregando, a tela mostra skeleton (KPIs, filtros e linhas da tabela).
- O card **Cadastro alinhado** só aparece depois que a busca termina sem itens.
- Sessão anterior da IA (`result`) não dispensa o skeleton da fila.

## Critérios de aceite

- [x] Abrir Classificar com itens pendentes: skeleton primeiro, depois a tabela — sem flash de Cadastro alinhado.
- [x] Abrir Classificar sem itens: skeleton, depois o card Cadastro alinhado.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

O empty state usa `queue?.counts.total ?? 0`. Com `queue` nulo isso vira 0. O loader atual exige `!result`, então sessão persistida pula o loading.

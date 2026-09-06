# Feature: Seletor de intent na fila da Correlação 2

- **Slug:** `correlacao-2-seletor-na-fila`
- **Status:** em-andamento
- **Área:** `/app/produtos/correlacao-2`

## Problema

O «O que é» fica só no inspector. Na fila a coluna Sugerido é texto; para mudar o papel o usuário precisa ir à direita.

## Objetivo

A coluna Sugerido é o seletor de intent. A direita abre o workspace do que já veio pré-selecionado ou do que a pessoa escolheu na lista.

## Fora de escopo

- Mudar os intents ou o apply.
- Alterar a Correlação original.
- Tirar a indicação do agente no inspector.

## Contexto no código

- `web/src/components/products/correlacao2/CorrelationV2Queue.tsx`
- `web/src/components/products/correlacao2/CorrelationV2Inspector.tsx`
- `web/src/components/products/correlacao2/CorrelationV2Flow.tsx`
- `web/src/components/products/ProductSetupInbox.tsx` (RoleSelect na lista)

## Comportamento esperado

- Coluna Sugerido: `SearchSelect` com os intents do caso, já marcado (IA ou local).
- Trocar o seletor seleciona a linha e abre o workspace correspondente.
- Clique na linha abre a direita com o intent atual.
- Inspector sem o seletor de intent.
- No celular o seletor fica no card, como em Para corrigir.

## Critérios de aceite

- [x] Sugerido é um seletor, não só o rótulo.
- [x] A direita não tem o seletor de «O que é».
- [x] Workspace da direita segue o valor pré-selecionado ou o escolhido na lista.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar o padrão do `RoleSelect` em `ProductSetupInbox` (`stopPropagation`). `SearchSelect`, não `Select`.

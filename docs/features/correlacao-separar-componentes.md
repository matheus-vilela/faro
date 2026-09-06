# Feature: Separar Mesmo produto e Para corrigir

- **Slug:** `correlacao-separar-componentes`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação)

## Problema

Os dois blocos da aba Correlação (Mesmo produto e Para corrigir) estão no mesmo arquivo do fluxo. Qualquer ajuste num mistura o outro.

## Objetivo

Cada bloco é um componente próprio. O fluxo só orquestra sessão, fila e os dois.

## Fora de escopo

- Mudar layout, critérios de match ou a fila.
- Alterar Correlação 2.

## Contexto no código

- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/components/products/ProductValidationCards.tsx`
- `web/src/components/products/ProductSetupInbox.tsx`

## Comportamento esperado

- `CorrelationSameProductSection`: lista ≥ 90%, incluir compra, unificar.
- `CorrelationToCorrectSection`: listagem Para corrigir + painel.
- Visual e ações iguais aos de hoje.

## Critérios de aceite

- [x] Os dois blocos não compartilham o mesmo componente de UI.
- [x] Unificar e corrigir pela fila continuam iguais.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `SameItemRow` e `ProductSetupInbox`. Não duplicar apply.

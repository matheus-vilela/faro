# Feature: Para corrigir usa o fluxo da Correlação 2

- **Slug:** `correlacao-corrigir-usar-v2`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

«Para corrigir» e a Correlação 2 fazem a mesma classificação (unificar, ficha, agrupamento…). A lista antiga (`ProductSetupInbox`) é outro fluxo. O da Correlação 2 (seletor na fila + workspace à direita) é o que queremos.

## Objetivo

«Para corrigir» reutiliza a fila + inspector da Correlação 2. Um único componente de trabalho.

## Fora de escopo

- Apagar a aba Correlação 2.
- Mudar Mesmo produto.
- Trocar o apply (`ProductSetupActionPanel`).

## Contexto no código

- `web/src/components/products/CorrelationToCorrectSection.tsx`
- `web/src/components/products/correlacao2/CorrelationV2Flow.tsx`
- `web/src/components/products/correlacao2/CorrelationV2Queue.tsx`
- `web/src/components/products/correlacao2/CorrelationV2Inspector.tsx`
- `web/src/lib/productValidation/correlationCase.ts`

## Comportamento esperado

- Para corrigir: mesma lista (Sugerido = seletor) e o inspector à direita.
- Intent pré-marcado pela IA/local, como na Correlação 2.
- Confirmar some o item da lista; Mesmo produto não muda.
- Correlação 2 usa o mesmo bloco.

## Critérios de aceite

- [x] Para corrigir não usa mais `ProductSetupInbox`.
- [x] Seletor de intent na lista; workspace à direita conforme a escolha.
- [x] Correlação 2 continua com o mesmo fluxo.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Extrair fila + inspector para um workbench compartilhado. Não duplicar Queue/Inspector.

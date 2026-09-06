# Feature: Uma tabela de correlação

- **Slug:** `correlacao-tabela-unificada`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação)

## Problema

Mesmo produto e Para corrigir são duas listas do mesmo trabalho. Um card de unificar e outro de classificar. O usuário troca de bloco para a mesma decisão.

## Objetivo

Uma tabela: item | o que é | fluxo (vincular, ficha, criar…) | ação. O match ≥ 90% vira linha com Unificar já marcado.

## Fora de escopo

- Trocar o apply (`ProductSetupActionPanel` / merge / ficha).
- Inferir ficha sozinho.
- Apagar a aba Correlação 2 (ela usa a mesma tabela).

## Contexto no código

- `web/src/components/products/correlacao2/CorrelationCaseWorkbench.tsx`
- `web/src/components/products/ProductSetupActionPanel.tsx`
- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/lib/productValidation/correlationCase.ts`

## Comportamento esperado

- Colunas: Item · O que é (`SearchSelect`) · Fluxo · Ação.
- Unificar: parceiros pré-preenchidos quando a IA apontou o par.
- Ficha/produção: editor só na linha ativa (não N editores).
- Confirmar some a linha. Mesmo produto e Para corrigir deixam de existir como blocos separados.
- Cards no celular; tabela a partir de `md`.

## Critérios de aceite

- [x] Uma lista na Correlação, sem os dois blocos.
- [x] Seletor troca o fluxo da terceira coluna e o botão da quarta.
- [x] Unificar ≥ 90% já vem marcado com os pares.
- [x] Correlação 2 usa a mesma tabela.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `casesFromQueue` e o ActionPanel. Botão da 4ª coluna via `hidePrimaryAction` + `onPrimaryActionChange`. Não inventar apply.

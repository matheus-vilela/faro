# Feature: Match inicial só unifica produtos iguais

- **Slug:** `correlacao-match-so-unificar`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação · matches do início)

## Problema

O bloco inicial mistura unificar com ficha, agrupamento e papel do vendido. Dose/prato (possível ficha) aparece como se fosse o mesmo item. Com várias compras da nota, a unificação reabre o diálogo um a um e a conversão de unidade não mostra o conjunto.

## Objetivo

No início, só matches de **produto igual**. Esquerda = vendido, direita = par da nota, abaixo = incluir outro. Vários cadastros unificam no mesmo fluxo, com conversão por item.

## Fora de escopo

- Inferir ficha automaticamente neste bloco.
- Unificar ficha ou agrupamento com a nota.
- Mudar o contrato da IA.
- Alterar Correlação 2.

## Contexto no código

- `web/src/components/products/ProductValidationCards.tsx`
- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/components/products/ProductMergeDialog.tsx`
- `web/src/lib/productValidation/types.ts`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Match inicial: `same_item` ≥ 90% **sem** sinal de ficha (`conflictWithRecipe`). Propostas de ficha vão para «Para corrigir». Itens de «Mesmo produto» também entram nessa lista (`correlacao-mesmo-produto-na-fila`).
- Tabela: vendido à esquerda; `=` no meio; à direita a lista dos cadastros da nota (e o seletor para incluir outro). «Não unificar» tira o par só deste bloco (`correlacao-mesmo-produto-tabela`).
- Unificar com 2+ compras: um diálogo. O PDV permanece; cada item da nota tem a própria conversão para a unidade que fica.
- Um cadastro só: o diálogo atual de um par continua.

## Critérios de aceite

- [x] Bloco inicial não lista ficha nem «parece ficha».
- [x] Layout esquerda PDV / direita nota / abaixo incluir outro.
- [x] Vários itens da nota abrem um único fluxo de unificação com conversão por item.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não unificar `RECIPE_CONTROLLED` nem `SALE_FAMILY`. Reutilizar `mergeCompanyProducts` em sequência no mesmo diálogo. `initialSurvivorIsSource` (PDV permanece).

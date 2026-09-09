# Feature: SearchSelect digitável no trigger

- **Slug:** `search-select-trigger-digitavel`
- **Status:** feita
- **Área:** `SearchSelect` · itens da NF · qualquer formulário

## Problema

O `SearchSelect` exige clicar no campo e depois clicar de novo na busca do popover para digitar. Na tabela de itens da nota (categoria), isso atrasa a classificação.

## Objetivo

Clicar no campo e digitar na hora: a lista abre e filtra sem segundo clique.

## Fora de escopo

- Trocar `DropdownMenu`.
- Redesign visual completo do popover.

## Contexto no código

- `web/src/components/ui/search-select.tsx`
- Wrappers: `BoletoCategoryPicker` (itens da NF)
- Regra: `.cursor/rules/selects.mdc`

## Comportamento esperado

- O trigger é um input: foco/clique abre a lista; digitar filtra.
- Fechado: mostra o valor selecionado (ou placeholder).
- Sem campo de busca duplicado dentro do popover.
- Enter seleciona o primeiro resultado filtrado (ou «Cadastrar»).

## Critérios de aceite

- [x] Na categoria do item da NF: um clique + digitar já filtra
- [x] Demais `SearchSelect` mantêm criar, limpar, abas e trailing
- [ ] Verificar no browser o fluxo principal

## Notas para a IA

Usar `PopoverAnchor` + input no trigger; não reinventar picker fora do `SearchSelect`.

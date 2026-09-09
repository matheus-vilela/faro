# Feature: SearchSelect padrão do sistema

- **Slug:** `search-select-padrao`
- **Status:** feita
- **Área:** UI · Contagem · qualquer select de formulário

## Problema

Havia dois selects de formulário (Radix `Select` e `SearchSelect`) e vários pickers que copiavam o segundo. Visual e comportamento mudavam de tela para tela.

## Objetivo

Um único seletor de formulário: `SearchSelect`. Busca sempre. Criar na lista quando o fluxo precisar (`onCreate`, `footer` ou `trailingOptions`). Contagem e o restante do app usam esse seletor.

## Fora de escopo

- Trocar `DropdownMenu` (ações, não valor de formulário).
- `MonthSelector` (mês com setas, não é lista).

## Contexto no código

- `web/src/components/ui/search-select.tsx` — seletor padrão
- Contagem: `EstoqueAprovacaoContagem`, `EstoqueHistoricoContagem`, `EstoqueContagemListingSheet`, `EstoqueContagemScheduleDialog`, `ContagemEstoquePublic`
- Wrappers: `ProductUnitSearchSelect`, `ProductUnitPickerWithConversion`, `ProductSelectPopover`, `BoletoCategoryPicker`, `ProductCategoryTagsField`
- Regra: `.cursor/rules/selects.mdc`
- Filtros: `.cursor/rules/filtros.mdc`

## Comportamento esperado

- Trigger digitável: clique/foco e digite para filtrar (sem busca extra no popover). `size` `sm` (filtros `h-8`) ou `default`.
- `onCreate(texto)` mostra «Cadastrar «texto»» se a busca não for um item exato. Extra de campos vai em `footer` ou dialog do pai.
- Grupo (`group`), limpar (`clearable`), busca remota (`filterLocally={false}` + `onSearchChange` + `onListScroll`).
- Contagem e demais formulários/filtros usam só `SearchSelect`.

## Critérios de aceite

- [x] `SearchSelect` tem `size`, `onCreate` e `footer`.
- [x] Abas Aprovar / Histórico / Listas (sheet e agenda) e página pública usam só `SearchSelect`.
- [x] Pickers que clonavam o SearchSelect passam a usá-lo.
- [x] Formulários e filtros do app não importam `ui/select`.
- [x] Regra: novo select de formulário = `SearchSelect`.
- [ ] Verificar no browser Contagem (filtros + listagem + unidade pública).

## Notas para a IA

Não inventar outro picker. `trailingOptions` continua para ações custom. Não usar `Select` / `SelectTrigger` em formulário ou filtro.

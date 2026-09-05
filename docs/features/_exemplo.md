# Feature: Ordenação e lista em sheets

- **Slug:** `tabelas-e-sheets`
- **Status:** feita
- **Área:** qualquer sheet com lista (despesas, receitas, produtos, fluxo)

> Exemplo de spec preenchido. Já está no código e na regra `.cursor/rules/tabelas-e-sheets.mdc`. Não reimplementar.

## Problema

Listas em sheets misturavam tabela e cards, ou mostravam um toggle de formato. No desktop o sheet às vezes ficava estreito (`sm:max-w-*`). Tabelas de dados não ordenavam pelo cabeçalho.

## Objetivo

Toda lista tabular ordena pelo cabeçalho. Sheets ocupam 70% da largura a partir de `md` e, quando têm tabela e card, usam cards só no celular.

## Fora de escopo

- Persistência da ordenação no servidor.
- Toggle manual tabela/card no sheet.
- Mudar sheets que só têm formulário (sem lista).

## Contexto no código

- `web/src/components/ui/sortable-table-head.tsx` — `SortableTableHead`
- `web/src/hooks/useClientTableSort.ts` — sort em memória
- `web/src/hooks/useSheetListView.ts` — cards no mobile, tabela no restante
- `web/src/components/ui/sheet.tsx` — largura padrão do `SheetContent` (não forçar `sm:max-w-*`)
- Regra: `.cursor/rules/tabelas-e-sheets.mdc`

## Comportamento esperado

- Clique no cabeçalho alterna asc/desc; coluna ativa mostra ícone.
- Sheet: tela cheia no celular, 70% da largura a partir de `md`.
- Lista em sheet com os dois layouts: cards só no celular, tabela nos demais. Sem toggle.

## Critérios de aceite

- [x] Cabeçalhos de tabela de dados usam `SortableTableHead`.
- [x] Listas em memória usam `useClientTableSort`.
- [x] Sheets com tabela+card usam `useSheetListView`, sem toggle.
- [x] Nenhum sheet de lista força `sm:max-w-*` para estreitar.

## Notas para a IA

Reutilizar os hooks/componentes acima. Não criar sort ad-hoc nem outro seletor de view.

# Feature: Sheet de agrupamento — variantes no mesmo painel

- **Slug:** `agrupamentos-sheet-variantes`
- **Status:** feita
- **Área:** `/app/produtos/familias` · Produtos e estoque

## Problema

Na lista de agrupamentos há um botão **Vincular variante** que abre outro sheet. O detalhe do agrupamento também abre um segundo sheet para incluir variante. São dois fluxos e um sheet empilhado no outro.

## Objetivo

A lista só lista. Clicar num agrupamento abre **um** sheet com as variantes e o formulário de incluir nova, sem sheet extra.

## Fora de escopo

- Renomear rota `/app/produtos/familias` ou RPCs `sale_family`.
- Mudar o vínculo a partir do catálogo, vendas do dia ou Desenvolvimento.
- Criar variante nova no cadastro (só ligar produto existente).

## Contexto no código

- `web/src/components/products/SaleFamiliesPanel.tsx`
- `web/src/components/products/SaleFamilyLinkSheet.tsx` — permanece nos outros fluxos
- `web/src/lib/productSaleFamily.ts` — `linkSaleFamilyVariant`, `fetchVariantPickerOptions`
- Regra: `.cursor/rules/tabelas-e-sheets.mdc`

## Comportamento esperado

- Sem botão **Vincular variante** na listagem.
- Clique na linha: sheet com nome/SKU, lista de variantes e bloco **Adicionar variante** (busca + quantidade + confirmar).
- Tabela com cabeçalhos ordenáveis; cards só no celular (`useSheetListView`). Sem toggle.
- Incluir ou desvincular atualiza a lista no mesmo sheet.

## Critérios de aceite

- [x] Listagem sem botão de vincular variante.
- [x] Detalhe + inclusão no mesmo sheet; nenhum segundo sheet.
- [x] Variantes ordenáveis; cards só no celular.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reusar `SearchSelect`, `linkSaleFamilyVariant` e `fetchVariantPickerOptions`. Não forçar `sm:max-w-*` no sheet.

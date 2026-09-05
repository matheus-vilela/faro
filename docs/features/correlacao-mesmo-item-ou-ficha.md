# Feature: Match da IA — unificar ou virar ficha

- **Slug:** `correlacao-mesmo-item-ou-ficha`
- **Status:** supersedido por `correlacao-configurar-papel`
- **Área:** `/app/produtos` (Correlação · confirmar vínculo)

## Problema

O card de match alto da IA só oferece **Unificar**. «DS GIN TANQUERAY» (dose no PDV) e «GIN TANQUERAY» (garrafa na nota) parecem o mesmo item, mas a dose é ficha: a venda deve baixar 30–50 ml da garrafa, não fundir os cadastros.

## Objetivo

No card de confirmação, dá para unificar **ou** transformar o vendido em ficha normal e ligar o(s) item(ns) da nota como insumo, com quantidade editável.

## Fora de escopo

- Inferir sozinho que «DS» é dose (a pessoa confirma).
- Intermediário neste card (continua em «Para corrigir»).
- Mudar o contrato da IA `correlate-sold-purchased`.
- Agrupamento neste card.

## Contexto no código

- `web/src/components/products/ProductValidationCards.tsx`
- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Card de same_item deixa claro que a IA só propõe o vínculo.
- Ações: **Unificar** (fluxo atual) e **Ficha técnica**.
- Ficha abre o editor no vendido (PDV), com as compras da nota já como insumos. Quantidade começa vazia para a pessoa informar (ex. 50 ml).
- Salvar a ficha tira o par da fila, como «Confirmar ficha».

## Critérios de aceite

- [x] Card de match alto tem Unificar e Ficha técnica.
- [x] Ficha técnica não unifica; abre a ficha do vendido com a nota como insumo.
- [x] Dá para informar quantidade/unidade do insumo antes de salvar.
- [x] Unificar continua unificando em sequência se houver várias notas.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

`technicalSheetKind = "sale"`. Prefill de insumos no `EstoqueReceitasPanel` mesmo com `technicalSheetOutputProductId`. Não defaultar quantidade 1.

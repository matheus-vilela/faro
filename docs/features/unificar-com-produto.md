# Feature: Unificar com produto (não só nota)

- **Slug:** `unificar-com-produto`
- **Status:** feita
- **Área:** Correlação / unificar cadastros

## Problema

A opção chama «Unificar com produto de nota fiscal», mas dá para unificar com qualquer produto do catálogo — inclusive um que já absorveu outros cadastros. Se inverter quem permanece, o hub perde a identidade e a referência dos itens já unidos.

## Objetivo

O rótulo é «Unificar com produto». Produto que já tem unificações permanece; não dá para trocar e deixar o cadastro novo.

## Fora de escopo

- Mudar a RPC `merge_company_products`.
- Unificar ficha ou agrupamento.

## Contexto no código

- `web/src/lib/productSetupQueue.ts`
- `web/src/lib/productValidation/soldRole.ts`
- `web/src/components/products/ProductMergeDialog.tsx`
- `web/src/components/products/ProductSetupActionPanel.tsx`

## Comportamento esperado

- Texto da opção: **Unificar com produto**.
- A lista e a busca usam o **catálogo** (`listed_in_product_catalog`), não só a fila de correlação.
- Busca inclui produtos que já unificaram outros (e aliases em `merged_catalog_names`).
- Se um dos dois já tem itens unificados, ele fica. O botão de trocar some e o card explica o porquê.

## Critérios de aceite

- [x] Rótulo sem «de nota fiscal».
- [x] Produto com `merged_catalog_names` aparece na busca e no card.
- [x] Não dá para inverter quando o hub já tem unificações.

## Notas para a IA

Hub = `merged_catalog_names.length > 0`. Se os dois forem hub, permanece o que tem mais nomes; empate, o parceiro (catálogo).

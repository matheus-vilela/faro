# Feature: Tag «Somente estoque» em possível agrupamento

- **Slug:** `correlacao-corrigir-somente-estoque`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

Itens com `stock_only_origin` (possível agrupamento) só mostram a badge **PDV / venda**. Quem lê a lista não vê que o cadastro veio do estoque, sem venda no PDV.

## Objetivo

Possível agrupamento mostra **Somente estoque** ao lado da badge de origem.

## Fora de escopo

- Trocar o rótulo **PDV / venda** ou **Nota fiscal / compra**.
- Tag no catálogo (`Possível agrupamento` continua lá).
- Filtro novo por «somente estoque».

## Contexto no código

- `web/src/components/products/ProductSetupInbox.tsx`
- `web/src/lib/productSetupListFilter.ts`
- `web/src/lib/productSaleFamily.ts` — `isPossibleGroupingProduct`

## Comportamento esperado

- Item com `possibleGrouping` e opção **Faz parte de um agrupamento**: badges **PDV / venda** (ou nota) e **Somente estoque**.
- Se o usuário escolher outra opção, a tag some.
- Demais itens: só a badge de origem.

## Critérios de aceite

- [x] Possível agrupamento tem a tag Somente estoque ao lado da origem.
- [x] Item sem possível agrupamento não mostra essa tag.
- [x] Trocar a opção para outra que não seja variante esconde a tag.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `item.possibleGrouping`. Não misturar com o rótulo do filtro.
